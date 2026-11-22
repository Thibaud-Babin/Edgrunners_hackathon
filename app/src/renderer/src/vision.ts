/**
 * OWNER: A. Webcam → MediaPipe Face Landmarker → events.
 * Runs on the laptop (wasm + model served locally, see scripts/setup-models.mjs).
 * Done here: USER_AWAY / USER_BACK (yaw + pitch), MOUTH_MOVING, FACE_OUT_OF_FRAME,
 * CAMERA_FROZEN, LOW_LIGHT and the live cameraHealth() readout for D's check-up.
 * TODO(A): gestures + neutral-face calibration (P1-1); Web Worker only if the UI stutters.
 */
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import type { EventType } from '../../shared/events'
import { makeEvent } from '../../shared/events'
import { countChangedPixels, createFrameHealth, meanLuma } from './vision/health'
import { mouthMoving, mouthSignal } from './vision/mouth'
import { createGazeAway, gazeAvailability, type GazeFallbackReason } from './vision/gaze'
import { startGazeClient, type GazeClientStatus } from './vision/gazeClient'
import { faceBox, framing, type FaceBox, type Framing } from '../../shared/framing'

// Starting thresholds from docs/PRD.md §4 "Gesture rules" — tune them during calibration.
const AWAY_YAW_ENTER_DEG = 28
const AWAY_YAW_EXIT_DEG = 18
const AWAY_PITCH_ENTER_DEG = 22
const AWAY_PITCH_EXIT_DEG = 14
const AWAY_AFTER_MS = 2000
const FRAME_MS = 50 // camera analysis period (B: a timer keeps running when Tap is minimized)
const MOUTH_WINDOW_MS = 1000
const MOUTH_ON_MS = 300 // debounce: raw active must hold this long (B's request)
const MOUTH_OFF_MS = 800 // debounce: raw inactive must hold this long

// Camera health (P0-5): a 64x48 frame sample every 250 ms, independent of the landmarker.
const HEALTH_SAMPLE_MS = 250
const HEALTH_W = 64
const HEALTH_H = 48
const FROZEN_AFTER_MS = 3000
const FROZEN_MAX_CHANGED_PIXELS = 3 // of 64x48 = 3072: real sensor noise always changes more
const LOW_LIGHT_ENTER = 60 // mean luma 0..255 (labelled dark test images: 10.9-31.5)
const LOW_LIGHT_EXIT = 80
const TOO_BRIGHT_ENTER = 190 // labelled light test images: 202.3-206.8
const TOO_BRIGHT_EXIT = 170
const LIGHTING_HOLD_MS = 800

// Gaze mode: 3 s hold, outward 64 px tolerance; pose is the automatic fallback.
// The tracker runs its own camera; both apps need the Windows multi-app camera setting.
const GAZE_AWAY_AFTER_MS = 3000
const GAZE_BACK_AFTER_MS = 700
const GAZE_TOLERANCE_PX = 64
const GAZE_SMOOTHING = 0.25
const GAZE_STALE_MS = 3000
const GAZE_NO_FACE_MS = 3000

export interface HeadPose {
  yaw: number
  pitch: number
  roll: number
}

/** Rotation part of MediaPipe's 4×4 facial transformation matrix (column-major) → degrees. */
export function headPose(m: number[]): HeadPose {
  const r = (row: number, col: number): number => m[col * 4 + row]
  const deg = (x: number): number => (x * 180) / Math.PI
  return {
    yaw: deg(Math.asin(Math.max(-1, Math.min(1, -r(2, 0))))),
    pitch: deg(Math.atan2(r(2, 1), r(2, 2))),
    roll: deg(Math.atan2(r(1, 0), r(0, 0)))
  }
  // TODO(A): sanity-check signs by turning your head; compare with vladmandic/human src/face/angles.ts
}

/** Read by D's check-up screen (P0-5). A keeps it up to date from the vision loop. */
export interface CameraHealth {
  running: boolean
  faceInFrame: boolean
  /** B: found AND well framed? (centered, not too far / close, not cut off), smoothed over ~0.5 s */
  framing: Framing
  frozen: boolean // no changed pixels on the 64x48 canvas for > 3 s
  brightness: number | null // mean luma 0..255; null before the first frame
  tooBright: boolean // mean luma >= 190 for 0.8 s; cleared below 170
  fps: number // 0 when the landmarker stopped receiving frames
}

const NO_FACE: Framing = framing(null)
const health: CameraHealth = { running: false, faceInFrame: false, framing: NO_FACE, frozen: false, brightness: null, tooBright: false, fps: 0 }

export function cameraHealth(): CameraHealth {
  return { ...health }
}

// ---------- away mode: Logi Gaze Tracker (default) with head-pose fallback ----------
// D can add the UI toggle later: import { getAwayMode, setAwayMode, gazeStatus } from './vision'.
export type AwayMode = 'pose' | 'gaze'
const GAZE_STORAGE_KEY = 'tap:awayMode'

const gazeTracker = createGazeAway({
  awayAfterMs: GAZE_AWAY_AFTER_MS,
  backAfterMs: GAZE_BACK_AFTER_MS,
  tolerancePx: GAZE_TOLERANCE_PX,
  smoothing: GAZE_SMOOTHING
})

let awayMode: AwayMode = 'gaze'
let lastActiveSource: AwayMode | null = null
let stopGaze: (() => void) | null = null
let gazeClientStatus: GazeClientStatus = {
  connected: false,
  calibrated: false,
  lastSnapshotAt: null,
  lastFaceAt: null,
  lastGazeAt: null
}

export interface GazeStatus extends GazeClientStatus {
  mode: AwayMode
  /** What is actually driving away right now (gaze if usable, otherwise pose). */
  activeSource: AwayMode
  /** Why gaze is not driving away, when mode is 'gaze'. */
  fallbackReason: GazeFallbackReason | null
}

export function getAwayMode(): AwayMode {
  return awayMode
}

export function gazeStatus(): GazeStatus {
  if (awayMode === 'pose') {
    return { mode: awayMode, ...gazeClientStatus, activeSource: 'pose', fallbackReason: null }
  }
  const availability = gazeAvailability({
    ...gazeClientStatus,
    now: performance.now(),
    staleMs: GAZE_STALE_MS,
    noFaceMs: GAZE_NO_FACE_MS
  })
  return {
    mode: awayMode,
    ...gazeClientStatus,
    activeSource: availability.usable ? 'gaze' : 'pose',
    fallbackReason: availability.reason
  }
}

function emitTap(type: EventType, data?: Record<string, unknown>): void {
  window.tap.emit(makeEvent(type, 'webcam', data))
}

function startGaze(): void {
  if (stopGaze) return
  gazeTracker.reset()
  stopGaze = startGazeClient({
    onSnapshot: (snapshot) => {
      const now = performance.now()
      const update = gazeTracker.update(now, snapshot)
      if (update?.kind === 'away') {
        // Since when the gaze first left the screen, so C can start the transcript there.
        const sinceEpoch = Date.now() / 1000 - (now - update.since) / 1000
        emitTap('USER_AWAY', { reason: update.reason, gaze: true, since: sinceEpoch })
      }
      if (update?.kind === 'back') emitTap('USER_BACK', { gaze: true })
    },
    onStatus: (status) => {
      gazeClientStatus = status
    }
  })
}

function stopGazeMode(): void {
  const wasAway = gazeTracker.away
  stopGaze?.()
  stopGaze = null
  gazeTracker.reset()
  gazeClientStatus = {
    connected: false,
    calibrated: false,
    lastSnapshotAt: null,
    lastFaceAt: null,
    lastGazeAt: null
  }
  if (wasAway) emitTap('USER_BACK', { gaze: true })
}

/** Switch the away source. 'gaze' is the default and falls back to pose automatically. */
export function setAwayMode(mode: AwayMode): void {
  if (mode !== 'pose' && mode !== 'gaze') return
  awayMode = mode
  try {
    localStorage.setItem(GAZE_STORAGE_KEY, mode)
  } catch {
    // localStorage unavailable: the mode still applies for this session
  }
  if (mode === 'gaze') startGaze()
  else stopGazeMode()
}

try {
  const saved = localStorage.getItem(GAZE_STORAGE_KEY)
  if (saved === 'pose' || saved === 'gaze') awayMode = saved
} catch {
  // ignore
}
if (awayMode === 'gaze') startGaze()

export type VisionListener = (info: { pose?: HeadPose; blend: Record<string, number>; face: boolean }) => void

/** Infrared (Windows Hello), presence-detection ("CPD") and virtual cameras: black-and-white or not a real picture. Do NOT add "lvnext": that is the demo camera's RGB name. */
const NOT_A_COLOUR_CAMERA = /\b(ir|infrared|hello|cpd|virtual|obs)\b/i

/**
 * Opens the webcam, avoiding infrared / Windows Hello cameras. Laptops often list the IR camera first, and the
 * default pick then gives a black-and-white image. Labels are only known after a first permission, so: open the
 * default, and if it is an IR/virtual camera, reopen the first colour camera instead.
 */
async function openColourCamera(): Promise<MediaStream> {
  const size = { width: 640, height: 480 }
  let stream = await navigator.mediaDevices.getUserMedia({ video: size })
  const label = stream.getVideoTracks()[0]?.label ?? ''
  if (!NOT_A_COLOUR_CAMERA.test(label)) return stream
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && !NOT_A_COLOUR_CAMERA.test(d.label))
  if (!cams.length) return stream // nothing better: keep what we have
  stream.getTracks().forEach((t) => t.stop())
  stream = await navigator.mediaDevices.getUserMedia({ video: { ...size, deviceId: { exact: cams[0].deviceId } } })
  console.info(`[vision] skipped "${label}", using "${cams[0].label}"`)
  return stream
}

export async function startVision(video: HTMLVideoElement, onFrame?: VisionListener): Promise<() => void> {
  const stream = await openColourCamera()
  video.srcObject = stream
  await video.play()

  const fileset = await FilesetResolver.forVisionTasks('mediapipe/wasm')
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: 'models/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true
  })

  let away = false
  let lookingAwaySince: number | null = null
  let mouthActive = false
  let mouthPending: boolean | null = null
  let mouthPendingSince = 0
  let faceOutSince: number | null = null
  let faceOutSent = false
  const jaw: Array<{ t: number; v: number }> = []
  const emit = (type: EventType, data?: Record<string, unknown>): void => window.tap.emit(makeEvent(type, 'webcam', data))

  let running = true
  let lastVideoTime = -1
  let lastLandmarkAt = 0
  health.running = true
  health.faceInFrame = false
  health.framing = NO_FACE
  let box: FaceBox | null = null // smoothed face box
  health.frozen = false
  health.brightness = null
  health.tooBright = false
  health.fps = 0
  let frames = 0
  let fpsSince = performance.now()

  const frameHealth = createFrameHealth({
    frozenAfterMs: FROZEN_AFTER_MS,
    maxChangedPixels: FROZEN_MAX_CHANGED_PIXELS,
    lowLightEnter: LOW_LIGHT_ENTER,
    lowLightExit: LOW_LIGHT_EXIT,
    tooBrightEnter: TOO_BRIGHT_ENTER,
    tooBrightExit: TOO_BRIGHT_EXIT,
    lightingHoldMs: LIGHTING_HOLD_MS
  })

  // Own timer, so a stalled camera (no new frames) is still detected as frozen.
  const canvas = document.createElement('canvas')
  canvas.width = HEALTH_W
  canvas.height = HEALTH_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let previousFrame: Uint8ClampedArray | null = null

  const sampleHealth = (): void => {
    if (!running || !ctx || video.readyState < 2) return
    const t = performance.now()
    ctx.drawImage(video, 0, 0, HEALTH_W, HEALTH_H)
    const frame = ctx.getImageData(0, 0, HEALTH_W, HEALTH_H).data
    const brightness = meanLuma(frame)
    const changed = previousFrame ? countChangedPixels(previousFrame, frame) : Number.MAX_SAFE_INTEGER
    previousFrame = frame

    const update = frameHealth.sample(t, changed, brightness)
    health.brightness = Math.round(brightness)
    health.frozen = update.frozen
    health.tooBright = update.tooBright
    if (update.lowLightChanged && update.lowLight) emit('LOW_LIGHT', { brightness: Math.round(brightness) })
    if (update.frozenChanged && update.frozen) emit('CAMERA_FROZEN')
    if (t - lastLandmarkAt > 1200) health.fps = 0
  }
  const healthTimer = window.setInterval(sampleHealth, HEALTH_SAMPLE_MS)
  // B: heartbeat every 2 s, so a still face isn't "camera silent", and so "we can't see you" can tell
  // a camera that works (off in Meet) from one that is stuck (no frames, frozen picture).
  const aliveTimer = window.setInterval(() => {
    if (!running) return
    const stuck = health.frozen || video.readyState < 2 || performance.now() - lastLandmarkAt > 2500
    emit('CAMERA_ALIVE', { face: !stuck && health.faceInFrame, frozen: stuck })
  }, 2000)
  const loop = (): void => {
    if (!running) return
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const t = performance.now()
      lastLandmarkAt = t
      const res: FaceLandmarkerResult = landmarker.detectForVideo(video, t)
      const face = res.faceLandmarks.length > 0
      health.faceInFrame = face
      // B: smooth the face box (EMA ~0.5 s at 15-30 fps) so the check-up row doesn't flicker
      const b = face ? faceBox(res.faceLandmarks[0]!) : null
      if (!b) box = null
      else if (!box) box = b
      else {
        const k = 0.15
        box = Object.fromEntries(Object.entries(box).map(([key, v]) => [key, v + k * (b[key as keyof FaceBox] - v)])) as unknown as FaceBox
      }
      health.framing = framing(box)
      frames++
      if (t - fpsSince >= 1000) {
        health.fps = Math.round((frames * 1000) / (t - fpsSince))
        frames = 0
        fpsSince = t
      }
      const blend: Record<string, number> = {}
      for (const c of res.faceBlendshapes[0]?.categories ?? []) blend[c.categoryName] = c.score
      const pose = res.facialTransformationMatrixes[0] ? headPose(res.facialTransformationMatrixes[0].data) : undefined

      const source = gazeStatus().activeSource
      if (source === 'pose') {
        // Keep the gaze tracker fresh while pose is driving; also closes a gaze-away interval.
        const wasGazeAway = gazeTracker.away
        gazeTracker.reset()
        if (wasGazeAway) emitTap('USER_BACK', { gaze: true })
      }
      if (source !== lastActiveSource) {
        if (source === 'pose') console.warn(`[gaze] pose fallback (${gazeStatus().fallbackReason ?? 'unknown'})`)
        else console.info('[gaze] true look-away active')
        lastActiveSource = source
      }

      if (source === 'pose') {
        // Away / back with hysteresis: yaw OR pitch (phone glance) or no face, held > 2 s.
        const yawLimit = away ? AWAY_YAW_EXIT_DEG : AWAY_YAW_ENTER_DEG
        const pitchLimit = away ? AWAY_PITCH_EXIT_DEG : AWAY_PITCH_ENTER_DEG
        const lookingAway = !face || (pose !== undefined && (Math.abs(pose.yaw) > yawLimit || Math.abs(pose.pitch) > pitchLimit))
        if (lookingAway) {
          lookingAwaySince ??= t
          if (!away && t - lookingAwaySince > AWAY_AFTER_MS) {
            away = true
            emit('USER_AWAY', { reason: face ? 'turned_away' : 'no_face' })
            if (!face) emit('FACE_OUT_OF_FRAME')
          }
        } else {
          lookingAwaySince = null
          if (away) {
            away = false
            emit('USER_BACK')
          }
        }
      } else {
        // Gaze mode owns "away"; keep FACE_OUT_OF_FRAME for the check-up and the log.
        if (away) {
          away = false
          emit('USER_BACK')
        }
        lookingAwaySince = null
        if (!face) {
          faceOutSince ??= t
          if (!faceOutSent && t - faceOutSince > AWAY_AFTER_MS) {
            faceOutSent = true
            emit('FACE_OUT_OF_FRAME')
          }
        } else {
          faceOutSince = null
          faceOutSent = false
        }
      }

      // Mouth moving = jaw + lower lip vary over the last second (talking, not just an open mouth).
      // Only trust it at a usable head pose: at a big pitch/yaw the mouth blendshapes drift.
      const poseOkForMouth = face && pose !== undefined && Math.abs(pose.yaw) < AWAY_YAW_ENTER_DEG && Math.abs(pose.pitch) < AWAY_PITCH_ENTER_DEG
      if (poseOkForMouth) {
        jaw.push({ t, v: mouthSignal(blend) })
        while (jaw.length && t - jaw[0].t > MOUTH_WINDOW_MS) jaw.shift()
        const rawActive = mouthMoving(jaw)

        // B's request (real call): debounce the flaps - 300 ms to turn on, 800 ms to turn off.
        if (rawActive === mouthActive) {
          mouthPending = null
        } else {
          if (mouthPending !== rawActive) {
            mouthPending = rawActive
            mouthPendingSince = t
          }
          if (t - mouthPendingSince >= (rawActive ? MOUTH_ON_MS : MOUTH_OFF_MS)) {
            mouthActive = rawActive
            mouthPending = null
            emit('MOUTH_MOVING', { active: mouthActive })
          }
        }
      } else {
        jaw.length = 0
        mouthPending = null
        if (mouthActive) {
          mouthActive = false
          emit('MOUTH_MOVING', { active: false })
        }
      }

      // TODO(A, P1-1): nod / shake (pitch / yaw reversals), brow raise (browInnerUp vs baseline), tilt (roll).
      onFrame?.({ pose, blend, face })
    }
    setTimeout(loop, FRAME_MS)
  }
  // B (Sun 02:00): a timer, not requestAnimationFrame. Animation frames stop when Tap's window is minimized or behind
  // Meet (measured: 2 frames in 2 s minimized), so Tap went blind exactly during the call. Timers keep running
  // (backgroundThrottling is off in index.ts). ~20 analyses per second is plenty for away / mouth / lighting.
  setTimeout(loop, FRAME_MS)

  const track = stream.getVideoTracks()[0]
  if (track) {
    // Camera unplugged, stopped by the OS, or grabbed by another app.
    track.onended = () => {
      health.running = false
    }
    track.onmute = () => {
      health.running = false
    }
    track.onunmute = () => {
      if (running) health.running = true
    }
  }

  return () => {
    running = false
    clearInterval(aliveTimer)
    emit('CAMERA_ALIVE', { face: false, frozen: false, stopped: true })
    health.running = false
    health.faceInFrame = false
    health.framing = NO_FACE
    health.frozen = false
    health.brightness = null
    health.tooBright = false
    health.fps = 0
    window.clearInterval(healthTimer)
    if (track) {
      track.onended = null
      track.onmute = null
      track.onunmute = null
    }
    try {
      landmarker.close()
    } catch {
      // already closed
    }
    stream.getTracks().forEach((tr) => tr.stop())
  }
}
