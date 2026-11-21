/**
 * OWNER: C. Agent 1, Audio: call-audio transcript → `Summary`. The ONLY agent that calls the LLM.
 * Also the intake for B's deterministic detector events (name heard, can't hear you…) and mic level.
 * Its output is display-only: nothing it publishes can trigger an action (provenance transcript / llm).
 */
import type { EventType, TapEvent } from '../../shared/events.ts'
import { now } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import type { FallbackReason, Llm } from './llm.ts'
import { LIMITS, type PayloadOf, RawTapEvent } from './schemas.ts'
import { cleanText, looksLikeInstruction, MAX } from './sanitize.ts'

const KEEP_S = 30 * 60 // keep 30 min of transcript
const DETECTOR_EVENTS = ['NAME_MENTIONED', 'QUESTION_TO_YOU', 'QUESTION_TO_GROUP', 'OTHERS_CANT_HEAR', 'VIDEO_FROZEN_REPORTED'] as const

const FALLBACK_LOG: Partial<Record<FallbackReason, string>> = {
  timeout: 'AI took longer than 3 s → template summary (AI timeout)',
  error: 'AI offline → template summary',
  invalid: 'AI reply was not a valid summary → template summary',
  breaker: 'AI paused after repeated failures → template summary'
}

export class AudioAgent {
  private lines: { ts: number; text: string }[] = []
  private bus: AgentBus
  private llm: Llm
  private userName: string
  private report: Reporter

  constructor(events: EventBus, bus: AgentBus, llm: Llm, userName: string, report: Reporter) {
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
    const text = cleanText(raw.data?.text, MAX.transcriptChunk)
    if (!text) return
    const instructionLike = looksLikeInstruction(text)
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
    this.bus.publish('detector', 'detector', 'detector', { type, text: cleanText(raw.data?.text, MAX.transcriptChunk) })
  }

  private onMicLevel(e: TapEvent): void {
    const raw = this.parse(e)
    if (!raw) return
    const rms = raw.data?.rms ?? 0
    this.bus.publish('audio', 'detector', 'mic', { rms: rms as number })
  }

  private textSince(ts: number): string {
    return this.lines
      .filter((l) => l.ts >= ts)
      .map((l) => l.text)
      .join('\n')
  }

  private async onRequest(req: PayloadOf<'summary.request'>): Promise<void> {
    const text = this.textSince(req.fromTs) || req.fallbackText
    const out = await this.llm.summarise(text, req.kind, this.userName)
    if (out.usedLlm) this.report.log('llm', `summary (${text.length} chars)`, out.costUsd)
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
