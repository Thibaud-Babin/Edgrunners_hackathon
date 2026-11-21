/**
 * OWNER: C. Tap's behaviour as one pure function: (state, envelope, now) → new state + action requests.
 * No I/O, no clock, no LLM: easy to test and easy to explain to judges.
 * Rules only PROPOSE actions. The executor's gate decides whether they run.
 *
 * Core loop: attention lost (vision) → attention back (vision) → recap of what was said in between.
 * Plus B's detector events: your name (knock + card), a question to the group, they wait for you, a topic,
 * others can't hear you, and mic quality.
 */
import type { LogEntry } from '../../shared/events.ts'
import { ALLOWED_ACTIONS, HAPTIC } from '../../shared/events.ts'
import type { ActionRequest, DetectorHit, Envelope, UserInput, VisionSignal } from './schemas.ts'

export const AWAY_MIN_S = 2 // ignore glances shorter than this
export const RECAP_WINDOW_S = 10 // name said while paying attention: recap of the last 10 s
export const NAME_DEDUP_S = 4 // one knock per sentence (B also fires once per sentence; this guards repeats)
export const MIC_BAD_FOR_S = 10 // mic quality must stay bad this long before Tap suggests a fix
const QUOTE_MAX = 120

type MicLevel = 'too_quiet' | 'clipping' | 'noisy'
const MIC_LEVELS: readonly string[] = ['too_quiet', 'clipping', 'noisy'] satisfies MicLevel[]
const MIC_TEXT: Record<MicLevel, string> = { too_quiet: 'too quiet', clipping: 'clipping (too loud)', noisy: 'noisy' }

export interface RulesState {
  /** When attention was lost (seconds since epoch), or null while the user is paying attention. */
  awayFrom: number | null
  /** When the user's name last made Tap knock (one knock per sentence). */
  lastNameAt: number | null
  /** Bad mic quality: since when, which level, and how far the fix went. */
  micBad: { level: MicLevel; since: number } | null
  /** 0 nothing shown · 1 "switch to laptop mic" card shown · 2 user switched · 3 "still bad" card shown */
  micFixStage: 0 | 1 | 2 | 3
}

export interface Decision {
  state: RulesState
  actions: ActionRequest[]
  log: { kind: LogEntry['kind']; text: string }[]
  /** Requests refused before they became actions (e.g. a click naming an action that is not on the allowlist). */
  blocked: string[]
}

export function initialState(): RulesState {
  return { awayFrom: null, lastNameAt: null, micBad: null, micFixStage: 0 }
}

export function decide(state: RulesState, env: Envelope<unknown>, t: number): Decision {
  const d: Decision = { state: { ...state }, actions: [], log: [], blocked: [] }
  if (env.kind === 'vision') onVision(d, env.payload as VisionSignal, env.ts, t)
  else if (env.kind === 'user') onUser(d, env.payload as UserInput, t)
  else if (env.kind === 'detector') onDetector(d, env.payload as DetectorHit, env.ts, t)
  else if (env.kind === 'mic') checkMicFix(d, t) // mic levels (every ~250 ms) are the clock for the mic timer
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
    d.actions.push({
      action: 'show_away_summary',
      fromTs: away,
      untilTs: t,
      trigger: 'looked_back',
      waitSentenceEnd: false,
      why: `you looked back after ${seconds} s away`
    })
  }
}

/** B's detectors (deterministic, no LLM): they may only notify the user (T0); the gate enforces it. */
function onDetector(d: Decision, hit: DetectorHit, ts: number, t: number): void {
  switch (hit.type) {
    case 'NAME_MENTIONED':
      return onName(d, hit, ts, t)
    case 'QUESTION_TO_GROUP': // F6
      d.log.push({ kind: 'decision', text: 'Question to the whole group → ringing' })
      d.actions.push({ action: 'send_haptic', waveform: HAPTIC.groupQuestion, why: 'a question to the group' })
      return
    case 'WAITING_FOR_YOU': // F4: a question to you, then silence → nudge card + "knock knock"
      d.actions.push({ action: 'show_nudge', question: hit.text.slice(0, 140), why: 'a question to you, then silence' })
      d.actions.push({ action: 'send_haptic', waveform: HAPTIC.waiting, why: 'they are waiting for your answer' })
      d.actions.push({ action: 'send_haptic', waveform: HAPTIC.waiting, why: 'they are waiting for your answer' })
      return
    case 'TOPIC_MENTIONED': // F8
      d.log.push({ kind: 'decision', text: `Topic "${hit.text}" mentioned → soft heads-up` })
      d.actions.push({ action: 'send_haptic', waveform: HAPTIC.topic, why: `topic "${hit.text}" mentioned` })
      return
    case 'OTHERS_CANT_HEAR': // F7: card first (it appears at once), then the alert
      d.actions.push({
        action: 'show_fix',
        problem: `Someone said: "${quote(hit.text)}"`,
        fixLabel: 'Unmute + use laptop mic',
        fixAction: 'switch_input_device',
        why: 'others cannot hear you'
      })
      d.actions.push({ action: 'send_haptic', waveform: HAPTIC.problem, why: 'others cannot hear you' })
      return
    case 'MIC_QUALITY': // F9
      return onMicQuality(d, hit.text, t)
    // VIDEO_FROZEN_REPORTED: a device problem the checkup agent reports.
  }
}

/**
 * F1-F3, F5. Your name → knock now, once per sentence.
 * Paying attention → recap card of the last 10 s. Away (≥ 2 s) → the "while you were away" card at once,
 * without waiting for you to look back; the away period restarts there, so looking back later recaps only the rest.
 * If the name was heard mid-sentence (partial), the card waits for the end of the sentence so it holds the question.
 */
function onName(d: Decision, hit: DetectorHit, ts: number, t: number): void {
  const s = d.state
  if (s.lastNameAt !== null && t - s.lastNameAt < NAME_DEDUP_S) return // same sentence
  s.lastNameAt = t
  d.actions.push({ action: 'send_haptic', waveform: HAPTIC.addressed, why: 'your name was said' })
  if (hit.latencyS !== undefined)
    d.log.push({ kind: 'decision', text: `Knock ${hit.latencyS} s after ${hit.latencyRef === 'name_word' ? 'your name was said' : 'the sentence started'}` })
  const waitSentenceEnd = hit.partial === true
  const away = s.awayFrom
  if (away !== null && t - away >= AWAY_MIN_S) {
    const seconds = Math.round(t - away)
    d.actions.push({
      action: 'show_away_summary',
      fromTs: away,
      untilTs: t,
      trigger: 'name',
      waitSentenceEnd,
      why: `your name was said after ${seconds} s away`
    })
    s.awayFrom = t // still away: a later "back" recaps only what comes after this card
  } else {
    d.actions.push({ action: 'show_recap', fromTs: ts - RECAP_WINDOW_S, waitSentenceEnd, why: 'your name was said' })
  }
}

/** F9: mic quality bad for > 10 s → suggest the laptop mic; still bad 10 s after switching → say what else to try. */
function onMicQuality(d: Decision, level: string, t: number): void {
  const s = d.state
  if (!MIC_LEVELS.includes(level)) {
    // 'ok' (or anything unknown): the problem is over.
    if (s.micFixStage >= 2) d.log.push({ kind: 'decision', text: 'Mic quality ok after the switch → fix worked' })
    s.micBad = null
    s.micFixStage = 0
    return
  }
  if (!s.micBad) s.micBad = { level: level as MicLevel, since: t }
  else s.micBad = { ...s.micBad, level: level as MicLevel }
  checkMicFix(d, t)
}

function checkMicFix(d: Decision, t: number): void {
  const s = d.state
  if (!s.micBad || t - s.micBad.since < MIC_BAD_FOR_S) return
  const what = MIC_TEXT[s.micBad.level]
  if (s.micFixStage === 0) {
    s.micFixStage = 1
    d.actions.push({
      action: 'show_fix',
      problem: `Your mic has been ${what} for over ${MIC_BAD_FOR_S} s`,
      fixLabel: 'Unmute + use laptop mic',
      fixAction: 'switch_input_device',
      why: `mic ${what} for over ${MIC_BAD_FOR_S} s`
    })
  } else if (s.micFixStage === 2) {
    s.micFixStage = 3
    d.actions.push({
      action: 'show_fix',
      problem: `Mic still ${what} after switching. Check it is not muted, move closer, or plug in a headset.`,
      fixLabel: 'OK',
      fixAction: 'dismiss_card',
      why: `mic still ${what} ${MIC_BAD_FOR_S} s after switching`
    })
  }
}

/** The user clicked a button in Tap's UI. Only allowlisted actions exist. */
function onUser(d: Decision, u: UserInput, t: number): void {
  const actionId = u.actionId ?? ''
  if (!(ALLOWED_ACTIONS as readonly string[]).includes(actionId)) {
    d.blocked.push(`action "${actionId}" is not on the allowlist`)
  } else if (actionId === 'dismiss_card') {
    d.actions.push({ action: 'dismiss_card', cardId: u.cardId ?? '', why: 'you dismissed the card' })
  } else if (actionId === 'switch_input_device') {
    // F7 / F9: only this click switches the mic.
    d.actions.push({ action: 'switch_input_device', prefer: 'laptop', why: 'you clicked "Unmute + use laptop mic"' })
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.done, why: 'mic switched' })
    if (d.state.micBad) {
      d.state.micFixStage = 2
      d.state.micBad = { ...d.state.micBad, since: t } // give the new mic 10 s before judging it
    }
  } else {
    d.log.push({ kind: 'action', text: `${actionId} (not used anymore)` })
  }
}

function quote(s: string): string {
  return s.length <= QUOTE_MAX ? s : s.slice(0, QUOTE_MAX - 1) + '…'
}
