/**
 * OWNER: B. Audio → text → events.
 *
 * Renderer captures audio (src/renderer/src/audio.ts) and sends 100 ms Int16 mono 16 kHz chunks over IPC.
 * pushPcm() hands them to the speech-to-text engine; its results go through onText(),
 * which runs the detectors and publishes TRANSCRIPT_* / NAME_MENTIONED / QUESTION_* / OTHERS_CANT_HEAR
 * and (Sat evening) WAITING_FOR_YOU / TOPIC_MENTIONED / INSTRUCTION_LIKE_SPEECH / MIC_QUALITY / STT_USAGE.
 *
 * B only DETECTS and MEASURES. The agent (C) decides what to do; the UI (D) shows it.
 * The dev text box and mock mode call onText() directly, so A, C and D can work without audio.
 */
import type { Source } from '../../shared/events'
import { makeEvent } from '../../shared/events'
import type { EventBus } from '../bus'
import { addressesSomeone, findAddressed, findName, findTopic, findTrouble, isInstructionLike, isQuestion, normalise } from '../detectors/text'
import { createSherpaEngine, loadSherpa } from './sherpa'
import { Recorder } from './recorder'
import { createDeepgramEngine, deepgramAvailable } from './deepgram'
import { createParakeetEngine, loadParakeet, parakeetInstalled } from './parakeet'
import { MicQualityMeter } from './mic-quality'
import type { SpeakerNames } from './speaker-names'

export interface SttEngine {
  /** feed 16 kHz mono Int16 PCM */
  push(pcm: Int16Array): void
  stop(): void
}

/** Extra details an engine may give with a result (all optional). */
export interface SttMeta {
  /** diarization: speaker index of this sentence (0, 1, …) */
  speaker?: number
  /** word timings in seconds of audio since the stream started */
  words?: Array<{ word: string; start: number; end: number; speaker?: number }>
  /** converts "seconds of audio since stream start" to wall-clock ms (when that audio was captured) */
  wallAt?: (audioSec: number) => number
  /** wall-clock ms when this sentence started (engines without word timings) */
  speechStartWall?: number
}

export type OnText = (text: string, final: boolean, meta?: SttMeta) => void
export type SttFactory = (source: Source, onText: OnText) => SttEngine

/** Status lines for the activity panel ("Speech: Deepgram → local Parakeet (no internet)"). */
let statusSink: (text: string) => void = (t) => console.log(`[stt] ${t}`)
export function onSttStatus(fn: (text: string) => void): void {
  statusSink = fn
}
/** Which engine is transcribing right now (for STT_USAGE). */
let currentEngine = 'none'

function tryLoadParakeet(): boolean {
  if (!parakeetInstalled()) return false
  try {
    loadParakeet()
    return true
  } catch (err) {
    console.error('[stt] parakeet failed to load:', err)
    return false
  }
}

/**
 * Deepgram first; if it dies mid-call (Wi-Fi off) or can't connect, switch THIS source to local Parakeet
 * without restarting. Parakeet is pre-loaded at startup so the switch is instant.
 */
function deepgramWithFallback(localReady: boolean): SttFactory {
  return (source, onText) => {
    let current: SttEngine
    current = createDeepgramEngine(source, onText, (reason) => {
      if (!localReady) {
        currentEngine = 'none'
        statusSink(`Speech: Deepgram lost (${reason}), no local model installed → transcript stopped`)
        return
      }
      currentEngine = 'parakeet'
      statusSink(`Speech: Deepgram lost (${reason}) → switched to local Parakeet`)
      current = createParakeetEngine(source, onText)
    })
    return {
      push: (pcm) => current.push(pcm),
      stop: () => current.stop()
    }
  }
}

/** TAP_STT: deepgram (recommended, falls back to parakeet) | parakeet | sherpa | none */
export function createStt(kind: string): SttFactory | null {
  if (kind === 'none') return null
  if (kind === 'sherpa') {
    try {
      loadSherpa() // load now (~6 s) so the first sentence isn't delayed
      currentEngine = 'sherpa'
      return createSherpaEngine
    } catch (err) {
      console.error('[stt] sherpa-onnx failed to load — falling back to the dev text box only:', err)
      return null
    }
  }
  if (kind === 'deepgram') {
    const localReady = tryLoadParakeet() // pre-load the fallback (~5 s at startup)
    if (deepgramAvailable()) {
      currentEngine = 'deepgram'
      statusSink(`Speech: Deepgram (cloud)${localReady ? ', local Parakeet ready as fallback' : ''}`)
      return deepgramWithFallback(localReady)
    }
    if (localReady) {
      currentEngine = 'parakeet'
      statusSink('Speech: no DEEPGRAM_API_KEY → local Parakeet')
      return createParakeetEngine
    }
    statusSink('Speech: no DEEPGRAM_API_KEY and no Parakeet → old local model')
    return createStt('sherpa')
  }
  if (kind === 'parakeet') {
    if (tryLoadParakeet()) {
      currentEngine = 'parakeet'
      statusSink('Speech: local Parakeet')
      return createParakeetEngine
    }
    return createStt('sherpa')
  }
  console.warn(`[stt] engine "${kind}" not implemented yet — use the dev text box or --mock`)
  return null
}

// ---------- tuning ----------
const WAIT_SILENCE_S = Number(process.env.TAP_WAIT_SILENCE_S || 2.5) // after a question to you, silence → WAITING_FOR_YOU
const USER_SPEAKING_RMS = 0.02 // mic chunk louder than this = the user is talking (answering)
const TOPICS = (process.env.TAP_TOPICS ?? 'deadline,action item,budget').split(',').map((s) => s.trim()).filter(Boolean)
const TOPIC_COOLDOWN_MS = 60_000
const USAGE_EVERY_MS = 30_000
// USD per minute of streamed audio. TODO(B): check deepgram.com/pricing for nova-3 streaming; local engines are free.
const PRICE_PER_MIN: Record<string, number> = { deepgram: Number(process.env.TAP_STT_PRICE_PER_MIN || 0.0077) }

const debug = (msg: string): void => {
  if (process.env.TAP_DEBUG_AUDIO !== '0') console.log(`[stt ${Date.now()}] ${msg}`)
}

export class AudioPipeline {
  private engines = new Map<Source, SttEngine>()
  private nameFiredThisSentence = false
  private recorder = process.env.TAP_RECORD === '1' ? new Recorder() : null
  private micMeter = new MicQualityMeter((q) => {
    debug(`MIC_QUALITY ${q.level} (speech ${q.speech_rms}, noise ${q.noise_rms}, clipped ${q.clipped_pct} %)`)
    this.bus.publish(makeEvent('MIC_QUALITY', 'mic', { ...q }))
  })

  // "They're waiting for you": armed by a question to you, cancelled by more call speech or the user talking.
  private waiting: { question: string; at: number; timer: ReturnType<typeof setTimeout> } | null = null
  private lastUserSpeechAt = 0
  private lastMicChunkAt = 0

  private topicLastAt = new Map<string, number>()
  private usage = { seconds: 0, costUsd: 0, lastPublish: Date.now() }

  constructor(
    private bus: EventBus,
    private names: string[],
    private stt: SttFactory | null
  ) {}

  /** B: real names from Google Meet (speaker-names.ts), when the extension is connected. */
  speakerNames: SpeakerNames | null = null

  // Audio level check — prints once per second per source, only with TAP_DEBUG_LEVELS=1 (it flooded the terminal)
  private stats = new Map<Source, { bytes: number; peak: number; since: number }>()

  pushPcm(source: Source, pcm: Int16Array): void {
    if (process.env.TAP_DEBUG_LEVELS === '1') {
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

    this.recorder?.push(source, pcm)

    if (source === 'mic') {
      this.micMeter.push(pcm)
      this.lastMicChunkAt = Date.now()
      let sum = 0
      for (const v of pcm) sum += (v / 32768) ** 2
      if (Math.sqrt(sum / pcm.length) > USER_SPEAKING_RMS) {
        this.lastUserSpeechAt = Date.now()
        this.cancelWaiting('user answered')
      }
    }

    if (!this.stt) return
    // Only the OTHER people are transcribed (detectors ignore the mic). TAP_STT_MIC=1 to transcribe the mic too.
    if (source !== 'call_audio' && process.env.TAP_STT_MIC !== '1') return
    let engine = this.engines.get(source)
    if (!engine) {
      engine = this.stt(source, (text, final, meta) => this.onText(source, text, final, meta))
      this.engines.set(source, engine)
    }
    engine.push(pcm)
    if (source === 'call_audio') this.countUsage(pcm.length / 16000)
  }

  /** Called by the STT engine (or the dev text box / mock) for every result. */
  onText(source: Source, text: string, final: boolean, meta?: SttMeta): void {
    if (!text.trim()) return
    let speaker = meta?.speaker !== undefined ? `Speaker ${meta.speaker + 1}` : undefined
    // B: a finished sentence gets the name Meet showed as speaking during it (partials keep the number)
    if (final && this.speakerNames) {
      const w = meta?.words
      const from = w?.length && meta?.wallAt ? meta.wallAt(w[0]!.start) : (meta?.speechStartWall ?? Date.now() - 2000)
      const to = w?.length && meta?.wallAt ? meta.wallAt(w[w.length - 1]!.end) : Date.now()
      speaker = this.speakerNames.label(meta?.speaker, from, to)
    }
    if (final) debug(`${source} FINAL${speaker ? ` [${speaker}]` : ''}: ${text}`)
    this.bus.publish(makeEvent(final ? 'TRANSCRIPT_FINAL' : 'TRANSCRIPT_PARTIAL', source, { text, speaker }))
    // Detectors only look at OTHER people (call audio).
    if (source !== 'call_audio') return

    // Someone kept talking: they're not waiting for the user (partials count, so it reacts fast).
    if (this.waiting && Date.now() - this.waiting.at > 800) this.cancelWaiting('call continued')

    // Name: checked on PARTIAL results too, so the knock comes while the sentence is still being said.
    // Fires once per sentence (reset on the final result).
    // The name only counts when the sentence speaks TO someone (question, "you", or the name opens the sentence):
    // removes "let's talk about the [table→tibo]" false alerts. On the final result, also try the vocative
    // rule for names the transcriber mangled ("hey bo, are you still here?").
    let name = findName(text, this.names)
    if (name && !addressesSomeone(text, name.word)) name = null
    if (!name && final) name = findAddressed(text, this.names)
    if (name && !this.nameFiredThisSentence) {
      this.nameFiredThisSentence = true
      const lat = this.latency(name.word, meta)
      debug(`NAME_MENTIONED (${final ? 'final' : 'partial'}) "${name.word}"${lat ? ` ${lat.latency_s} s after the ${lat.latency_ref === 'name_word' ? 'name' : 'sentence start'}` : ''} in: ${text}`)
      this.bus.publish(makeEvent('NAME_MENTIONED', source, { text, speaker, matched: name.word, partial: !final, ...lat }, name.score))
    }
    if (!final) return

    const addressed = this.nameFiredThisSentence
    this.nameFiredThisSentence = false
    if (addressed) {
      if (isQuestion(text)) {
        this.bus.publish(makeEvent('QUESTION_TO_YOU', source, { text, speaker }))
        this.armWaiting(text)
      }
    } else if (isQuestion(text) && /\b(anyone|everyone|guys|team|all|tout le monde|quelqu'un)\b/i.test(text)) {
      this.bus.publish(makeEvent('QUESTION_TO_GROUP', source, { text, speaker }))
    }
    const trouble = findTrouble(text)
    if (trouble === 'cant_hear') this.bus.publish(makeEvent('OTHERS_CANT_HEAR', source, { text, speaker }))
    if (trouble === 'frozen') this.bus.publish(makeEvent('VIDEO_FROZEN_REPORTED', source, { text, speaker }))

    const topic = findTopic(text, TOPICS)
    if (topic && Date.now() - (this.topicLastAt.get(topic) ?? 0) > TOPIC_COOLDOWN_MS) {
      this.topicLastAt.set(topic, Date.now())
      debug(`TOPIC_MENTIONED "${topic}"`)
      this.bus.publish(makeEvent('TOPIC_MENTIONED', source, { topic, text, speaker }))
    }
    if (isInstructionLike(text)) {
      debug(`INSTRUCTION_LIKE_SPEECH: ${text}`)
      this.bus.publish(makeEvent('INSTRUCTION_LIKE_SPEECH', source, { text, speaker }))
    }
  }

  /** Knock speed: seconds from the name being SPOKEN to now (≈ when the knock fires). */
  private latency(nameWord: string, meta?: SttMeta): { latency_s: number; latency_ref: 'name_word' | 'sentence_start' } | undefined {
    if (meta?.words?.length && meta.wallAt) {
      const target = normalise(nameWord).replace(/ /g, '')
      const ws = meta.words
      let hit = ws.find((w) => normalise(w.word).replace(/ /g, '') === target)
      // glued pair ("hey bo" → "heybo")
      if (!hit) hit = ws.find((w, i) => i + 1 < ws.length && normalise(w.word + ws[i + 1].word).replace(/ /g, '') === target)
      if (hit) return { latency_s: +((Date.now() - meta.wallAt(hit.start)) / 1000).toFixed(2), latency_ref: 'name_word' }
    }
    if (meta?.speechStartWall) return { latency_s: +((Date.now() - meta.speechStartWall) / 1000).toFixed(2), latency_ref: 'sentence_start' }
    return undefined
  }

  private armWaiting(question: string): void {
    this.cancelWaiting()
    const at = Date.now()
    this.waiting = {
      question,
      at,
      timer: setTimeout(() => {
        if (!this.waiting || this.waiting.at !== at) return
        this.waiting = null
        if (this.lastUserSpeechAt > at) return // the user already answered
        const micMonitored = Date.now() - this.lastMicChunkAt < 1500
        debug(`WAITING_FOR_YOU (${WAIT_SILENCE_S} s of silence after: ${question})${micMonitored ? '' : ' [mic not monitored: maybe they answered]'}`)
        this.bus.publish(makeEvent('WAITING_FOR_YOU', 'call_audio', { question, silent_s: WAIT_SILENCE_S, mic_monitored: micMonitored }))
      }, WAIT_SILENCE_S * 1000)
    }
  }

  private cancelWaiting(_why?: string): void {
    if (!this.waiting) return
    clearTimeout(this.waiting.timer)
    this.waiting = null
  }

  private countUsage(seconds: number): void {
    this.usage.seconds += seconds
    this.usage.costUsd += (seconds / 60) * (PRICE_PER_MIN[currentEngine] ?? 0)
    if (Date.now() - this.usage.lastPublish < USAGE_EVERY_MS) return
    this.usage.lastPublish = Date.now()
    this.bus.publish(
      makeEvent('STT_USAGE', 'call_audio', { engine: currentEngine, seconds: Math.round(this.usage.seconds), cost_usd: +this.usage.costUsd.toFixed(4) })
    )
  }

  stop(): void {
    this.cancelWaiting()
    for (const e of this.engines.values()) e.stop()
    this.recorder?.close()
    this.engines.clear()
  }
}
