/**
 * OWNER: B. Local streaming speech-to-text with sherpa-onnx (runs on the laptop CPU, no internet).
 * Model: sherpa-onnx-streaming-zipformer-en-2023-06-26 (int8) in app/models/ — see app/README.md to download.
 * Measured on Thibaud's laptop: ~7x faster than real time with hotwords, first words ~1 s after speech starts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Source } from '../../shared/events'
import type { SttEngine } from './pipeline'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const MODEL_DIR = process.env.TAP_SHERPA_MODEL || resolve('models', 'sherpa-onnx-streaming-zipformer-en-2023-06-26')
const TAG = 'epoch-99-avg-1-chunk-16-left-128.int8.onnx'

let recognizer: Any = null

/**
 * Hotwords bias the decoder towards the user's name — the English model doesn't know "Thibaud".
 * Offline benchmark (scripts/stt-bench.mts, 20 TTS clips): name found 1/10 without, 9/10 with, 0 false alerts.
 * Write the name the way an ENGLISH speaker would spell what they hear ("Tibo"), plus the real spelling.
 */
const HOTWORDS = (process.env.TAP_HOTWORDS || 'Tibo,Teebo,Thibaud,Thibault').split(',').map((w) => w.trim()).filter(Boolean)
const HOTWORDS_SCORE = Number(process.env.TAP_HOTWORDS_SCORE || 2.0)

/** Greedy longest-match tokenisation with the model's BPE pieces (close enough for hotwords). */
export function tokenize(word: string, vocab: Set<string>): string {
  let s = '▁' + word.toUpperCase()
  const out: string[] = []
  while (s.length) {
    let len = s.length
    while (len > 0 && !vocab.has(s.slice(0, len))) len--
    if (len === 0) throw new Error(`cannot tokenize "${word}"`)
    out.push(s.slice(0, len))
    s = s.slice(len)
  }
  return out.join(' ')
}

function writeHotwordsFile(): string {
  const vocab = new Set(readFileSync(join(MODEL_DIR, 'tokens.txt'), 'utf-8').split('\n').map((l) => l.split(' ')[0]))
  const file = join(MODEL_DIR, 'tap-hotwords.txt')
  writeFileSync(file, HOTWORDS.map((w) => tokenize(w, vocab)).join('\n') + '\n')
  return file
}

/** Load the model once (takes a few seconds). Call at startup so the first sentence isn't delayed. */
export function loadSherpa(): Any {
  if (recognizer) return recognizer
  if (!existsSync(join(MODEL_DIR, 'tokens.txt'))) throw new Error(`sherpa model not found in ${MODEL_DIR}`)
  // Loaded lazily so the app still starts when the native module or model is missing.
  const sherpa = require('sherpa-onnx-node')
  const t0 = Date.now()
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(MODEL_DIR, `encoder-${TAG}`),
        decoder: join(MODEL_DIR, `decoder-${TAG}`),
        joiner: join(MODEL_DIR, `joiner-${TAG}`)
      },
      tokens: join(MODEL_DIR, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    },
    // modified_beam_search is required for hotwords (~15% slower than greedy, still ~7x real time).
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
    hotwordsFile: writeHotwordsFile(),
    hotwordsScore: HOTWORDS_SCORE,
    enableEndpoint: true,
    // A sentence ends after 0.8 s of silence (rule2) — lower = faster finals, but more cut sentences.
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 0.8,
    rule3MinUtteranceLength: 20
  })
  console.log(`[stt] sherpa-onnx model loaded in ${Date.now() - t0} ms (hotwords: ${HOTWORDS.join(', ')})`)
  return recognizer
}

const FILLERS = new Set(['and', 'i', 'a', 'the', 'uh', 'um', 'oh', 'it', 'so', 'but', 'at', 'in', 'on', 'yeah'])

/** The model outputs UPPER CASE without punctuation: make it readable. */
function tidy(text: string): string {
  const t = text.trim().toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function createSherpaEngine(source: Source, onText: (text: string, final: boolean) => void): SttEngine {
  const rec = loadSherpa()
  const stream = rec.createStream()
  let lastPartial = ''

  return {
    push(pcm: Int16Array): void {
      const samples = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768
      stream.acceptWaveform({ samples, sampleRate: 16000 })
      while (rec.isReady(stream)) rec.decode(stream)

      const text: string = rec.getResult(stream).text
      if (text && text !== lastPartial) {
        lastPartial = text
        onText(tidy(text), false)
      }
      if (rec.isEndpoint(stream)) {
        // In silence the model sometimes "hears" a lone filler word ("AND" every second): drop those.
        const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
        const filler = words.length === 1 && FILLERS.has(words[0])
        if (text && !filler) onText(tidy(text), true)
        rec.reset(stream)
        lastPartial = ''
      }
    },
    stop(): void {
      // nothing to free explicitly; the stream is garbage-collected
      void source
    }
  }
}
