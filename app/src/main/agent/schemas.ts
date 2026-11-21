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

/** B's deterministic detectors (no LLM) that the checkup uses. Text is display-only. */
export const DetectorHit = z
  .object({
    type: z.enum(['OTHERS_CANT_HEAR', 'VIDEO_FROZEN_REPORTED']),
    text: z.string().max(LIMITS.transcriptChunk)
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
      untilTs: Ts, // attention back
      why: Why
    })
    .strict(),
  // Haptics come later: nothing requests one today, the path stays for the mouse.
  z.object({ action: z.literal('send_haptic'), waveform: z.enum(WAVEFORMS), why: Why }).strict(),
  z.object({ action: z.literal('dismiss_card'), cardId: z.string().max(LIMITS.id), why: Why }).strict()
])
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
    fallback: z.enum(['no_key', 'empty', 'short', 'timeout', 'auth', 'error', 'invalid', 'breaker']).optional()
  })
  .strict()

/** Executor → Monitor: what happened when an action ran (e.g. the haptic HTTP call failed). */
export const ActionResult = z.object({ action: z.enum(ALLOWED_ACTIONS), ok: z.boolean() }).strict()

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
  'action.result': { schema: ActionResult, provenance: ['system'] }
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
