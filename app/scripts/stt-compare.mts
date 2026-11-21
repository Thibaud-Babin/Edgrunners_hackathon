// Compare speech-to-text models on the SAME audio (B's model choice tool).
//   node --experimental-strip-types scripts/stt-compare.mts                 → newest demo/recordings/session-*-call_audio.wav
//   node --experimental-strip-types scripts/stt-compare.mts path/to/file.wav
//   node --experimental-strip-types scripts/stt-compare.mts clips           → demo/recordings/tts/*.wav (scored by file name)
// The recording is cut into sentences with the Silero voice detector, then every sentence goes through every model.
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { findName, findTrouble } from '../src/main/detectors/text.ts'
import { tokenize } from '../src/main/audio/sherpa.ts'

const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node')
const M = resolve('models')
const REC = resolve('..', 'demo', 'recordings')
const NAMES = (process.env.TAP_USER_NAMES || 'Thibaud,Thibault,Tibo,Teebo').split(',')
const HOT = (process.env.TAP_HOTWORDS || 'Tibo,Teebo,Thibaud,Thibault').split(',')

const find = (dir: string, re: RegExp): string => {
  const f = readdirSync(dir).find((x) => re.test(x))
  if (!f) throw new Error(`no file matching ${re} in ${dir}`)
  return join(dir, f)
}

// ---------- models ----------
interface Model {
  name: string
  transcribe: (samples: Float32Array) => string
}

function zipformer(): Model {
  const d = join(M, 'sherpa-onnx-streaming-zipformer-en-2023-06-26')
  const tag = 'epoch-99-avg-1-chunk-16-left-128.int8.onnx'
  const vocab = new Set(readFileSync(join(d, 'tokens.txt'), 'utf-8').split('\n').map((l) => l.split(' ')[0]))
  const hot = join(M, 'hotwords.txt')
  require('node:fs').writeFileSync(hot, HOT.map((w) => tokenize(w.trim(), vocab)).join('\n') + '\n')
  const rec = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(d, `encoder-${tag}`), decoder: join(d, `decoder-${tag}`), joiner: join(d, `joiner-${tag}`) },
      tokens: join(d, 'tokens.txt'),
      numThreads: 2
    },
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
    hotwordsFile: hot,
    hotwordsScore: 2.0
  })
  return {
    name: 'zipformer-stream (current)',
    transcribe(samples) {
      const s = rec.createStream()
      s.acceptWaveform({ samples, sampleRate: 16000 })
      s.acceptWaveform({ samples: new Float32Array(8000), sampleRate: 16000 })
      s.inputFinished()
      while (rec.isReady(s)) rec.decode(s)
      return rec.getResult(s).text
    }
  }
}

function offline(name: string, modelConfig: Record<string, unknown>): Model {
  const rec = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { numThreads: 2, provider: 'cpu', ...modelConfig } })
  return {
    name,
    transcribe(samples) {
      const s = rec.createStream()
      s.acceptWaveform({ samples, sampleRate: 16000 })
      rec.decode(s)
      return rec.getResult(s).text
    }
  }
}

function parakeet(): Model {
  const d = join(M, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8')
  return offline('parakeet-tdt-0.6b-v2', {
    transducer: { encoder: join(d, 'encoder.int8.onnx'), decoder: join(d, 'decoder.int8.onnx'), joiner: join(d, 'joiner.int8.onnx') },
    tokens: join(d, 'tokens.txt'),
    modelType: 'nemo_transducer'
  })
}

function whisper(): Model {
  const d = join(M, 'sherpa-onnx-whisper-small.en')
  return offline('whisper-small.en', {
    whisper: { encoder: find(d, /encoder\.int8\.onnx$/), decoder: find(d, /decoder\.int8\.onnx$/), language: '', task: 'transcribe', tailPaddings: -1 },
    tokens: find(d, /tokens\.txt$/)
  })
}

function moonshine(): Model {
  const d = join(M, 'sherpa-onnx-moonshine-base-en-int8')
  return offline('moonshine-base', {
    moonshine: {
      preprocessor: find(d, /^preprocess/),
      encoder: find(d, /^encode/),
      uncachedDecoder: find(d, /^uncached_decode/),
      cachedDecoder: find(d, /^cached_decode/)
    },
    tokens: find(d, /tokens\.txt$/)
  })
}

// ---------- audio → sentences ----------
interface Segment {
  file: string
  start: number
  samples: Float32Array
}

function vadSegments(file: string): Segment[] {
  const wave = sherpa.readWave(file)
  if (wave.sampleRate !== 16000) throw new Error(`${file}: need 16 kHz (got ${wave.sampleRate}); convert with ffmpeg -ar 16000 -ac 1`)
  const vad = new sherpa.Vad(
    {
      sileroVad: { model: join(M, 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: 0.4, minSpeechDuration: 0.25, windowSize: 512, maxSpeechDuration: 12 },
      sampleRate: 16000,
      numThreads: 1,
      debug: 0
    },
    60
  )
  const out: Segment[] = []
  const drain = (): void => {
    while (!vad.isEmpty()) {
      const seg = vad.front()
      vad.pop()
      out.push({ file: basename(file), start: seg.start / 16000, samples: new Float32Array(seg.samples) })
    }
  }
  for (let i = 0; i + 512 <= wave.samples.length; i += 512) {
    vad.acceptWaveform(wave.samples.subarray(i, i + 512))
    drain()
  }
  vad.flush()
  drain()
  return out
}

// ---------- run ----------
const arg = process.argv[2]
let files: string[]
if (arg === 'clips') {
  const d = join(REC, 'tts')
  files = readdirSync(d).filter((f) => f.endsWith('.wav')).sort().map((f) => join(d, f))
} else if (arg) {
  files = [resolve(arg)]
} else {
  const sessions = readdirSync(REC).filter((f) => /^session-.*-call_audio\.wav$/.test(f)).map((f) => join(REC, f))
  if (!sessions.length) throw new Error('no demo/recordings/session-*-call_audio.wav yet — record a call with TAP_RECORD=1')
  files = [sessions.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]]
}

const segments = files.flatMap(vadSegments)
const audioSec = segments.reduce((s, x) => s + x.samples.length / 16000, 0)
console.log(`${files.length} file(s), ${segments.length} speech segments, ${audioSec.toFixed(0)} s of speech\n`)

const builders: Array<[string, () => Model]> = [
  ['zipformer', zipformer],
  ['parakeet', parakeet],
  ['whisper', whisper],
  ['moonshine', moonshine]
]
const only = process.env.MODELS?.split(',')
const results: Array<{ model: string; texts: string[]; ms: number[] }> = []
for (const [key, build] of builders) {
  if (only && !only.includes(key)) continue
  let model: Model
  try {
    model = build()
  } catch (err) {
    console.log(`(skipping ${key}: ${(err as Error).message})`)
    continue
  }
  const texts: string[] = []
  const ms: number[] = []
  for (const seg of segments) {
    const t = performance.now()
    texts.push(model.transcribe(seg.samples).trim().toLowerCase())
    ms.push(performance.now() - t)
  }
  results.push({ model: model.name, texts, ms })
}

// Per-sentence comparison
segments.forEach((seg, i) => {
  console.log(`--- ${seg.file} @ ${seg.start.toFixed(1)} s (${(seg.samples.length / 16000).toFixed(1)} s)`)
  for (const r of results) {
    const hit = findName(r.texts[i], NAMES)
    const tr = findTrouble(r.texts[i])
    console.log(`  ${r.model.padEnd(28)} ${hit ? 'NAME ' : '     '}${tr ? `[${tr}] ` : ''}${r.texts[i]}`)
  }
})

// Summary
console.log('\n=== SUMMARY ===')
const scored = files.some((f) => /-(name|neg|trouble)/.test(f))
for (const r of results) {
  const names = r.texts.filter((t) => findName(t, NAMES)).length
  const trouble = r.texts.filter((t) => findTrouble(t)).length
  const total = r.ms.reduce((a, b) => a + b, 0)
  const p90 = [...r.ms].sort((a, b) => a - b)[Math.floor(r.ms.length * 0.9)] ?? 0
  let score = ''
  if (scored) {
    let tp = 0, pos = 0, fp = 0, neg = 0
    segments.forEach((s, i) => {
      const hit = !!findName(r.texts[i], NAMES)
      if (s.file.includes('-name')) { pos++; if (hit) tp++ } else { neg++; if (hit) fp++ }
    })
    score = `  names ${tp}/${pos}, false alerts ${fp}/${neg}`
  }
  console.log(`${r.model.padEnd(28)} sentences with name: ${names}, trouble phrases: ${trouble}${score}  | speed ${(audioSec / (total / 1000)).toFixed(1)}x real time, per sentence p90 ${p90.toFixed(0)} ms`)
}
