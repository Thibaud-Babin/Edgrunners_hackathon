/**
 * OWNER: C. Today's behaviours as one pure function: (state, envelope, now) → new state + action requests.
 * No I/O, no clock, no LLM: easy to test and easy to explain to judges.
 * Rules only PROPOSE actions. The executor's gate decides whether they run.
 */
import type { LogEntry } from '../../shared/events.ts'
import { ALLOWED_ACTIONS, HAPTIC } from '../../shared/events.ts'
import type { ActionRequest, DetectorHit, Envelope, UserInput, VisionSignal } from './schemas.ts'

export const RECAP_WINDOW_S = 10
export const RECAP_DELAY_MS = 1500 // let the end of the sentence arrive before recapping
export const AWAY_MIN_S = 2 // ignore glances shorter than this
export const MIC_SILENT_RMS = 0.01 // TODO(B): tune on real headsets
export const MIC_SILENT_AFTER_S = 2
export const MIC_ALERT_COOLDOWN_S = 15
const QUOTE_MAX = 200

export interface RulesState {
  awayFrom: number | null
  lastMicLoud: number
  mouthActive: boolean
  lastMicAlert: number
}

export interface Decision {
  state: RulesState
  actions: ActionRequest[]
  log: { kind: LogEntry['kind']; text: string }[]
  /** Requests refused before they became actions (e.g. a click naming an action that is not on the allowlist). */
  blocked: string[]
}

export function initialState(t: number): RulesState {
  return { awayFrom: null, lastMicLoud: t, mouthActive: false, lastMicAlert: 0 }
}

export function decide(state: RulesState, env: Envelope<unknown>, t: number): Decision {
  const d: Decision = { state: { ...state }, actions: [], log: [], blocked: [] }
  switch (env.kind) {
    case 'detector':
      onDetector(d, env.payload as DetectorHit, env.ts, t)
      break
    case 'vision':
      onVision(d, env.payload as VisionSignal, env.ts, t)
      break
    case 'mic': {
      const { rms } = env.payload as { rms: number }
      if (rms > MIC_SILENT_RMS) d.state.lastMicLoud = env.ts
      checkMicSilent(d, t)
      break
    }
    case 'user':
      onUser(d, env.payload as UserInput)
      break
    // 'transcript' and 'summary' never produce actions: speech and LLM output are display-only.
  }
  return d
}

/** P0-1 / P0-2 / P0-3: name said → knock → recap, or "while you were away" if the user was away. */
function onDetector(d: Decision, hit: DetectorHit, ts: number, t: number): void {
  if (hit.type === 'NAME_MENTIONED') {
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.addressed, why: 'your name was said' })
    const away = d.state.awayFrom
    if (away !== null && t - away >= AWAY_MIN_S) {
      d.actions.push({ action: 'show_away_summary', fromTs: away, trigger: 'name', skipIfSilent: false, why: 'your name was said while you were away' })
      d.state.awayFrom = null
    } else {
      d.actions.push({ action: 'show_recap', fromTs: ts - RECAP_WINDOW_S, fallbackText: hit.text, afterMs: RECAP_DELAY_MS, why: 'your name was said' })
    }
  } else if (hit.type === 'OTHERS_CANT_HEAR') {
    // P1-2: others say they can't hear you.
    // Card first so it appears at once; the haptic call can take up to 1 s.
    d.actions.push({
      action: 'show_fix',
      problem: `Someone said: "${quote(hit.text)}"`,
      fixLabel: 'Switch to laptop mic',
      fixAction: 'switch_input_device',
      why: 'others cannot hear you'
    })
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.problem, why: 'others cannot hear you' })
  }
}

function onVision(d: Decision, v: VisionSignal, ts: number, t: number): void {
  if (v.signal === 'away') {
    if (d.state.awayFrom === null) d.state.awayFrom = ts
  } else if (v.signal === 'back') {
    const away = d.state.awayFrom
    if (away === null) return
    if (t - away >= AWAY_MIN_S)
      d.actions.push({ action: 'show_away_summary', fromTs: away, trigger: 'looked_back', skipIfSilent: true, why: 'you looked back' })
    d.state.awayFrom = null
  } else if (v.signal === 'mouth') {
    d.state.mouthActive = v.active === true
    checkMicSilent(d, t)
  }
}

/** P0-4: mouth moving + mic silent for ≥ 2 s. */
function checkMicSilent(d: Decision, t: number): void {
  const s = d.state
  if (!s.mouthActive || t - s.lastMicLoud < MIC_SILENT_AFTER_S || t - s.lastMicAlert < MIC_ALERT_COOLDOWN_S) return
  s.lastMicAlert = t
  d.log.push({ kind: 'decision', text: 'mouth moving but mic sends nothing → MIC_SILENT_WHILE_SPEAKING' })
  d.actions.push({ action: 'show_fix', problem: 'Your mic sends nothing', fixLabel: 'Switch to laptop mic', fixAction: 'switch_input_device', why: 'your mic sends nothing' })
  d.actions.push({ action: 'send_haptic', waveform: HAPTIC.problem, why: 'your mic sends nothing' })
}

const GESTURE_NAMES: Partial<Record<UserInput['input'], string>> = { nod: 'nod', shake: 'shake', brow_raise: 'eyebrow raise' }

function onUser(d: Decision, u: UserInput): void {
  if (u.input === 'click') {
    onClick(d, u.actionId ?? '', u.cardId ?? '')
    return
  }
  const name = GESTURE_NAMES[u.input]
  if (!name) return
  d.log.push({ kind: 'decision', text: `gesture recognised: ${name}` })
  d.actions.push({ action: 'send_haptic', waveform: HAPTIC.gestureSeen, why: `${name} seen` })
  // P1-1: nod → "Yes", shake → "No". T2 (speaks for the user): the gate decides by role.
  // The eyebrow raise confirms a waiting action; the executor handles that before the rules run.
  const reply = REPLIES[u.input]
  if (reply) d.actions.push({ action: 'post_chat_reply', text: reply, why: `${capitalise(name)} seen` })
}

const REPLIES: Partial<Record<UserInput['input'], string>> = { nod: 'Yes', shake: 'No' }

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The user clicked a button in Tap's UI. Only allowlisted actions exist. */
function onClick(d: Decision, actionId: string, cardId: string): void {
  if (!(ALLOWED_ACTIONS as readonly string[]).includes(actionId)) {
    d.blocked.push(`action "${actionId}" is not on the allowlist`)
    return
  }
  if (actionId === 'switch_input_device') {
    d.actions.push({ action: 'switch_input_device', prefer: 'laptop', why: 'you clicked the fix' })
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.done, why: 'fix done' })
  } else if (actionId === 'dismiss_card') {
    d.actions.push({ action: 'dismiss_card', cardId, why: 'you dismissed the card' })
  } else {
    d.log.push({ kind: 'action', text: `${actionId} (not implemented yet)` })
  }
}

function quote(s: string): string {
  return s.length <= QUOTE_MAX ? s : s.slice(0, QUOTE_MAX - 1) + '…'
}
