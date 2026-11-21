/**
 * OWNER: B. Audio → text → events.
 *
 * Renderer captures audio (src/renderer/src/audio.ts) and sends 100 ms Int16 mono 16 kHz chunks over IPC.
 * pushPcm() hands them to the speech-to-text engine; its results go through onText(),
 * which runs the detectors and publishes TRANSCRIPT_* / NAME_MENTIONED / QUESTION_* / OTHERS_CANT_HEAR.
 *
 * The dev text box and mock mode call onText() directly, so A, C and D can work without audio.
 */
import type { Source } from '../../shared/events'
import { makeEvent } from '../../shared/events'
import type { EventBus } from '../bus'
import { findName, findTrouble, isQuestion } from '../detectors/text'

export interface SttEngine {
  /** feed 16 kHz mono Int16 PCM */
  push(pcm: Int16Array): void
  stop(): void
}

export type SttFactory = (source: Source, onText: (text: string, final: boolean) => void) => SttEngine

/**
 * TODO(B): implement one of these and return it from createStt():
 *  - 'sherpa'   (primary, local): npm i sherpa-onnx-node, streaming Zipformer English model + keyword spotter
 *                for the name. See docs/research/build/audio_stt_keyword_spotting.md
 *  - 'deepgram' (fallback, cloud): WebSocket wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000
 *                &interim_results=true&punctuate=true&keyterm=Thibaud&keyterm=Tibo  (ONE keyterm param per variant)
 */
export function createStt(kind: string): SttFactory | null {
  if (kind === 'none') return null
  console.warn(`[stt] engine "${kind}" not implemented yet — use the dev text box or --mock`)
  return null
}

export class AudioPipeline {
  private engines = new Map<Source, SttEngine>()

  constructor(
    private bus: EventBus,
    private names: string[],
    private stt: SttFactory | null
  ) {}

  // TEMP audio check — prints once per second per source (set TAP_DEBUG_AUDIO=0 in .env to silence)
  private stats = new Map<Source, { bytes: number; peak: number; since: number }>()

  pushPcm(source: Source, pcm: Int16Array): void {
    if (process.env.TAP_DEBUG_AUDIO !== '0') {
      const s = this.stats.get(source) ?? { bytes: 0, peak: 0, since: Date.now() }
      s.bytes += pcm.byteLength
      for (const v of pcm) s.peak = Math.max(s.peak, Math.abs(v))
      if (Date.now() - s.since >= 1000) {
        console.log(`[audio] ${source}: ${s.bytes} B/s, peak ${s.peak}`)
        s.bytes = 0
        s.peak = 0
        s.since = Date.now()
      }
      this.stats.set(source, s)
    }

    if (!this.stt) return
    let engine = this.engines.get(source)
    if (!engine) {
      engine = this.stt(source, (text, final) => this.onText(source, text, final))
      this.engines.set(source, engine)
    }
    engine.push(pcm)
  }

  /** Called by the STT engine (or the dev text box / mock) for every result. */
  onText(source: Source, text: string, final: boolean): void {
    if (!text.trim()) return
    this.bus.publish(makeEvent(final ? 'TRANSCRIPT_FINAL' : 'TRANSCRIPT_PARTIAL', source, { text }))
    // Detectors only look at OTHER people (call audio), and only at final lines for now.
    // TODO(B): also check partials for the name to cut latency (debounce so it fires once).
    if (source !== 'call_audio' || !final) return

    const name = findName(text, this.names)
    if (name) {
      this.bus.publish(makeEvent('NAME_MENTIONED', source, { text, matched: name.word }, name.score))
      if (isQuestion(text)) this.bus.publish(makeEvent('QUESTION_TO_YOU', source, { text }))
    } else if (isQuestion(text) && /\b(anyone|everyone|guys|team|all)\b/i.test(text)) {
      this.bus.publish(makeEvent('QUESTION_TO_GROUP', source, { text }))
    }
    const trouble = findTrouble(text)
    if (trouble === 'cant_hear') this.bus.publish(makeEvent('OTHERS_CANT_HEAR', source, { text }))
    if (trouble === 'frozen') this.bus.publish(makeEvent('VIDEO_FROZEN_REPORTED', source, { text }))
  }

  stop(): void {
    for (const e of this.engines.values()) e.stop()
    this.engines.clear()
  }
}
