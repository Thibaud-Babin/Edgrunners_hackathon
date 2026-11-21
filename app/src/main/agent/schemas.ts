/**
 * OWNER: C. Internal message shapes between the four agents (doc §2). NOT the team contract (events.ts).
 * Every object is `.strict()`: unknown fields are rejected, not silently dropped.
 * Parse `unknown` with these at every boundary; never trust a TypeScript cast.
 */
import { z } from 'zod'
import { ALLOWED_ACTIONS, WAVEFORMS } from '../../shared/events.ts'

export const AGENTS = ['audio', 'vision', 'executor', 'monitor', 'user', 'detector'] as const
export const PROVENANCES = ['user', 'vision', 'detector', 'transcript', 'llm', 'system'] as const
export type AgentName = (typeof AGENTS)[number]
export type Provenance = (typeof PROVENANCES)[number]

export const LIMITS = {
  transcriptChunk: 4000,
  recapText: 280,
  awayText: 400,
  question: 140,
  topic: 40,
  topics: 5,
  label: 120,
  id: 64
} as const

const Id = z.string().min(1).max(LIMITS.id)
const Ts = z.number().finite().nonnegative()

// ---------- payloads ----------

/** The Audio agent's only output. No field can name an action. */
export const Summary = z
  .object({
    kind: z.enum(['recap', 'away']),
    text: z.string().max(LIMITS.awayText),
    askedYou: z.boolean(),
    question: z.string().min(1).max(LIMITS.question).optional(),
    topics: z.array(z.string().min(1).max(LIMITS.topic)).max(LIMITS.topics),
    source: z.enum(['cloud', 'template'])
  })
  .strict()
  .refine((s) => s.kind === 'away' || s.text.length <= LIMITS.recapText, {
    message: `recap text is over ${LIMITS.recapText} chars`,
    path: ['text']
  })
export type Summary = z.infer<typeof Summary>

/** What the LLM itself must return (kind and source are set by our code, never by the model). */
export const LlmSummaryOutput = z
  .object({
    text: z.string().max(LIMITS.awayText),
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

/** A deliberate input from the user: a click in Tap's UI or a gesture made on purpose. */
export const UserInput = z
  .object({
    input: z.enum(['click', 'nod', 'shake', 'brow_raise', 'tilt_left', 'tilt_right']),
    // Free string on purpose: the executor's allowlist (not the schema) rejects unknown actions, so it can log them.
    actionId: z.string().max(LIMITS.id).optional(),
    cardId: z.string().max(LIMITS.id).optional()
  })
  .strict()
export type UserInput = z.infer<typeof UserInput>

/** B's deterministic detectors (no LLM). Text is display-only. */
export const DetectorHit = z
  .object({
    type: z.enum(['NAME_MENTIONED', 'QUESTION_TO_YOU', 'QUESTION_TO_GROUP', 'OTHERS_CANT_HEAR', 'VIDEO_FROZEN_REPORTED']),
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
  z.object({ action: z.literal('show_recap'), fromTs: Ts, fallbackText: z.string().max(LIMITS.transcriptChunk), why: Why }).strict(),
  z.object({ action: z.literal('show_away_summary'), fromTs: Ts, trigger: z.enum(['name', 'looked_back']), why: Why }).strict(),
  z
    .object({
      action: z.literal('show_fix'),
      problem: z.string().max(LIMITS.label * 2),
      fixLabel: z.string().max(LIMITS.label),
      fixAction: z.enum(ALLOWED_ACTIONS),
      why: Why
    })
    .strict(),
  z.object({ action: z.literal('send_haptic'), waveform: z.enum(WAVEFORMS), why: Why }).strict(),
  z.object({ action: z.literal('switch_input_device'), prefer: z.enum(['laptop', 'headset']), why: Why }).strict(),
  z.object({ action: z.literal('dismiss_card'), cardId: z.string().max(LIMITS.id), why: Why }).strict(),
  z.object({ action: z.literal('post_chat_reply'), text: z.string().min(1).max(LIMITS.question), why: Why }).strict()
])
export type ActionRequest = z.infer<typeof ActionRequest>

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

/** Build a strict envelope schema for one payload type. */
export function envelopeOf<T extends z.ZodType>(payload: T) {
  return EnvelopeBase.extend({ payload })
}
