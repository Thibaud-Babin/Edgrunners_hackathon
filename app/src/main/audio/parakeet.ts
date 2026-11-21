/**
 * OWNER: B. Local speech-to-text fallback: NVIDIA Parakeet TDT 0.6B v2 (int8) via sherpa-onnx + Silero VAD.
 * TAP_STT=parakeet, or automatic when Deepgram is unavailable (no key, no internet). `npm run setup-stt` downloads it.
 *
 * Parakeet is an offline (non-streaming) model, so:
 *  - Silero VAD cuts the call audio into sentences → each sentence is decoded once → FINAL;
 *  - while someone is speaking, the sentence so far is re-decoded about every 0.8 s → PARTIAL,
 *    so the name can still be caught before the sentence ends (knock latency).
 * Decoding uses decodeAsync (worker thread inside sherpa-onnx), so Electron's main process never freezes.
 * Real call test (2026-11-21): sentences ✓, names 5/7 with the context rule, ~0.8 s per sentence.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Source } from '../../shared/events'
import type { OnText, SttEngine } from './pipeline'

const MODELS = resolve('models')
const MODEL_DIR = process.env.TAP_PARAKEET_MODEL || join(MODELS, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8')
const VAD_MODEL = join(MODELS, 'silero_vad.onnx')
const SR = 16000
const WINDOW = 512 // Silero VAD window (samples)
const PARTIAL_EVERY_MS = 800
const PREROLL = Math.round(0.3 * SR) // keep 0.3 s before speech is detected (VAD reacts a little late)

/* eslint-disable @typescript-eslint/no-explicit-any */
let sherpa: any = null
let recognizer: any = null

export function parakeetInstalled(): boolean {
  return existsSync(join(MODEL_DIR, 'encoder.int8.onnx')) && existsSync(VAD_MODEL)
}

/** Loads the model once (~3–6 s, blocks). Call at startup so the switch to local is instant. */
export function loadParakeet(): void {
  if (recognizer) return
  if (!parakeetInstalled()) throw new Error(`Parakeet model or silero_vad.onnx missing in ${MODELS} — run: npm run setup-stt`)
  sherpa ??= require('sherpa-onnx-node')
  const t = Date.now()
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(MODEL_DIR, 'encoder.int8.onnx'),
        decoder: join(MODEL_DIR, 'decoder.int8.onnx'),
        joiner: join(MODEL_DIR, 'joiner.int8.onnx')
      },
      tokens: join(MODEL_DIR, 'tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: 2,
      provider: 'cpu'
    }
  })
  console.log(`[stt] parakeet loaded in ${((Date.now() - t) / 1000).toFixed(1)} s`)
}

const FILLERS = new Set(['the', 'a', 'and', 'uh', 'um', 'mm', 'hmm', 'oh', 'yeah', 'you', 'people', 'i'])

function clean(text: string): string {
  const t = text.trim()
  const words = t.toLowerCase().replace(/[^a-z' ]/g, '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1 && FILLERS.has(words[0])) return '' // VAD noise often decodes to one filler word
  return t
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function createParakeetEngine(source: Source, onText: OnText): SttEngine {
  loadParakeet()
  const vad = new sherpa.Vad(
    {
      sileroVad: { model: VAD_MODEL, threshold: 0.5, minSilenceDuration: 0.8, minSpeechDuration: 0.25, windowSize: WINDOW, maxSpeechDuration: 15 },
      sampleRate: SR,
      numThreads: 1,
      debug: 0
    },
    60
  )

  let pending = new Float32Array(0) // samples not yet fed to the VAD (< one window)
  let preroll: Float32Array[] = [] // last ~0.3 s while silent
  let speech: Float32Array[] = [] // the sentence so far, while speaking
  let speaking = false
  let speechStartWall = 0 // when the current sentence started (wall clock ms), for the knock-speed measure
  let lastPartialAt = 0
  let partialBusy = false
  let queue: Promise<void> = Promise.resolve() // finals decoded in order
  let sentenceId = 0
  let stopped = false

  const decode = async (samples: Float32Array): Promise<string> => {
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples, sampleRate: SR })
    const r = await recognizer.decodeAsync(stream)
    return String(r?.text ?? '')
  }

  const partial = (): void => {
    if (partialBusy || Date.now() - lastPartialAt < PARTIAL_EVERY_MS) return
    const audio = concat(speech)
    if (audio.length < 0.6 * SR) return
    partialBusy = true
    lastPartialAt = Date.now()
    const id = sentenceId
    const startWall = speechStartWall
    void decode(audio)
      .then((text) => {
        const t = clean(text)
        if (t && id === sentenceId && !stopped) onText(t, false, { speechStartWall: startWall }) // drop if the sentence already ended
      })
      .catch((err) => console.warn('[stt] parakeet partial failed:', err))
      .finally(() => (partialBusy = false))
  }

  const final = (samples: Float32Array): void => {
    sentenceId++
    const startWall = speechStartWall || Date.now() - (samples.length / SR) * 1000
    queue = queue.then(async () => {
      try {
        const t = clean(await decode(samples))
        if (t && !stopped) onText(t, true, { speechStartWall: startWall })
      } catch (err) {
        console.warn('[stt] parakeet decode failed:', err)
      }
    })
  }

  return {
    push(pcm: Int16Array): void {
      const f = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768
      const all = new Float32Array(pending.length + f.length)
      all.set(pending)
      all.set(f, pending.length)

      let i = 0
      for (; i + WINDOW <= all.length; i += WINDOW) {
        const win = all.slice(i, i + WINDOW)
        vad.acceptWaveform(win)
        if (vad.isDetected()) {
          if (!speaking) {
            speaking = true
            speechStartWall = Date.now() - ((preroll.length + 1) * WINDOW * 1000) / SR - 300 // VAD reacts ~0.3 s late
            speech = [...preroll]
            lastPartialAt = Date.now()
          }
          speech.push(win)
        } else if (!speaking) {
          preroll.push(win)
          while (preroll.length * WINDOW > PREROLL) preroll.shift()
        }
        while (!vad.isEmpty()) {
          const seg = vad.front(false) // false: Electron forbids external buffers (crashed the main process)
          vad.pop()
          final(new Float32Array(seg.samples))
          speaking = false
          speech = []
          preroll = []
        }
      }
      pending = all.slice(i)
      if (speaking) partial()
    },
    stop(): void {
      stopped = true
      vad.flush()
      while (!vad.isEmpty()) vad.pop()
    }
  }
}
