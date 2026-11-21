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
  | 'FACE_OUT_OF_FRAME'
  | 'LOW_LIGHT'
  // C — agent (fused)
  | 'MIC_SILENT_WHILE_SPEAKING'
  // D — UI
  | 'USER_CLICK'

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
    }
  | { type: 'SHOW_REPLIES'; id: string; question: string; replies: string[] }
  | { type: 'SHOW_REPLY'; id: string; text: string } // P1: what the user "said" with a gesture, e.g. "Yes"
  | { type: 'SWITCH_MIC'; prefer: 'laptop' | 'headset' } // agent → main window: restart the mic on another device
  | { type: 'SHOW_NUDGE'; id: string; text: string; question?: string } // "They're waiting for your answer"
  | { type: 'CAPTION'; text: string; final: boolean; speaker?: string; highlight?: string } // live captions (overlay)
  | { type: 'DISMISS'; id: string }
  | { type: 'FLASH'; reason: string }
  | { type: 'LOG_ENTRY'; entry: LogEntry }
  | { type: 'COUNTERS'; aiCalls: number; costUsd: number; events: number; blocked: number }

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
  'dismiss_card'
] as const
export type AllowedAction = (typeof ALLOWED_ACTIONS)[number]

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

/** Tap's haptic vocabulary (PRD §1). */
export const HAPTIC = {
  addressed: 'knock',
  groupQuestion: 'ringing',
  done: 'completed',
  problem: 'angry_alert',
  gestureSeen: 'subtle_collision',
  waiting: 'knock', // fired twice: "knock knock, they're waiting for you"
  topic: 'damp_state_change'
} as const satisfies Record<string, Waveform>

/** IPC channel names shared by main, preload and renderer. */
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
