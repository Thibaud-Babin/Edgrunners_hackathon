/**
 * OWNER: C. Tap's behaviour as one pure function: (state, envelope, now) → new state + action requests.
 * No I/O, no clock, no LLM: easy to test and easy to explain to judges.
 * Rules only PROPOSE actions. The executor's gate decides whether they run.
 *
 * Core loop: attention lost (vision) → attention back (vision) → recap of what was said in between.
 */
import type { LogEntry } from '../../shared/events.ts'
import { ALLOWED_ACTIONS, HAPTIC } from '../../shared/events.ts'
import type { ActionRequest, DetectorHit, Envelope, UserInput, VisionSignal } from './schemas.ts'

export const AWAY_MIN_S = 2 // ignore glances shorter than this

export interface RulesState {
  /** When attention was lost (seconds since epoch), or null while the user is paying attention. */
  awayFrom: number | null
}

export interface Decision {
  state: RulesState
  actions: ActionRequest[]
  log: { kind: LogEntry['kind']; text: string }[]
  /** Requests refused before they became actions (e.g. a click naming an action that is not on the allowlist). */
  blocked: string[]
}

export function initialState(): RulesState {
  return { awayFrom: null }
}

export function decide(state: RulesState, env: Envelope<unknown>, t: number): Decision {
  const d: Decision = { state: { ...state }, actions: [], log: [], blocked: [] }
  if (env.kind === 'vision') onVision(d, env.payload as VisionSignal, env.ts, t)
  else if (env.kind === 'user') onUser(d, env.payload as UserInput)
  else if (env.kind === 'detector') onDetector(d, env.payload as DetectorHit)
  // 'transcript' and 'summary' never produce actions: speech and LLM output are display-only.
  return d
}

function onVision(d: Decision, v: VisionSignal, ts: number, t: number): void {
  if (v.signal === 'away') {
    if (d.state.awayFrom === null) d.state.awayFrom = ts
  } else if (v.signal === 'back') {
    const away = d.state.awayFrom
    if (away === null) return
    d.state.awayFrom = null
    const seconds = Math.round(t - away)
    if (t - away < AWAY_MIN_S) {
      d.log.push({ kind: 'decision', text: `Looked away ${seconds} s → no recap (glances under ${AWAY_MIN_S} s are ignored)` })
      return
    }
    d.actions.push({ action: 'show_away_summary', fromTs: away, untilTs: t, why: `you looked back after ${seconds} s away` })
  }
}

/** B's detectors (deterministic, no LLM): notify the user only (T0). */
function onDetector(d: Decision, hit: DetectorHit): void {
  if (hit.type === 'WAITING_FOR_YOU') {
    // A question to you, then silence: they are waiting for your answer → nudge card + "knock knock".
    d.actions.push({ action: 'show_nudge', question: hit.text.slice(0, 140), why: 'a question to you, then silence' })
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.waiting, why: 'they are waiting for your answer' })
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.waiting, why: 'they are waiting for your answer' })
  } else if (hit.type === 'TOPIC_MENTIONED') {
    d.log.push({ kind: 'decision', text: `Topic "${hit.text}" mentioned → soft heads-up` })
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.topic, why: `topic "${hit.text}" mentioned` })
  }
  // OTHERS_CANT_HEAR / VIDEO_FROZEN_REPORTED are device problems: the checkup agent reports them.
}

/** The user clicked a button in Tap's UI. Only allowlisted actions exist. */
function onUser(d: Decision, u: UserInput): void {
  const actionId = u.actionId ?? ''
  if (!(ALLOWED_ACTIONS as readonly string[]).includes(actionId)) {
    d.blocked.push(`action "${actionId}" is not on the allowlist`)
  } else if (actionId === 'dismiss_card') {
    d.actions.push({ action: 'dismiss_card', cardId: u.cardId ?? '', why: 'you dismissed the card' })
  } else {
    d.log.push({ kind: 'action', text: `${actionId} (not used anymore)` })
  }
}
