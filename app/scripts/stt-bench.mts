// Offline benchmark for B: runs every WAV in demo/recordings/tts through sherpa-onnx and the name detector.
//   node --experimental-strip-types scripts/stt-bench.mts            (greedy, no hotwords)
//   node --experimental-strip-types scripts/stt-bench.mts hotwords   (modified beam search + hotwords)
// Clips: generate them with scripts/make-tts-clips.ps1 (Windows voices, 16 kHz mono).
import { createRequire } from 'node:module'
import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findName, findTrouble } from '../src/main/detectors/text.ts'

const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node')
const MODEL = resolve('models', 'sherpa-onnx-streaming-zipformer-en-2023-06-26')
const TAG = 'epoch-99-avg-1-chunk-16-left-128.int8.onnx'
const CLIPS = resolve('..', 'demo', 'recordings', 'tts')
const NAMES = (process.env.TAP_USER_NAMES || 'Thibaud,Thibault,Tibo,Teebo').split(',')
const useHotwords = process.argv[2] === 'hotwords'

/** Greedy longest-match tokenisation with the model's BPE pieces (close enough for hotwords). */
function tokenize(word: string, vocab: Set<string>): string {
  let s = '▁' + word.toUpperCase()
  const out: string[] = []
  while (s.length) {
    let len = s.length
    while (len > 0 && !vocab.has(s.slice(0, len))) len--
    if (len === 0) throw new Error(`cannot tokenize ${word}`)
    out.push(s.slice(0, len))
    s = s.slice(len)
  }
  return out.join(' ')
}

const config: Record<string, unknown> = {
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: { encoder: join(MODEL, `encoder-${TAG}`), decoder: join(MODEL, `decoder-${TAG}`), joiner: join(MODEL, `joiner-${TAG}`) },
    tokens: join(MODEL, 'tokens.txt'),
    numThreads: 2,
    provider: 'cpu',
    debug: 0
  },
  decodingMethod: 'greedy_search',
  enableEndpoint: false
}

if (useHotwords) {
  const { readFileSync } = await import('node:fs')
  const vocab = new Set(readFileSync(join(MODEL, 'tokens.txt'), 'utf-8').split('\n').map((l) => l.split(' ')[0]))
  const hot = (process.env.TAP_HOTWORDS || 'Tibo,Teebo,Thibaud,Thibault').split(',')
  const lines = hot.map((w) => tokenize(w.trim(), vocab))
  const file = resolve('models', 'hotwords.txt')
  writeFileSync(file, lines.join('\n') + '\n')
  console.log('hotwords:', lines.join(' | '))
  Object.assign(config, {
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
    hotwordsFile: file,
    hotwordsScore: Number(process.env.TAP_HOTWORDS_SCORE || 2.0)
  })
}

const rec = new sherpa.OnlineRecognizer(config)
let tp = 0, fn = 0, fp = 0, tn = 0, compute = 0, audio = 0
for (const f of readdirSync(CLIPS).filter((x) => x.endsWith('.wav')).sort()) {
  const wave = sherpa.readWave(join(CLIPS, f))
  const stream = rec.createStream()
  const t = Date.now()
  for (let i = 0; i < wave.samples.length; i += 1600) {
    stream.acceptWaveform({ samples: wave.samples.subarray(i, i + 1600), sampleRate: 16000 })
    while (rec.isReady(stream)) rec.decode(stream)
  }
  stream.acceptWaveform({ samples: new Float32Array(16000), sampleRate: 16000 })
  stream.inputFinished()
  while (rec.isReady(stream)) rec.decode(stream)
  compute += Date.now() - t
  audio += wave.samples.length / 16000
  const text: string = rec.getResult(stream).text.toLowerCase()
  const hit = findName(text, NAMES)
  const shouldHit = f.includes('-name')
  if (shouldHit && hit) tp++
  else if (shouldHit) fn++
  else if (hit) fp++
  else tn++
  const trouble = f.includes('-trouble') ? `  trouble=${findTrouble(text)}` : ''
  const mark = shouldHit === !!hit ? 'ok ' : 'XX '
  console.log(`${mark} ${f.padEnd(20)} ${hit ? `NAME(${hit.word})` : '       '}${trouble}  "${text}"`)
}
console.log(`\nname detected ${tp}/${tp + fn}, false alerts ${fp}/${fp + tn}, speed ${(audio / (compute / 1000)).toFixed(1)}x real time`)
