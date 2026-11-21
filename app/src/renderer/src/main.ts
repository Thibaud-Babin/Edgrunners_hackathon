/** OWNER: D. Main window: senses controls, dev tools, activity log, counters. */
import type { EventType, Source } from '../../shared/events'
import { makeEvent } from '../../shared/events'
import { startCallAudio, startMic } from './audio'
import { cameraHealth, startVision } from './vision'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// ---------- activity log + counters (from the agent) ----------
window.tap.onUi((cmd) => {
  if (cmd.type === 'LOG_ENTRY') {
    const li = document.createElement('li')
    li.className = cmd.entry.kind
    const time = new Date(cmd.entry.ts * 1000).toLocaleTimeString()
    li.textContent = `${time}  [${cmd.entry.kind}]  ${cmd.entry.text}${cmd.entry.costUsd ? `  ($${cmd.entry.costUsd.toFixed(5)})` : ''}`
    $('log').prepend(li)
  }
  if (cmd.type === 'SWITCH_MIC') void switchMic(cmd.prefer)
  if (cmd.type === 'COUNTERS') {
    $('counters').textContent = `AI calls ${cmd.aiCalls} · $${cmd.costUsd.toFixed(4)} · events ${cmd.events} · blocked ${cmd.blocked} · video stays on this laptop`
  }
})

// ---------- senses ----------
$('btn-camera').onclick = async () => {
  try {
    await startVision($<HTMLVideoElement>('video'), ({ pose, blend, face }) => {
      $('vision-info').textContent = face
        ? `yaw ${pose?.yaw.toFixed(0)}°  pitch ${pose?.pitch.toFixed(0)}°  roll ${pose?.roll.toFixed(0)}°  jawOpen ${(blend['jawOpen'] ?? 0).toFixed(2)}  browInnerUp ${(blend['browInnerUp'] ?? 0).toFixed(2)}`
        : 'no face'
    })
    $('btn-camera').textContent = 'Camera on'
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
}

$('btn-mic').onclick = async () => {
  try {
    stopMic = await startMic()
    $('btn-mic').textContent = 'Mic on'
  } catch (err) {
    alert(`Mic failed: ${(err as Error).message}`)
  }
}
$('btn-call').onclick = async () => {
  try {
    await startCallAudio()
    $('btn-call').textContent = 'Call audio on'
  } catch (err) {
    alert(`Call audio failed: ${(err as Error).message}`)
  }
}

// P0-5 check-up. TODO(A/D): frozen frames, face in frame, lighting, right input device.
$('btn-checkup').onclick = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const mics = devices.filter((d) => d.kind === 'audioinput').map((d) => d.label || d.deviceId)
  const cams = devices.filter((d) => d.kind === 'videoinput').map((d) => d.label || d.deviceId)
  const cam = cameraHealth()
  $('checkup').innerHTML = `<b>Check-up (stub)</b><br>Mics: ${mics.join(', ') || 'none'}<br>Cameras: ${cams.join(', ') || 'none'}<br>Camera running: ${cam.running} · face in frame: ${cam.faceInFrame} · frozen: ${cam.frozen} · ${cam.fps} fps`
}

// ---------- dev tools: fake any event ----------
$<HTMLFormElement>('speech-form').onsubmit = (e) => {
  e.preventDefault()
  const input = $<HTMLInputElement>('speech')
  window.tap.emit(makeEvent('TRANSCRIPT_FINAL', 'call_audio', { text: input.value, dev: true }))
  input.value = ''
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
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = () => window.tap.emit(makeEvent(type, source, data))
  $('fake-buttons').append(b)
}
