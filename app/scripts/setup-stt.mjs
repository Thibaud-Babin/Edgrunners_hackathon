// Downloads the local speech-to-text model (sherpa-onnx streaming Zipformer, English, ~310 MB download,
// ~75 MB kept) into app/models/. Run once per laptop:  npm run setup-stt
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const NAME = 'sherpa-onnx-streaming-zipformer-en-2023-06-26'
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${NAME}.tar.bz2`
const models = join(root, 'models')
const dir = join(models, NAME)

if (existsSync(join(dir, 'tokens.txt'))) {
  console.log(`[stt] model already in ${dir}`)
  process.exit(0)
}
mkdirSync(models, { recursive: true })
const archive = join(models, `${NAME}.tar.bz2`)
console.log(`[stt] downloading ${URL} …`)
const res = await fetch(URL)
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
console.log('[stt] extracting …')
execFileSync('tar', ['xjf', archive, '-C', models], { stdio: 'inherit' }) // tar ships with Windows 10+
rmSync(archive)
// Keep only the int8 files the app uses.
for (const part of ['encoder', 'decoder', 'joiner']) rmSync(join(dir, `${part}-epoch-99-avg-1-chunk-16-left-128.onnx`), { force: true })
console.log(`[stt] done: ${dir}`)
