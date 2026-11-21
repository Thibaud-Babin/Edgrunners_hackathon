/**
 * OWNER: C. Tap's behaviour as one pure function: (state, envelope, now) → new state + action requests.
 * No I/O, no clock, no LLM: easy to test and easy to explain to judges.
 * Rules only PROPOSE actions. The executor's gate decides whether they run.
 *
 * Core loop: attention lost (vision) → attention back (vision) → recap of what was said in between.
 * Plus B's detector events: your name (knock + card), a question to the group, they wait for you, a topic,
 * others can't hear you, and mic quality.
 * Mic doctor (Nexthink): with B's Windows mic state (MIC_STATE), Tap diagnoses WHY you can't be heard and the card's
 * button names the exact fix (unmute / switch to the mic that works / raise the volume). Two triggers:
 *  - before anyone notices: you are muted (or the mic sends nothing) AND you are trying to talk (mouth moving);
 *    muted while just listening is normal, so no alert. "I'm muted on purpose" silences it until you unmute.
 *  - a coworker says "we can't hear you": always diagnosed, even when silenced (the problem is confirmed).
 */
import type { LogEntry } from '../../shared/events.ts'
import { ALLOWED_ACTIONS, HAPTIC } from '../../shared/events.ts'
import type { ActionRequest, DetectorHit, Envelope, UserInput, VisionSignal } from './schemas.ts'

type MicKind = 'laptop' | 'headset'
type MicFix = 'unmute' | 'switch' | 'volume'

export const AWAY_MIN_S = 2 // ignore glances shorter than this
export const RECAP_WINDOW_S = 10 // name said while paying attention: recap of the last 10 s
export const NAME_DEDUP_S = 4 // one knock per sentence (B also fires once per sentence; this guards repeats)
export const MIC_BAD_FOR_S = 10 // mic quality must stay bad this long before Tap suggests a fix
const QUOTE_MAX = 120
export const TALKING_FOR_S = 1.5 // mouth moving this long = you are trying to talk
export const MIC_SILENT_S = 2 // talking, mic levels arriving, but nothing loud for this long = the mic sends nothing
export const MIC_LOUD_RMS = 0.02 // same threshold as B's "the user is talking"
export const MIC_LEVELS_FRESH_S = 1.5 // mic levels older than this: Tap's own mic capture is off, it knows nothing
export const MIC_CARD_COOLDOWN_S = 30 // at most one automatic mic card per 30 s
export const MIC_SNOOZE_S = 600 // "I'm muted on purpose": at most 10 min
export const LOW_VOLUME = 0.3 // Windows mic volume below 30 % = "very quiet"

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
  /** B's Windows default mic (MIC_STATE), or null when unknown (not Windows, or not reported yet). */
  mic: { name: string; kind: MicKind; muted: boolean; volume: number; otherKind?: MicKind } | null
  /** Since when the mouth has been moving (A's MOUTH_MOVING), or null. */
  mouthSince: number | null
  /** Tap's own mic capture: when the last level arrived, and when it was last loud. */
  micLevelAt: number
  micLoudAt: number
  /** The fix the last mic card offered (its button runs exactly this), and whether a coworker had reported it. */
  micPlan: { fix: MicFix; mic: MicKind; reported: boolean } | null
  micCardAt: number | null
  /** "I'm muted on purpose": no automatic mute alerts until this time, or until you unmute. */
  micSnoozeUntil: number | null
}

export interface Decision {
  state: RulesState
  actions: ActionRequest[]
  log: { kind: LogEntry['kind']; text: string }[]
  /** Requests refused before they became actions (e.g. a click naming an action that is not on the allowlist). */
  blocked: string[]
}

export function initialState(): RulesState {
  return {
    awayFrom: null,
    lastNameAt: null,
    micBad: null,
    micFixStage: 0,
    mic: null,
    mouthSince: null,
    micLevelAt: 0,
    micLoudAt: 0,
    micPlan: null,
    micCardAt: null,
    micSnoozeUntil: null
  }
}

export function decide(state: RulesState, env: Envelope<unknown>, t: number): Decision {
  const d: Decision = { state: { ...state }, actions: [], log: [], blocked: [] }
  if (env.kind === 'vision') onVision(d, env.payload as VisionSignal, env.ts, t)
  else if (env.kind === 'user') onUser(d, env.payload as UserInput, t)
  else if (env.kind === 'detector') onDetector(d, env.payload as DetectorHit, env.ts, t)
  else if (env.kind === 'mic') onMicLevel(d, env.payload as { rms: number }, t) // every ~250 ms; also the mic timer's clock
  // 'transcript' and 'summary' never produce actions: speech and LLM output are display-only.
  return d
}

function onVision(d: Decision, v: VisionSignal, ts: number, t: number): void {
  if (v.signal === 'mouth') {
    if (v.active === true) {
      if (d.state.mouthSince === null) d.state.mouthSince = t
      checkTalkingMuted(d, t)
    } else d.state.mouthSince = null
    return
  }
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
      if (d.state.mic) micCard(d, t, true, `Someone said: "${quote(hit.text)}"`)
      else
        // No Windows mic state (not Windows, or B's mic watch is off): the old generic card.
        d.actions.push({
          action: 'show_fix',
          problem: `Someone said: "${quote(hit.text)}"`,
          fixLabel: 'Switch to laptop mic',
          fixAction: 'switch_input_device',
          why: 'others cannot hear you'
        })
      d.actions.push({ action: 'send_haptic', waveform: HAPTIC.problem, why: 'others cannot hear you' })
      return
    case 'MIC_STATE':
      return onMicState(d, hit)
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
  if (s.micFixStage === 0 && s.mic) {
    // Mic doctor: name the exact fix (e.g. "too quiet" because the Windows volume is at 15 % → raise it).
    s.micFixStage = 1
    micCard(d, t, false, `Your mic has been ${what} for over ${MIC_BAD_FOR_S} s`, true)
  } else if (s.micFixStage === 0) {
    s.micFixStage = 1
    d.actions.push({
      action: 'show_fix',
      problem: `Your mic has been ${what} for over ${MIC_BAD_FOR_S} s`,
      fixLabel: 'Switch to laptop mic',
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
  } else if (actionId === 'fix_mic') {
    const plan = d.state.micPlan
    if (!plan) {
      d.log.push({ kind: 'decision', text: 'Mic fix clicked, but no mic problem is pending → nothing to do' })
      return
    }
    d.state.micPlan = null
    d.actions.push({ action: 'fix_mic', fix: plan.fix, mic: plan.mic, why: `you clicked "${FIX_LABEL[plan.fix](plan.mic)}"` })
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.done, why: 'mic fixed' })
    d.log.push({
      kind: 'decision',
      text: plan.reported ? 'Mic problem fixed after a coworker reported it' : 'Mic problem fixed before anyone noticed'
    })
    if (d.state.micBad) {
      d.state.micFixStage = 2
      d.state.micBad = { ...d.state.micBad, since: t } // give the fix 10 s before judging it
    }
  } else if (actionId === 'snooze_mic_alerts') {
    d.state.micSnoozeUntil = t + MIC_SNOOZE_S
    d.state.micPlan = null
    d.log.push({ kind: 'decision', text: `Muted on purpose → no mute alerts until you unmute (at most ${MIC_SNOOZE_S / 60} min)` })
  } else if (actionId === 'switch_input_device') {
    // F7 / F9: only this click switches the mic.
    d.actions.push({ action: 'switch_input_device', prefer: 'laptop', why: 'you clicked "Switch to laptop mic"' })
    d.actions.push({ action: 'send_haptic', waveform: HAPTIC.done, why: 'mic switched' })
    if (d.state.micBad) {
      d.state.micFixStage = 2
      d.state.micBad = { ...d.state.micBad, since: t } // give the new mic 10 s before judging it
    }
  } else {
    d.log.push({ kind: 'action', text: `${actionId} (not used anymore)` })
  }
}

// ---------- mic doctor ----------

const FIX_LABEL: Record<MicFix, (mic: MicKind) => string> = {
  unmute: (mic) => `Unmute ${mic} mic`,
  switch: (mic) => `Switch to ${mic} mic`,
  volume: () => 'Raise mic volume to 80 %'
}

function onMicLevel(d: Decision, level: { rms: number }, t: number): void {
  d.state.micLevelAt = t
  if (level.rms > MIC_LOUD_RMS) d.state.micLoudAt = t
  checkMicFix(d, t)
  checkTalkingMuted(d, t)
}

/** B's Windows default mic changed: remember it. Unmuting ends "muted on purpose". */
function onMicState(d: Decision, hit: DetectorHit): void {
  const s = d.state
  if (!hit.micKind || hit.muted === undefined) return
  const before = s.mic
  s.mic = { name: hit.text, kind: hit.micKind, muted: hit.muted, volume: hit.volume ?? 1, ...(hit.otherKind ? { otherKind: hit.otherKind } : {}) }
  if (before && before.muted && !hit.muted) {
    s.micSnoozeUntil = null
    if (s.micPlan?.fix === 'unmute') s.micPlan = null
  }
  if (!before || before.muted !== hit.muted || before.name !== hit.text) {
    const what = `${capital(hit.micKind)} mic "${quote(hit.text)}"`
    d.log.push({ kind: 'decision', text: hit.muted ? `${what} is muted in Windows` : `${what} is on (not muted)` })
  }
}

/** Talking, Tap's mic capture is running, but nothing loud came since you started: the mic sends nothing. */
function micSilent(s: RulesState, t: number): boolean {
  return s.mouthSince !== null && t - s.micLevelAt < MIC_LEVELS_FRESH_S && t - s.micLoudAt >= MIC_SILENT_S && s.micLoudAt < s.mouthSince
}

/**
 * Before anyone notices: you are trying to talk (mouth moving ≥ 1.5 s) and your mic is muted in Windows,
 * or Tap's own capture of it is silent. Just listening while muted is normal: no mouth, no alert.
 */
function checkTalkingMuted(d: Decision, t: number): void {
  const s = d.state
  if (!s.mic || s.mouthSince === null || t - s.mouthSince < TALKING_FOR_S) return
  if (s.micSnoozeUntil !== null && t < s.micSnoozeUntil) return
  if (s.micCardAt !== null && t - s.micCardAt < MIC_CARD_COOLDOWN_S) return
  if (!s.mic.muted && !micSilent(s, t)) return // the mic works: you are heard
  micCard(d, t, false, 'You are talking')
}

/**
 * Diagnose and show ONE card whose button names the exact fix. `reported`: a coworker said they can't hear you.
 *   muted in Windows       → "Unmute <kind> mic"
 *   volume very low        → "Raise mic volume to 80 %"
 *   mic sends nothing      → "Switch to <other kind> mic" (or what to check, when there is no other mic)
 *   all fine, yet reported → probably muted in Meet: only a hint (no app can press Meet's own mute button)
 * `quality`: B's mic quality has been bad for 10 s; without a better idea, switching mic is still worth a try.
 */
function micCard(d: Decision, t: number, reported: boolean, context: string, quality = false): void {
  const s = d.state
  const mic = s.mic!
  let problem: string
  let plan: { fix: MicFix; mic: MicKind } | null = null
  if (mic.muted) {
    problem = `${context}, but your ${mic.kind} mic is muted in Windows`
    plan = { fix: 'unmute', mic: mic.kind }
  } else if (mic.volume < LOW_VOLUME) {
    problem = `${context}, but your mic is very quiet (volume ${Math.round(mic.volume * 100)} %)`
    plan = { fix: 'volume', mic: mic.kind }
  } else if ((micSilent(s, t) || quality) && mic.otherKind) {
    problem = quality ? context : `${context}, but your ${mic.kind} mic sends no sound`
    plan = { fix: 'switch', mic: mic.otherKind }
  } else if (micSilent(s, t)) {
    problem = `${context}, but your ${mic.kind} mic sends no sound. Check its cable or Bluetooth connection.`
  } else if (quality) {
    problem = `${context}. Move closer to the mic, or plug in a headset.`
  } else if (reported) {
    problem = `${context}. Your mic works in Windows, so you are probably muted in Meet: press Ctrl+D in Meet.`
  } else return
  s.micCardAt = t
  s.micPlan = plan ? { ...plan, reported } : null
  d.actions.push({
    action: 'show_fix',
    problem: problem.slice(0, 280),
    fixLabel: plan ? FIX_LABEL[plan.fix](plan.mic) : 'Got it',
    fixAction: plan ? 'fix_mic' : 'dismiss_card',
    // Muted while talking, found by Tap itself: you may be muted on purpose.
    ...(plan?.fix === 'unmute' && !reported ? { altLabel: "I'm muted on purpose", altAction: 'snooze_mic_alerts' as const } : {}),
    why: reported ? 'others cannot hear you' : quality ? 'mic quality bad' : mic.muted ? 'you are talking while muted' : 'you are talking but your mic sends nothing'
  })
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function quote(s: string): string {
  return s.length <= QUOTE_MAX ? s : s.slice(0, QUOTE_MAX - 1) + '…'
}
