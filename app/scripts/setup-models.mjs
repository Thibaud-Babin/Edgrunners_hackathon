// Runs after `npm install`: copies MediaPipe's WASM next to the renderer and downloads the face model,
// so face tracking works OFFLINE (venue Wi-Fi) and fully on-device.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'src', 'renderer', 'public')

// Recent npm versions may skip dependencies' install scripts → Electron's binary is missing ("Electron uninstall").
const electronDir = join(root, 'node_modules', 'electron')
if (existsSync(electronDir) && !existsSync(join(electronDir, 'dist'))) {
  console.log('[setup] downloading the Electron binary…')
  execFileSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
}

cpSync(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(pub, 'mediapipe', 'wasm'), { recursive: true })
console.log('[setup] MediaPipe wasm copied')

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const modelPath = join(pub, 'models', 'face_landmarker.task')
if (!existsSync(modelPath)) {
  mkdirSync(dirname(modelPath), { recursive: true })
  try {
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()))
    console.log('[setup] face_landmarker.task downloaded')
  } catch (err) {
    console.warn(`[setup] could not download the face model (${err.message}). Download it manually:\n  ${MODEL_URL}\n  → ${modelPath}`)
  }
}
