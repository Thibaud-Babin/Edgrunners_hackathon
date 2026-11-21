/**
 * OWNER: C. Agent 1, Audio: call-audio transcript → `Summary` of the time the user was not paying attention.
 * The ONLY agent that calls the LLM.
 * Also the intake for B's deterministic detector events (name heard, can't hear you…) and mic level.
 * Its output is display-only: nothing it publishes can trigger an action (provenance transcript / llm).
 */
import type { EventType, TapEvent } from '../../shared/events.ts'
import { now } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import type { FallbackReason, Llm } from './llm.ts'
import { RoleState } from './permissions.ts'
import { DETECTOR_TYPES, type DetectorHit, LIMITS, type PayloadOf, RawTapEvent } from './schemas.ts'
import { cleanText, looksLikeInstruction, MAX } from './sanitize.ts'

const KEEP_S = 30 * 60 // keep 30 min of transcript
// B's detector events the agents use (rules and checkup).
const DETECTOR_EVENTS = DETECTOR_TYPES
// Which data field holds the display text of each detector event (B's contract, events.ts).
const DETECTOR_TEXT: Record<(typeof DETECTOR_EVENTS)[number], string> = {
  NAME_MENTIONED: 'text',
  QUESTION_TO_GROUP: 'text',
  OTHERS_CANT_HEAR: 'text',
  VIDEO_FROZEN_REPORTED: 'text',
  WAITING_FOR_YOU: 'question',
  TOPIC_MENTIONED: 'topic',
  MIC_QUALITY: 'level',
  MIC_STATE: 'name'
}

const FALLBACK_LOG: Partial<Record<FallbackReason, string>> = {
  timeout: 'AI took longer than 3 s → template summary (AI timeout)',
  auth: 'AI key refused (401/403) → template summary; check ANTHROPIC_API_KEY in app/.env',
  error: 'AI offline → template summary',
  invalid: 'AI reply was not a valid summary → template summary',
  breaker: 'AI paused after repeated failures → template summary'
}

export class AudioAgent {
  private lines: { ts: number; text: string }[] = []
  private speakers = new Set<string>()
  private bus: AgentBus
  private llm: Llm
  private userName: string
  private report: Reporter
  private roles: RoleState

  constructor(events: EventBus, bus: AgentBus, llm: Llm, userName: string, report: Reporter, roles: RoleState = new RoleState()) {
    this.roles = roles
    this.bus = bus
    this.llm = llm
    this.userName = userName
    this.report = report
    events.on('TRANSCRIPT_FINAL', (e) => this.onTranscript(e))
    for (const t of DETECTOR_EVENTS) events.on(t, (e) => this.onDetector(e, t))
    events.on('MIC_LEVEL', (e) => this.onMicLevel(e))
    bus.on('summary.request', (e) => void this.onRequest(e.payload))
  }

  private parse(e: TapEvent): ReturnType<typeof RawTapEvent.parse> | null {
    const raw = RawTapEvent.safeParse(e)
    if (!raw.success) this.report.invalid(`${String((e as { type?: unknown })?.type)} event with a bad shape`)
    return raw.success ? raw.data : null
  }

  private onTranscript(e: TapEvent): void {
    const raw = this.parse(e)
    if (!raw || raw.source !== 'call_audio') return
    const said = cleanText(raw.data?.text, MAX.transcriptChunk)
    if (!said) return
    const instructionLike = looksLikeInstruction(said)
    // Speaker labels (B: Deepgram diarization) let the recap say who asked. Only once 2+ voices were heard:
    // with one voice, "Speaker 1:" just adds noise. Speaker names are untrusted text too.
    const speaker = cleanText(raw.data?.speaker, MAX.speakerName)
    if (speaker) this.speakers.add(speaker)
    const text = speaker && this.speakers.size >= 2 ? `${speaker}: ${said}` : said
    this.lines.push({ ts: raw.ts, text })
    const cutoff = now() - KEEP_S
    this.lines = this.lines.filter((l) => l.ts >= cutoff)
    this.bus.publish('audio', 'transcript', 'transcript', { text, instructionLike })
    // Log-only flag: security does not depend on it. Speech can never trigger an action anyway.
    if (instructionLike) this.report.log('decision', "Instruction-like speech ignored, speech can't trigger actions")
  }

  private onDetector(e: TapEvent, type: (typeof DETECTOR_EVENTS)[number] & EventType): void {
    const raw = this.parse(e)
    if (!raw) return
    const hit: DetectorHit = { type, text: cleanText(raw.data?.[DETECTOR_TEXT[type]], MAX.transcriptChunk) }
    if (type === 'NAME_MENTIONED') {
      // Only fields that pass as the right type are kept: the bus schema rejects the rest anyway.
      const d = raw.data ?? {}
      if (typeof d.partial === 'boolean') hit.partial = d.partial
      if (typeof d.latency_s === 'number' && d.latency_s >= 0 && d.latency_s <= 60) hit.latencyS = d.latency_s
      if (d.latency_ref === 'name_word' || d.latency_ref === 'sentence_start') hit.latencyRef = d.latency_ref
    }
    if (type === 'MIC_STATE') {
      // B's Windows mic state. Same rule: keep only fields of the right type.
      const d = raw.data ?? {}
      if (d.kind === 'laptop' || d.kind === 'headset') hit.micKind = d.kind
      if (typeof d.muted === 'boolean') hit.muted = d.muted
      if (typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1) hit.volume = d.volume
      if (d.other_kind === 'laptop' || d.other_kind === 'headset') hit.otherKind = d.other_kind
    }
    this.bus.publish('detector', 'detector', 'detector', hit)
  }

  private onMicLevel(e: TapEvent): void {
    const raw = this.parse(e)
    if (!raw) return
    const rms = raw.data?.rms ?? 0
    this.bus.publish('audio', 'detector', 'mic', { rms: rms as number })
  }

  /** Only what was said between `from` and `until`: the time the user was not paying attention. */
  private textBetween(from: number, until: number): string {
    return this.lines
      .filter((l) => l.ts >= from && l.ts <= until)
      .map((l) => l.text)
      .join('\n')
  }

  private async onRequest(req: PayloadOf<'summary.request'>): Promise<void> {
    const text = this.textBetween(req.fromTs, req.untilTs)
    const out = await this.llm.summarise(text, this.userName)
    // Every paid call is logged with its cost, including one whose reply was invalid.
    if (out.usedLlm || out.costUsd > 0) {
      const cost = out.costUsd.toFixed(5)
      this.report.log('llm', `AI recap of ${text.length} chars (${this.llm.modelName}) → cost ${cost} USD`, out.costUsd)
    }
    const why = out.fallback && FALLBACK_LOG[out.fallback]
    if (why) this.report.log('error', why)
    this.bus.publish('audio', out.usedLlm ? 'llm' : 'transcript', 'summary', {
      requestId: req.requestId,
      summary: out.summary,
      transcript: text.length <= LIMITS.cardTranscript ? text : text.slice(text.length - LIMITS.cardTranscript),
      costUsd: out.costUsd,
      usedLlm: out.usedLlm,
      ...(out.fallback ? { fallback: out.fallback } : {})
    })
  }
}
