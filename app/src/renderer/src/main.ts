/** OWNER: D. Main window: check-up, activity log, IT view, dev tools. */
import type { EventType, LogEntry, Source, UiCommand } from '../../shared/events'
import { HAPTIC_PATTERNS, makeEvent } from '../../shared/events'
import { startCallAudio, startMic } from './audio'
import { cameraHealth, startVision } from './vision'
import { el } from './ui/dom'
import { currentTheme, initTheme, toggleTheme } from './ui/theme'

initTheme()

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// ---------- theme switch ----------
const themeBtn = $('theme-switch')
const syncThemeBtn = (): void => themeBtn.setAttribute('aria-pressed', String(currentTheme() === 'dark'))
themeBtn.onclick = () => {
  toggleTheme()
  syncThemeBtn()
}
syncThemeBtn()

// ---------- orbit hub ----------
const hub = $('hub')
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface OrbNode {
  page: string
  icon: string
  name: string
  color: string
  desc: string
  rel: string[]
}
const ORBIT: OrbNode[] = [
  { page: 'check', icon: '✓', name: 'Check-up', color: 'rgba(52, 211, 153, 0.9)', desc: 'Camera, mic and playback test before the call.', rel: ['activity'] },
  { page: 'activity', icon: '≡', name: 'Activity', color: 'rgba(96, 165, 250, 0.9)', desc: 'Everything Tap saw, decided and did — plus cost.', rel: ['check', 'it', 'dev'] },
  { page: 'it', icon: '▦', name: 'IT view', color: 'rgba(251, 191, 36, 0.9)', desc: 'Team impact metrics — simulated data.', rel: ['activity'] },
  { page: 'dev', icon: '⚙', name: 'Dev tools', color: 'rgba(192, 132, 252, 0.9)', desc: 'Replay fake meeting events for the demo.', rel: ['activity'] },
  { page: 'settings', icon: '◐', name: 'Settings', color: 'rgba(244, 114, 182, 0.9)', desc: 'Theme and display.', rel: [] }
]
const RADIUS = 220
const nodeEls = Array.from(document.querySelectorAll<HTMLElement>('.orbit-node'))
const STEP = 360 / nodeEls.length
let rot = 0
let rotTimer: ReturnType<typeof setInterval> | null = null
let selected = -1

function layoutOrbit(): void {
  nodeEls.forEach((n, i) => {
    const rad = ((rot + i * STEP) * Math.PI) / 180
    const x = RADIUS * Math.cos(rad)
    const y = RADIUS * Math.sin(rad)
    const depth = (Math.sin(rad) + 1) / 2 // 1 = front (bottom of the orbit)
    const sel = i === selected
    n.style.transform = `translate(-50%, -34px) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${sel ? 1.4 : 1})`
    n.style.opacity = sel ? '1' : (0.45 + 0.55 * depth).toFixed(2)
    n.style.zIndex = sel ? '30' : String(Math.round(depth * 20))
  })
}

const rotAllowed = (): boolean => selected < 0 && !hub.classList.contains('hidden') && !document.hidden && !REDUCED
function startRot(): void {
  if (rotTimer || !rotAllowed()) return
  rotTimer = setInterval(() => {
    rot = (rot + 0.3) % 360
    layoutOrbit()
  }, 50)
}
function stopRot(): void {
  if (rotTimer) {
    clearInterval(rotTimer)
    rotTimer = null
  }
}

function clearSelection(): void {
  selected = -1
  $('orbit-panel').classList.remove('show')
  nodeEls.forEach((n) => n.classList.remove('sel', 'rel'))
}

function selectNode(i: number): void {
  selected = i
  stopRot()
  const target = 270 - i * STEP // bring the node to the top, via the shortest spin
  rot += ((((target - rot) % 360) + 540) % 360) - 180
  layoutOrbit()
  nodeEls.forEach((n, j) => {
    n.classList.toggle('sel', j === i)
    n.classList.toggle('rel', j !== i && ORBIT[i].rel.includes(ORBIT[j].page))
  })
  const o = ORBIT[i]
  $('op-title').textContent = o.name
  $('op-desc').textContent = o.desc
  $('op-chips').replaceChildren(
    ...o.rel.map((r) => {
      const j = ORBIT.findIndex((x) => x.page === r)
      const c = el('button', 'op-chip', ORBIT[j].name)
      c.style.setProperty('--c', ORBIT[j].color)
      c.onclick = (e) => {
        e.stopPropagation()
        selectNode(j)
      }
      return c
    })
  )
  const open = $('op-open')
  open.textContent = o.page === 'settings' ? 'Switch theme' : `Open ${o.name}`
  open.style.background = o.color
  open.style.borderColor = o.color
  $('orbit-panel').classList.add('show')
}

function openPage(p: string): void {
  clearSelection()
  stopRot()
  hub.classList.add('hidden')
  document.querySelectorAll('.page').forEach((pg) => pg.classList.toggle('active', pg.id === `page-${p}`))
  document.querySelectorAll<HTMLElement>('.mini-graph button').forEach((b) => b.classList.toggle('active', b.dataset.page === p))
}

function showHub(): void {
  hub.classList.remove('hidden')
  document.querySelectorAll('.page').forEach((pg) => pg.classList.remove('active'))
  layoutOrbit()
  startRot()
}

// Mini-graph: round page-jump buttons appended to each page header, in each node's color.
for (const right of document.querySelectorAll<HTMLElement>('.head-right')) {
  const mini = el('div', 'mini-graph')
  for (const o of ORBIT.filter((x) => x.page !== 'settings')) {
    const b = el('button', '', o.icon)
    b.dataset.page = o.page
    b.title = o.name
    b.style.setProperty('--c', o.color)
    b.setAttribute('aria-label', o.name)
    b.onclick = () => openPage(o.page)
    mini.append(b)
  }
  right.append(mini)
}

nodeEls.forEach((n, i) => {
  n.onclick = (e) => {
    e.stopPropagation()
    if (selected === i) {
      clearSelection()
      startRot()
    } else {
      selectNode(i)
    }
  }
})
$('orbit-panel').onclick = (e) => e.stopPropagation()
$('orbit').onclick = () => {
  if (selected >= 0) {
    clearSelection()
    startRot()
  }
}
$('op-open').onclick = () => {
  const o = ORBIT[selected]
  if (!o) return
  if (o.page === 'settings') {
    toggleTheme()
    syncThemeBtn()
    return
  }
  openPage(o.page)
}
document.querySelectorAll<HTMLElement>('.back-hub').forEach((b) => (b.onclick = showHub))
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (hub.classList.contains('hidden')) showHub()
  else if (selected >= 0) {
    clearSelection()
    startRot()
  }
})
document.addEventListener('visibilitychange', () => (document.hidden ? stopRot() : startRot()))
layoutOrbit()
startRot()

function setListening(): void {
  const b = $('core-badge')
  b.textContent = '● listening'
  b.classList.add('on')
  $('hub-note').textContent = "Tap is listening in the background. Minimize this window (don't close it) and start your call — notifications will pop up when needed."
}

// ---------- senses ----------
const video = $<HTMLVideoElement>('video')
let camStarted = false

async function startCamera(): Promise<void> {
  await startVision(video, ({ pose, blend, face }) => {
    $('vision-info').textContent = face
      ? `yaw ${pose?.yaw.toFixed(0)}°  pitch ${pose?.pitch.toFixed(0)}°  roll ${pose?.roll.toFixed(0)}°  jawOpen ${(blend['jawOpen'] ?? 0).toFixed(2)}  browInnerUp ${(blend['browInnerUp'] ?? 0).toFixed(2)}`
      : 'no face'
    $('face-frame').style.display = face ? 'block' : 'none'
  })
  camStarted = true
  $('cam-empty').style.display = 'none'
  $('cam-badge').textContent = '● Live'
  $('btn-camera').textContent = 'Camera on'
}

$('btn-camera').onclick = async () => {
  try {
    await startCamera()
  } catch (err) {
    alert(`Camera failed: ${(err as Error).message}`)
  }
}

let stopMic: (() => void) | null = null
let micDeviceId: string | undefined

/** Restart the mic on another input device. TODO(B): better laptop/headset detection from labels. */
async function switchMic(prefer: 'laptop' | 'headset'): Promise<void> {
  const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
  const isHeadset = (l: string): boolean => /headset|headphone|casque|bluetooth|airpods|usb/i.test(l)
  const target = mics.find((d) => d.deviceId !== micDeviceId && (prefer === 'headset' ? isHeadset(d.label) : !isHeadset(d.label))) ?? mics.find((d) => d.deviceId !== micDeviceId)
  if (!target) return
  stopMic?.()
  micDeviceId = target.deviceId
  stopMic = await startMic(target.deviceId)
  $('btn-mic').textContent = `Mic: ${target.label || 'other device'}`
  setListening()
}

$('btn-mic').onclick = async () => {
  try {
    stopMic = await startMic()
    $('btn-mic').textContent = 'Mic on'
    setListening()
  } catch (err) {
    alert(`Mic failed: ${(err as Error).message}`)
  }
}
$('btn-call').onclick = async () => {
  try {
    await startCallAudio()
    $('btn-call').textContent = 'Call audio on'
    setListening()
  } catch (err) {
    alert(`Call audio failed: ${(err as Error).message}`)
  }
}

// ---------- P0-5 check-up ----------
const CHECK_MS = 10_000
const MIC_PASS = 0.02 // peak amplitude of someone speaking is usually > 0.05
type Status = '' | 'ok' | 'bad' | 'warn'
interface Row {
  li: HTMLLIElement
  mid: HTMLElement
  status: Status
  set(status: Status, detail: string, hint?: string): void
}

function checkRow(label: string): Row {
  const li = el('li', 'check')
  const st = el('span', 'st', '…')
  const mid = el('div')
  const detail = el('div', 'detail')
  const hint = el('div', 'hint')
  mid.append(el('div', 'label', label), detail, hint)
  li.append(st, mid)
  const row: Row = {
    li,
    mid,
    status: '',
    set(status, d, h = '') {
      row.status = status
      li.className = `check${status ? ` ${status}` : ''}`
      st.textContent = status === 'ok' ? '✓' : status === 'warn' ? '!' : status === 'bad' ? '✕' : '…'
      detail.textContent = d
      hint.textContent = h
    }
  }
  return row
}

$('btn-checkup').onclick = async () => {
  const btn = $<HTMLButtonElement>('btn-checkup')
  btn.disabled = true
  const list = $('checks')
  list.innerHTML = ''
  const rows = {
    camRun: checkRow('Camera running'),
    face: checkRow('Face in frame'),
    frozen: checkRow('Camera not frozen'),
    light: checkRow('Lighting'),
    mic: checkRow('Microphone level'),
    inputs: checkRow('Input devices')
  }
  for (const r of Object.values(rows)) list.append(r.li)

  if (!cameraHealth().running) {
    try {
      await startCamera()
    } catch {
      // camera rows below will report the failure
    }
  }

  // Mic gets its own short stream + analyser (audio.ts is B's file, we don't touch it).
  const meterBar = el('i')
  const meter = el('div', 'meter')
  meter.append(meterBar)
  rows.mic.mid.append(meter)
  let micPeak = 0
  let micErr = ''
  let micStream: MediaStream | null = null
  let actx: AudioContext | null = null
  let micTimer: ReturnType<typeof setInterval> | undefined
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    actx = new AudioContext()
    const analyser = actx.createAnalyser()
    analyser.fftSize = 2048
    actx.createMediaStreamSource(micStream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    micTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v))
      micPeak = Math.max(micPeak, peak)
      meterBar.style.width = `${Math.min(100, Math.round(peak * 200))}%`
    }, 60)
  } catch (err) {
    micErr = (err as Error).message
  }

  const devList = el('ul', 'devices')
  rows.inputs.mid.append(devList)

  const refresh = async (): Promise<void> => {
    const h = cameraHealth()
    rows.camRun.set(
      h.running ? 'ok' : 'bad',
      h.running ? `${h.fps} fps` : 'no video',
      h.running ? '' : 'Click "Start camera" and allow access.'
    )
    rows.face.set(
      !h.running ? 'warn' : h.faceInFrame ? 'ok' : 'bad',
      !h.running ? 'camera off' : h.faceInFrame ? 'face detected' : 'no face found',
      h.running && !h.faceInFrame ? 'Sit in front of the camera.' : ''
    )
    rows.frozen.set(
      !h.running ? 'warn' : h.frozen ? 'bad' : 'ok',
      !h.running ? 'camera off' : h.frozen ? 'same frame repeating' : 'live picture',
      h.frozen ? 'Close other apps using the camera, then restart it.' : ''
    )
    rows.light.set(
      h.brightness === null ? 'warn' : h.brightness < 60 ? 'bad' : 'ok',
      h.brightness === null ? 'not measured yet' : `brightness ${Math.round(h.brightness)} / 255`,
      h.brightness !== null && h.brightness < 60 ? 'Too dark — turn on a light or face a window.' : ''
    )
    rows.mic.set(
      micErr ? 'bad' : micPeak > MIC_PASS ? 'ok' : '',
      micErr || (micPeak > MIC_PASS ? 'sound heard' : 'say something…'),
      micErr ? 'Check the mic permission for this app.' : ''
    )
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    devList.replaceChildren(...inputs.map((d) => el('li', '', d.label || `unnamed device ${d.deviceId.slice(0, 8)}`)))
    rows.inputs.set(inputs.length ? 'ok' : 'bad', `${inputs.length} input${inputs.length === 1 ? '' : 's'}`, inputs.length ? '' : 'No microphone found — plug one in.')
  }

  void refresh()
  const timer = setInterval(() => void refresh(), 250)

  setTimeout(() => {
    clearInterval(timer)
    clearInterval(micTimer)
    micStream?.getTracks().forEach((t) => t.stop())
    void actx?.close()
    void refresh().then(() => {
      if (!micErr && micPeak <= MIC_PASS) {
        rows.mic.set('bad', 'no sound heard in 10 s', 'Wrong input selected? Try the laptop mic:')
        const fix = el('button', 'btn primary small', 'Use laptop mic')
        fix.onclick = () => window.tap.emit(makeEvent('USER_CLICK', 'ui', { action_id: 'switch_input_device', args: {} }))
        rows.mic.mid.append(fix)
      }
      const ok = list.querySelectorAll('.check.ok').length
      $('score-num').textContent = `${ok}/6`
      $('score-bar').style.width = `${(ok / 6) * 100}%`
      const badge = $('badge-check')
      badge.textContent = `${ok}/6`
      badge.className = `badge ${ok === 6 ? 'ok' : 'bad'}`
      btn.disabled = false
      btn.textContent = 'Run check-up'
    })
  }, CHECK_MS)
  btn.textContent = 'Checking…'
}
$('btn-checkup-again').onclick = () => $('btn-checkup').click()

// ---------- activity log + counters (from the agent) ----------
const ICONS: Record<LogEntry['kind'], string> = { event: '👁', decision: '⚖', llm: '✦', action: '⚡', blocked: '⛔', error: '⚠' }
const WHY: Partial<Record<LogEntry['kind'], string>> = {
  blocked: 'only your own clicks and gestures can trigger actions',
  llm: 'only text was sent'
}

let filter = 'all'
const applyFilter = (tr: HTMLTableRowElement): void => {
  tr.style.display = filter === 'all' || tr.dataset.kind === filter ? '' : 'none'
}

for (const k of ['all', 'event', 'decision', 'llm', 'action', 'blocked']) {
  const chip = el('button', `chip${k === 'all' ? ' active' : ''}`, k === 'all' ? 'All' : k)
  chip.onclick = () => {
    filter = k
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip))
    document.querySelectorAll<HTMLTableRowElement>('#log tr').forEach(applyFilter)
  }
  $('filters').append(chip)
}

function addLog(entry: LogEntry): void {
  $('log-empty').style.display = 'none'
  const tr = el('tr', 'new')
  tr.dataset.kind = entry.kind
  const kind = el('td')
  const badge = el('span', `kind k-${entry.kind}`)
  badge.append(el('i', '', ICONS[entry.kind]), document.createTextNode(entry.kind))
  kind.append(badge)
  const what = el('td', '', entry.text)
  const why = WHY[entry.kind]
  if (why) what.append(el('div', 'why', why))
  tr.append(
    el('td', 'time', new Date(entry.ts * 1000).toLocaleTimeString()),
    kind,
    what,
    el('td', 'cost', entry.costUsd ? `$${entry.costUsd.toFixed(5)}` : '—')
  )
  applyFilter(tr)
  $('log').prepend(tr)
}

const seen: string[] = []
window.tap.onUi((cmd: UiCommand) => {
  if (!(cmd.type === 'LOG_ENTRY' && cmd.entry.text.startsWith('MIC_LEVEL'))) {
    seen.unshift(JSON.stringify(cmd))
    seen.length = Math.min(seen.length, 20)
    $('raw-log').textContent = seen.join('\n')
  }
  switch (cmd.type) {
    case 'LOG_ENTRY':
      addLog(cmd.entry)
      break
    case 'COUNTERS':
      $('c-ai').textContent = String(cmd.aiCalls)
      $('c-cost').textContent = `$${cmd.costUsd.toFixed(4)}`
      $('c-events').textContent = String(cmd.events)
      $('c-blocked').textContent = String(cmd.blocked)
      $('side-counters').textContent = `AI calls ${cmd.aiCalls} · $${cmd.costUsd.toFixed(4)}`
      $('badge-activity').textContent = `${cmd.events} events · ${cmd.blocked} blocked`
      break
    case 'SWITCH_MIC':
      void switchMic(cmd.prefer)
      break
  }
})

// ---------- IT view (simulated data — the label stays visible) ----------
interface ItData {
  scope: string
  tiles: Array<{ label: string; value: string; delta: string; trend: number[] }>
  problems: Array<{ type: string; hours: number }>
  health: Array<{ label: string; value: string }>
}

function spark(trend: number[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'spark')
  svg.setAttribute('viewBox', '0 0 100 28')
  svg.setAttribute('preserveAspectRatio', 'none')
  const min = Math.min(...trend)
  const span = Math.max(...trend) - min || 1
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  p.setAttribute('points', trend.map((v, i) => `${(i / (trend.length - 1)) * 100},${26 - ((v - min) / span) * 24}`).join(' '))
  p.setAttribute('fill', 'none')
  p.setAttribute('stroke', 'var(--accent)')
  p.setAttribute('stroke-width', '1.5')
  svg.append(p)
  return svg
}

async function loadIt(): Promise<void> {
  try {
    const d = (await (await fetch('it-data.json')).json()) as ItData
    $('it-sub').textContent = d.scope
    $('it-tiles').replaceChildren(
      ...d.tiles.map((t) => {
        const tile = el('div', 'tile')
        tile.append(el('div', 'k', t.label), el('div', 'v', t.value), el('div', 'delta', t.delta), spark(t.trend))
        return tile
      })
    )
    const max = Math.max(...d.problems.map((p) => p.hours), 1)
    $('it-bars').replaceChildren(
      ...d.problems.map((p) => {
        const row = el('div', 'bar-row')
        const track = el('div', 'track')
        const bar = el('i')
        bar.style.width = `${(p.hours / max) * 100}%`
        track.append(bar)
        row.append(el('div', '', p.type), track, el('div', 'val', `${p.hours} h`))
        return row
      })
    )
    $('it-health').replaceChildren(
      ...d.health.map((h) => {
        const div = el('div')
        div.append(el('b', '', h.value), el('span', '', h.label))
        return div
      })
    )
  } catch {
    $('it-sub').textContent = 'could not load it-data.json'
  }
}
void loadIt()

// ---------- dev tools: fake any event ----------
$<HTMLFormElement>('speech-form').onsubmit = (e) => {
  e.preventDefault()
  const input = $<HTMLInputElement>('speech')
  window.tap.emit(makeEvent('TRANSCRIPT_FINAL', 'call_audio', { text: input.value, dev: true }))
  input.value = ''
}

$('btn-raw').onclick = () => {
  try {
    const j = JSON.parse($<HTMLTextAreaElement>('raw-json').value) as { type?: EventType; source?: Source; data?: Record<string, unknown> }
    if (!j.type || !j.source) throw new Error('needs "type" and "source"')
    window.tap.emit(makeEvent(j.type, j.source, j.data))
    $('raw-err').textContent = ''
  } catch (err) {
    $('raw-err').textContent = (err as Error).message
  }
}

const FAKES: Array<[string, EventType, Source, Record<string, unknown>?]> = [
  ['Look away', 'USER_AWAY', 'webcam'],
  ['Look back', 'USER_BACK', 'webcam'],
  ['Mouth moving', 'MOUTH_MOVING', 'webcam', { active: true }],
  ['Mouth still', 'MOUTH_MOVING', 'webcam', { active: false }],
  ['Mic silent', 'MIC_LEVEL', 'mic', { rms: 0 }],
  ['Nod', 'GESTURE_NOD', 'webcam'],
  ['Eyebrow raise', 'GESTURE_BROW_RAISE', 'webcam'],
  ['Unknown action (should be blocked)', 'USER_CLICK', 'ui', { action_id: 'delete_everything' }]
]
for (const [label, type, source, data] of FAKES) {
  const b = el('button', 'btn small', label)
  b.onclick = () => window.tap.emit(makeEvent(type, source, data))
  $('fake-buttons').append(b)
}

// ---------- Check-up: "Try the vibrations" (the 4 signals Tap uses; main fires them, nothing else happens) ----------
for (const [key, p] of Object.entries(HAPTIC_PATTERNS)) {
  const b = el('button', 'btn haptic-test')
  b.append(el('strong', '', p.label), el('span', '', p.meaning), el('em', '', p.waveforms.length === 2 ? 'knock · knock' : p.waveforms[0].replace('_', ' ')))
  b.onclick = () => window.tap.emit(makeEvent('HAPTIC_TEST', 'ui', { pattern: key }))
  $('haptic-tests').append(b)
}
