// Keyword spotting test: listens for the SOUND of the user's name (not the transcript) in a recording.
//   node --experimental-strip-types scripts/kws-test.mts [file.wav]   (default: newest session recording)
// Tune with env: KWS_WORDS="TIBO,TEEBO,TEBO,THIBAULT", KWS_SCORE (boost, default 1.5), KWS_THRESHOLD (default 0.25)
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tokenize } from '../src/main/audio/sherpa.ts'

const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node')
const d = resolve('models', 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01')
const tag = 'epoch-12-avg-2-chunk-16-left-64.int8.onnx'
const REC = resolve('..', 'demo', 'recordings')

const words = (process.env.KWS_WORDS || 'TIBO,TEEBO,TEBO,THIBAULT,THIBAUD').split(',').map((w) => w.trim())
const vocab = new Set(readFileSync(join(d, 'tokens.txt'), 'utf-8').split('\n').map((l) => l.split(' ')[0]))
const kwFile = join(d, 'tap-keywords.txt')
writeFileSync(kwFile, words.map((w) => `${tokenize(w, vocab)} @${w}`).join('\n') + '\n')
console.log('keywords:', readFileSync(kwFile, 'utf-8').trim().split('\n').join(' | '))

const kws = new sherpa.KeywordSpotter({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: { encoder: join(d, `encoder-${tag}`), decoder: join(d, `decoder-${tag}`), joiner: join(d, `joiner-${tag}`) },
    tokens: join(d, 'tokens.txt'),
    numThreads: 1
  },
  maxActivePaths: 4,
  numTrailingBlanks: 1,
  keywordsScore: Number(process.env.KWS_SCORE || 1.5),
  keywordsThreshold: Number(process.env.KWS_THRESHOLD || 0.25),
  keywordsFile: kwFile
})

let file = process.argv[2]
if (!file) {
  const s = readdirSync(REC).filter((f) => /^session-.*-call_audio\.wav$/.test(f)).map((f) => join(REC, f))
  file = s.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}
const wave = sherpa.readWave(resolve(file))
const stream = kws.createStream()
let hits = 0
const t0 = performance.now()
for (let i = 0; i < wave.samples.length; i += 1600) {
  stream.acceptWaveform({ samples: wave.samples.subarray(i, i + 1600), sampleRate: 16000 })
  while (kws.isReady(stream)) {
    kws.decode(stream)
    const r = kws.getResult(stream)
    if (r.keyword) {
      hits++
      console.log(`  ${((i + 1600) / 16000).toFixed(1)} s  → ${r.keyword}`)
      kws.reset(stream)
    }
  }
}
const sec = wave.samples.length / 16000
console.log(`${hits} detections in ${sec.toFixed(0)} s, speed ${(sec / ((performance.now() - t0) / 1000)).toFixed(0)}x real time`)
