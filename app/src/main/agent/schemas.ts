/**
 * OWNER: C. Internal message shapes between the four agents (doc §2). NOT the team contract (events.ts).
 * Every object is `.strict()`: unknown fields are rejected, not silently dropped.
 * Parse `unknown` with these at every boundary; never trust a TypeScript cast.
 */
import { z } from 'zod'
import { ALLOWED_ACTIONS, WAVEFORMS } from '../../shared/events.ts'
import { MAX } from './sanitize.ts'

export const AGENTS = ['audio', 'vision', 'executor', 'monitor', 'user', 'detector'] as const
export const PROVENANCES = ['user', 'vision', 'detector', 'transcript', 'llm', 'system'] as const
export type AgentName = (typeof AGENTS)[number]
export type Provenance = (typeof PROVENANCES)[number]

export const LIMITS = {
  transcriptChunk: MAX.transcriptChunk, // one source: what cleanText() caps to
  awayText: 400,
  question: 140,
  topic: 40,
  topics: 5,
  id: 64,
  cardTranscript: 20000
} as const

const Id = z.string().min(1).max(LIMITS.id)
const Ts = z.number().finite().nonnegative()

// ---------- payloads ----------

/** The Audio agent's only output. No field can name an action. */
export const Summary = z
  .object({
    text: z.string().max(LIMITS.awayText),
    askedYou: z.boolean(),
    question: z.string().min(1).max(LIMITS.question).optional(),
    topics: z.array(z.string().min(1).max(LIMITS.topic)).max(LIMITS.topics),
    source: z.enum(['cloud', 'template'])
  })
  .strict()
export type Summary = z.infer<typeof Summary>

/** What the LLM itself must return (`source` is set by our code, never by the model). */
export const LlmSummaryOutput = z
  .object({
    // min(1): Haiku once returned an empty summary (seen by B); an empty card is worse than the template.
    text: z.string().trim().min(1).max(LIMITS.awayText),
    askedYou: z.boolean(),
    question: z.string().max(LIMITS.question).nullable().optional(),
    topics: z.array(z.string().min(1).max(LIMITS.topic)).max(LIMITS.topics)
  })
  .strict()

/** Vision agent output: enums, booleans and numbers only, never free text. */
export const VisionSignal = z
  .object({
    signal: z.enum(['away', 'back', 'mouth', 'camera_frozen', 'face_out_of_frame', 'low_light']),
    active: z.boolean().optional(),
    reason: z.enum(['turned_away', 'no_face']).optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict()
export type VisionSignal = z.infer<typeof VisionSignal>

/** A deliberate input from the user: a click in Tap's UI (e.g. dismissing a card). */
export const UserInput = z
  .object({
    input: z.enum(['click']),
    // Free string on purpose: the executor's allowlist (not the schema) rejects unknown actions, so it can log them.
    actionId: z.string().max(LIMITS.id).optional(),
    cardId: z.string().max(LIMITS.id).optional()
  })
  .strict()
export type UserInput = z.infer<typeof UserInput>

export const DETECTOR_TYPES = [
  'NAME_MENTIONED',
  'QUESTION_TO_GROUP',
  'WAITING_FOR_YOU',
  'TOPIC_MENTIONED',
  'OTHERS_CANT_HEAR',
  'VIDEO_FROZEN_REPORTED',
  'MIC_QUALITY',
  'MIC_STATE'
] as const

/**
 * B's deterministic detectors (no LLM). Text is display-only.
 * `text`: the sentence; for WAITING_FOR_YOU the question to the user, TOPIC_MENTIONED the topic word,
 * MIC_QUALITY the level (ok / too_quiet / clipping / noisy).
 * NAME_MENTIONED also: `partial` (heard before the sentence ended) and B's knock latency.
 * MIC_STATE (the Windows default mic): `text` is its name, plus kind, muted, volume and the kind of another mic, if any.
 */
export const DetectorHit = z
  .object({
    type: z.enum(DETECTOR_TYPES),
    text: z.string().max(LIMITS.transcriptChunk),
    partial: z.boolean().optional(),
    latencyS: z.number().finite().nonnegative().max(60).optional(),
    latencyRef: z.enum(['name_word', 'sentence_start']).optional(),
    micKind: z.enum(['laptop', 'headset']).optional(),
    muted: z.boolean().optional(),
    volume: z.number().finite().min(0).max(1).optional(),
    otherKind: z.enum(['laptop', 'headset']).optional()
  })
  .strict()
export type DetectorHit = z.infer<typeof DetectorHit>

/**
 * What the rules ask the executor to do. One variant per action, each strict.
 * `why` is our own code-written reason, used for the judges' log.
 */
const Why = z.string().max(200)
export const ActionRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('show_away_summary'),
      fromTs: Ts, // attention lost
      untilTs: Ts, // attention back, or when the name was said
      trigger: z.enum(['looked_back', 'name']),
      waitSentenceEnd: z.boolean(), // the name was heard mid-sentence: show the card when the sentence ends
      why: Why
    })
    .strict(),
  // Name said while paying attention: recap of the last few seconds, incl. the question to the user.
  z.object({ action: z.literal('show_recap'), fromTs: Ts, waitSentenceEnd: z.boolean(), why: Why }).strict(),
  // "They're waiting for your answer" (B's WAITING_FOR_YOU): a nudge card, display only.
  z.object({ action: z.literal('show_nudge'), question: z.string().max(LIMITS.question), why: Why }).strict(),
  // A problem card with one button. Only the user's click on the button runs `fixAction`.
  z
    .object({
      action: z.literal('show_fix'),
      problem: z.string().max(LIMITS.question * 2),
      fixLabel: z.string().max(60),
      fixAction: z.enum(['switch_input_device', 'fix_mic', 'dismiss_card']),
      // Optional second button (instead of "Not now"), e.g. "I'm muted on purpose".
      altLabel: z.string().max(60).optional(),
      altAction: z.enum(['snooze_mic_alerts', 'dismiss_card']).optional(),
      // Device problem: also offer "Send diagnostics to IT".
      itTicket: z.boolean().optional(),
      why: Why
    })
    .strict(),
  // The user's own device facts (never speech) to IT (T1, on click).
  z.object({ action: z.literal('open_it_ticket'), cardId: z.string().max(LIMITS.id), why: Why }).strict(),
  // The exact mic fix the card named (Windows level, so Meet hears it too). Only the user's click runs it.
  z
    .object({
      action: z.literal('fix_mic'),
      fix: z.enum(['unmute', 'switch', 'volume']),
      mic: z.enum(['laptop', 'headset']),
      why: Why
    })
    .strict(),
  // Changes the user's own device: the gate allows it only from the user's own click.
  z.object({ action: z.literal('switch_input_device'), prefer: z.enum(['laptop', 'headset']), why: Why }).strict(),
  z.object({ action: z.literal('send_haptic'), waveform: z.enum(WAVEFORMS), why: Why }).strict(),
  z.object({ action: z.literal('dismiss_card'), cardId: z.string().max(LIMITS.id), why: Why }).strict()
])

/** Every action the executor may run: the contract's allowlist (show_nudge is in it since the roles contract). */
export const AGENT_ACTIONS = ALLOWED_ACTIONS
export type ActionRequest = z.infer<typeof ActionRequest>

/** A cleaned call-audio transcript line. Display and summaries only: it can never trigger anything. */
export const TranscriptChunk = z
  .object({ text: z.string().max(LIMITS.transcriptChunk), instructionLike: z.boolean() })
  .strict()

export const MicLevel = z.object({ rms: z.number().finite().nonnegative() }).strict()

/** Executor → Audio agent: "summarise what was said between `fromTs` and `untilTs`". */
export const SummaryRequest = z
  .object({
    requestId: Id,
    fromTs: Ts,
    untilTs: Ts
  })
  .strict()

/** Audio agent → Executor. `transcript` is what the card shows under the summary (tail-capped). */
export const SummaryResult = z
  .object({
    requestId: Id,
    summary: Summary,
    transcript: z.string().max(LIMITS.cardTranscript),
    costUsd: z.number().finite().nonnegative(),
    usedLlm: z.boolean(),
    fallback: z.enum(['no_key', 'empty', 'short', 'confidential', 'timeout', 'auth', 'error', 'invalid', 'breaker']).optional()
  })
  .strict()

/** Executor → Monitor: what happened when an action ran (e.g. the haptic HTTP call failed). */
export const ActionResult = z.object({ action: z.enum(AGENT_ACTIONS), ok: z.boolean() }).strict()

/**
 * The agent bus registry: every envelope kind, its payload schema and the provenances it may carry.
 * A kind that is not listed here cannot be published.
 */
export const KINDS = {
  transcript: { schema: TranscriptChunk, provenance: ['transcript'] },
  detector: { schema: DetectorHit, provenance: ['detector'] },
  mic: { schema: MicLevel, provenance: ['detector'] },
  vision: { schema: VisionSignal, provenance: ['vision'] },
  user: { schema: UserInput, provenance: ['user'] },
  'summary.request': { schema: SummaryRequest, provenance: ['system'] },
  summary: { schema: SummaryResult, provenance: ['llm', 'transcript'] },
  'action.result': { schema: ActionResult, provenance: ['system'] },

} as const satisfies Record<string, { schema: z.ZodType; provenance: readonly Provenance[] }>
export type Kind = keyof typeof KINDS
export type PayloadOf<K extends Kind> = z.infer<(typeof KINDS)[K]['schema']>

/**
 * A raw TapEvent as it arrives from the renderer (IPC), the audio pipeline or mock mode.
 * Parsed at intake; `data` stays `unknown` until each intake picks the fields it needs.
 */
export const RawTapEvent = z
  .object({
    type: z.string().max(40),
    ts: Ts,
    source: z.enum(['call_audio', 'mic', 'webcam', 'ui', 'agent']),
    confidence: z.number().min(0).max(1).optional(),
    data: z.record(z.string(), z.unknown()).optional()
  })
  .strict()
export type RawTapEvent = z.infer<typeof RawTapEvent>

// ---------- envelope ----------

/** Every message on the agent bus. `payload` is checked against the schema registered for `kind`. */
export const EnvelopeBase = z
  .object({
    id: Id,
    ts: Ts,
    from: z.enum(AGENTS),
    provenance: z.enum(PROVENANCES),
    kind: z.string().min(1).max(40),
    payload: z.unknown()
  })
  .strict()

export interface Envelope<T = unknown> {
  id: string
  ts: number
  from: AgentName
  provenance: Provenance
  kind: string
  payload: T
}
