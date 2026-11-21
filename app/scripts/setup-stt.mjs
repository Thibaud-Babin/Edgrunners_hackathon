// Downloads the LOCAL speech-to-text models into app/models/. Run once per laptop:  npm run setup-stt
//  - Parakeet TDT 0.6B v2 int8 (~460 MB download, ~640 MB kept) + Silero VAD: the local fallback when Deepgram is
//    unavailable (no key / no internet). Best local model on our real-call test.
//  - streaming Zipformer (~310 MB download, ~75 MB kept): the old engine, last resort (TAP_STT=sherpa).
// Skip the old one with:  node scripts/setup-stt.mjs parakeet
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const models = join(root, 'models')
const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
mkdirSync(models, { recursive: true })

async function download(url, to) {
  console.log(`[stt] downloading ${url} …`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  writeFileSync(to, Buffer.from(await res.arrayBuffer()))
}

async function model(name, check, cleanup = []) {
  const dir = join(models, name)
  if (existsSync(join(dir, check))) return console.log(`[stt] already there: ${dir}`)
  const archive = join(models, `${name}.tar.bz2`)
  await download(`${BASE}/${name}.tar.bz2`, archive)
  console.log('[stt] extracting …')
  execFileSync('tar', ['xjf', archive, '-C', models], { stdio: 'inherit' }) // tar ships with Windows 10+
  rmSync(archive)
  for (const f of cleanup) rmSync(join(dir, f), { force: true })
  console.log(`[stt] done: ${dir}`)
}

// 1. Silero VAD (cuts audio into sentences for Parakeet)
const vad = join(models, 'silero_vad.onnx')
if (existsSync(vad)) console.log(`[stt] already there: ${vad}`)
else await download(`${BASE}/silero_vad.onnx`, vad)

// 2. Parakeet (local fallback)
await model('sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', 'encoder.int8.onnx')

// 3. Old streaming Zipformer (last resort)
if (process.argv[2] !== 'parakeet') {
  const tag = 'epoch-99-avg-1-chunk-16-left-128.onnx'
  await model('sherpa-onnx-streaming-zipformer-en-2023-06-26', 'tokens.txt', ['encoder', 'decoder', 'joiner'].map((p) => `${p}-${tag}`))
}
