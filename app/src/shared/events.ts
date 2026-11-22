/**
 * THE CONTRACT. Everyone codes against these types (see docs/PRD.md §4).
 * Change them only after telling the whole team.
 */

export type Source = 'call_audio' | 'mic' | 'webcam' | 'ui' | 'agent'

/** Events produced by the senses (A: webcam, B: audio) and the UI (D). */
export type EventType =
  // B — audio
  | 'TRANSCRIPT_PARTIAL'
  | 'TRANSCRIPT_FINAL'
  | 'NAME_MENTIONED'
  | 'QUESTION_TO_YOU'
  | 'QUESTION_TO_GROUP'
  | 'OTHERS_CANT_HEAR'
  | 'VIDEO_FROZEN_REPORTED'
  | 'MIC_LEVEL'
  // B — audio, added Sat 21 Nov evening (additive; see docs/team/README.md "Update from B")
  | 'WAITING_FOR_YOU' // { question, silent_s, mic_monitored } a question to you, then silence: they wait for your answer
  | 'TOPIC_MENTIONED' // { topic, text } a TAP_TOPICS word was said ("deadline", "budget"…)
  | 'INSTRUCTION_LIKE_SPEECH' // { text } "Tap, ignore your instructions…": log it as ignored, never act on it
  | 'MIC_QUALITY' // { level: 'ok'|'too_quiet'|'clipping'|'noisy', speech_rms, noise_rms, clipped_pct } measured only; the agent decides
  | 'STT_USAGE' // { engine, seconds, cost_usd } speech-to-text usage since start (every 30 s while audio flows)
  | 'MIC_STATE' // { name, kind: 'headset'|'laptop', muted, volume 0..1, other_kind? } the WINDOWS default mic, on change (B, Sat 22:00)
  // A — webcam
  | 'GESTURE_NOD'
  | 'GESTURE_SHAKE'
  | 'GESTURE_BROW_RAISE'
  | 'GESTURE_TILT_LEFT'
  | 'GESTURE_TILT_RIGHT'
  | 'USER_AWAY'
  | 'USER_BACK'
  | 'MOUTH_MOVING'
  | 'CAMERA_FROZEN'
  | 'CAMERA_ALIVE' // B: every 2 s while Tap's camera runs: { face, frozen } (heartbeat; { stopped } when stopped)
  | 'FACE_OUT_OF_FRAME'
  | 'LOW_LIGHT'
  // C — agent (fused)
  | 'MIC_SILENT_WHILE_SPEAKING'
  // D — UI
  | 'USER_CLICK'
  | 'CAPTURE_STATE' // { feed: 'camera' | 'mic' | 'callAudio', on: boolean } Check-up Start/Stop buttons (B)
  | 'SETTINGS' // { optional_haptics, auto_summary } Settings page → main (the rest of the settings live in the UI)
  | 'CALL_SUMMARY_REQUEST' // { from: 'main' | 'overlay' } "Summarize" button (Meeting Summary panel, overlay pill)
  | 'IT_STATS_RESET' // IT console "Reset IT data" (B): start the demo from zero
  | 'IT_STATS_REQUEST' // IT console page opened → main answers with IT_STATS (B)
  | 'OPEN_SUMMARY' // overlay "Open" on the call-summary card → show the main window's Meeting Summary panel
  | 'HAPTIC_TEST' // { pattern: keyof HAPTIC_PATTERNS } Check-up "Try the vibrations": fires that signal, nothing else
  // D — UI, added Sun (C's role-based rights; additive)
  | 'CALL_ENDED' // {} the user clicked "End call": the call's device health report goes to the IT log
  | 'USER_SET_ROLE' // { role: UserRole } DEV-ONLY role switch; main ignores it in packaged builds

export interface TapEvent {
  type: EventType
  /** seconds since epoch (Date.now() / 1000) */
  ts: number
  source: Source
  confidence?: number
  /**
   * TRANSCRIPT_*: { text, speaker? }        MIC_LEVEL: { rms }      NAME_MENTIONED / QUESTION_* / OTHERS_CANT_HEAR: { text, speaker? }
   * NAME_MENTIONED also: { matched, partial, latency_s?, latency_ref? ('name_word' | 'sentence_start') }
   * speaker = "Speaker 1", "Speaker 2"… (Deepgram diarization; absent with the local engine)
   * MOUTH_MOVING: { active }      USER_CLICK: { action_id, args? }
   */
  data?: Record<string, unknown>
}

/** Commands the agent sends to the UI windows (main + overlay). */
export type UiCommand =
  | { type: 'SHOW_RECAP'; id: string; transcript: string; summary: string; question?: string }
  | {
      type: 'SHOW_AWAY_SUMMARY'
      id: string
      away_from: number
      until: number
      trigger: 'name' | 'looked_back'
      summary: string
      question_to_you?: string
      transcript: string
    }
  | {
      type: 'SHOW_FIX'
      id: string
      problem: string
      fix_label: string
      action_id: AllowedAction
      /** Optional second button instead of "Not now", e.g. "I'm muted on purpose" → snooze_mic_alerts */
      alt_label?: string
      alt_action_id?: AllowedAction
      /** Show a "Send diagnostics to IT" button (USER_CLICK open_it_ticket { id }) */
      it_ticket?: boolean
    }
  | { type: 'SHOW_REPLIES'; id: string; question: string; replies: string[] }
  | { type: 'SHOW_REPLY'; id: string; text: string } // P1: what the user "said" with a gesture, e.g. "Yes"
  | { type: 'RESOLVED'; topic: 'mic' | 'camera' } // B: the problem a card is about is gone → that card says ✓ and closes
  | { type: 'RESTART_CAMERA' } // B: agent → main window: stop and start the camera (the user clicked "Restart camera")
  | { type: 'SWITCH_MIC'; prefer: 'laptop' | 'headset' } // agent → main window: restart the mic on another device
  | { type: 'SHOW_NUDGE'; id: string; text: string; question?: string } // "They're waiting for your answer"
  | { type: 'CAPTION'; text: string; final: boolean; speaker?: string; highlight?: string } // live captions (overlay)
  /** The user's role and what it shows (C's permissions.ts). D hides the IT view when sees_it_view is false. */
  | { type: 'ROLE'; role: UserRole; sees_it_view: boolean; confidential: boolean }
  /** A short confirmation toast ("Ticket T-0001 sent to IT"). */
  | { type: 'SHOW_NOTICE'; id: string; text: string }
  | { type: 'DISMISS'; id: string }
  | { type: 'FLASH'; reason: string }
  | { type: 'LOG_ENTRY'; entry: LogEntry }
  | { type: 'COUNTERS'; aiCalls: number; costUsd: number; events: number; blocked: number }
  /** A vibration is being sent now: the overlay plays its sound if "Sound with each vibration" is on (Settings). */
  | { type: 'CUE'; waveform: Waveform }
  /**
   * Meeting summary (B, call-summary.ts + meetings.ts) → Meeting Summary panel, one entry per meeting (`id`; a newer
   * summary of the same meeting replaces it). The overlay shows a short "ready" card for `auto` and `overlay`.
   */
  | {
      type: 'CALL_SUMMARY'
      id: string
      started_at: number
      ended_at: number
      /** The meeting is over (goodbye, or a long gap before the next call); false = "so far". */
      final: boolean
      from: 'auto' | 'main' | 'overlay' | 'restored'
      points: string[]
      questions_to_you: string[]
      your_tasks: string[]
      decisions: string[]
      source: 'cloud' | 'template'
      minutes: number
      lines: number
    }
  | { type: 'OPEN_SUMMARY' }
  | { type: 'IT_STATS'; stats: ItSnapshot }
  /** What Tap captures right now (Check-up Start/Stop): the overlay pill shows it (B) */
  | { type: 'CAPTURE'; camera: boolean; mic: boolean; call_audio: boolean }
  /** Result of a click on "Send to IT" (card_id) or "End call": the button itself confirms, no extra card (B). */
  | { type: 'IT_SENT'; what: 'ticket' | 'call_report'; card_id?: string; ok: boolean; ref?: string; text: string }
  /** B: IT ticket for a card: pending (automatic, can be undone) → sent / failed / cancelled; duplicate = already sent today */
  | { type: 'IT_TICKET'; card_id: string; state: 'pending' | 'sent' | 'failed' | 'cancelled' | 'duplicate'; reason: string; auto: boolean; ref?: string; delay_s?: number }

export interface LogEntry {
  ts: number
  kind: 'event' | 'decision' | 'llm' | 'action' | 'blocked' | 'error'
  text: string
  costUsd?: number
}

/** The only actions the executor knows (PRD §4). Anything else is rejected. */
export const ALLOWED_ACTIONS = [
  'show_recap',
  'show_away_summary',
  'show_fix',
  'switch_input_device',
  'fix_mic', // the mic fix the card names: unmute / switch to the mic that works / raise the volume (Windows level)
  'snooze_mic_alerts', // "I'm muted on purpose": no mute alerts until you unmute (max 10 min)
  'post_chat_reply',
  'speak_reply',
  'send_haptic',
  'raise_hand_overlay',
  'dismiss_card',
  // Sun (C): a card the agents already send, and the IT ticket
  'show_nudge',
  'restart_camera', // B: "we can't see you" and Tap's camera is stuck too → restart it (the user's click)
  'open_it_ticket', // send device diagnostics (never speech) to IT — anyone, on their own click
  'send_call_report', // End call → the call's device health report (never speech) to the IT log — every role
  // B: automatic IT ticket when the user can't fix it (fix failed, still bad, no other mic, 3rd time this week).
  // Only Tap's own device checks start it (provenance system), never speech or AI; the user can undo for 10 s.
  'auto_it_ticket',
  'cancel_it_ticket' // the Undo on that card
] as const
export type AllowedAction = (typeof ALLOWED_ACTIONS)[number]

/** Roles in the company, lowest to highest authority. The role comes from config (SSO in real life), never from speech. */
export const USER_ROLES = ['intern', 'senior', 'executive', 'ceo'] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * The 15 MX Master 4 waveforms (Actions SDK docs). We fire them BY NAME (HapticWeb REST / our plugin).
 * HapticWeb's WebSocket uses an index instead — get the order from GET /waveforms, don't guess it.
 */
export const WAVEFORMS = [
  'sharp_state_change',
  'damp_state_change',
  'sharp_collision',
  'damp_collision',
  'subtle_collision',
  'happy_alert',
  'angry_alert',
  'completed',
  'square',
  'wave',
  'firework',
  'mad',
  'knock',
  'jingle',
  'ringing'
] as const
export type Waveform = (typeof WAVEFORMS)[number]

/**
 * Tap's haptic vocabulary (PRD §1, Sat 22:30): FOUR signals, told apart by count and strength, not by texture
 * (in the rehearsal nobody could tell the soft waveforms apart):
 *   1 knock = your name / a question to you · 2 knocks = they're waiting for your answer
 *   angry_alert (long, strong) = a problem with your setup · completed (short) = fixed
 * groupQuestion and topic are OFF by default (too subtle, they compete with the 4); TAP_OPTIONAL_HAPTICS=1 turns them on.
 */
export const HAPTIC = {
  addressed: 'knock',
  groupQuestion: 'ringing',
  done: 'completed',
  problem: 'angry_alert',
  gestureSeen: 'subtle_collision',
  waiting: 'knock', // fired twice: "knock knock, they're waiting for you"
  topic: 'damp_state_change'
} as const satisfies Record<string, Waveform>

/** The 4 signals as the user learns them (Check-up "Try the vibrations"). Played in order, 350 ms apart (haptics.ts). */
export const HAPTIC_PATTERNS = {
  name: { label: 'Your name', meaning: 'someone said your name or asked you', waveforms: [HAPTIC.addressed] },
  waiting: { label: "They're waiting for you", meaning: 'a question to you, then silence', waveforms: [HAPTIC.waiting, HAPTIC.waiting] },
  problem: { label: 'Problem', meaning: "your mic or camera has a problem, or they can't hear you", waveforms: [HAPTIC.problem] },
  fixed: { label: 'Fixed', meaning: 'the fix you clicked worked', waveforms: [HAPTIC.done] }
} as const satisfies Record<string, { label: string; meaning: string; waveforms: readonly Waveform[] }>
export type HapticPattern = keyof typeof HAPTIC_PATTERNS

/** IPC channel names shared by main, preload and renderer. */
/** IT console (B, Nexthink track): device facts and counts only, from main/agent/it-stats.ts. */
export interface TicketFile {
  id: string
  createdAt: string
  priority: string
  requesterRole: string
  json: string
  /** Why it was sent (B: fix failed, still bad after switching, no other mic, repeats) */
  reason?: string
  /** Sent by Tap itself (true) or by the user's click */
  auto?: boolean
}
export interface CallReportFile {
  id: string
  endedAt: string
  priority: string
  problems: string[]
  fixes: number
  json: string
}

export interface ItSnapshot {
  since: string
  tiles: { caught: number; beforeNoticed: number; reported: number; fixed: number; secondsLost: number; medianFixS: number | null; solvedWithoutTicket: number; autoTickets: number }
  byType: { type: string; count: number }[]
  fixes: { label: string; used: number; checked: number; failed: number }[]
  agent: { actions: number; blockedCount: number; blocked: { at: string; text: string }[]; misfires: number; notNeeded: number; aiCalls: number; costUsd: number }
  tickets: TicketFile[]
  reports: CallReportFile[]
  recurring: { problem: string; calls: number; of: number; hint: string }[]
}

export const IPC = {
  event: 'tap:event', // renderer → main: TapEvent
  ui: 'tap:ui', // main → renderer: UiCommand
  audio: 'tap:audio', // renderer → main: { source, pcm: ArrayBuffer (Int16 mono 16 kHz) }
  overlayMouse: 'tap:overlay-mouse' // overlay → main: boolean (true = card under cursor, catch clicks)
} as const

export const now = (): number => Date.now() / 1000

export function makeEvent(type: EventType, source: Source, data?: Record<string, unknown>, confidence?: number): TapEvent {
  return { type, ts: now(), source, data, confidence }
}
