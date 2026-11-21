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

// Starting thresholds from docs/PRD.md §4 "Gesture rules" — tune them during calibration.
const AWAY_YAW_ENTER_DEG = 28
const AWAY_YAW_EXIT_DEG = 18
const AWAY_PITCH_ENTER_DEG = 22
const AWAY_PITCH_EXIT_DEG = 14
const AWAY_AFTER_MS = 2000
const MOUTH_WINDOW_MS = 1000
const MOUTH_STD_MIN = 0.06
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
const TOO_BRIGHT_ENTER = 200 // labelled light test images: 202.3-206.8
const TOO_BRIGHT_EXIT = 180
const LIGHTING_HOLD_MS = 800

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
  frozen: boolean // no changed pixels on the 64x48 canvas for > 3 s
  brightness: number | null // mean luma 0..255; null before the first frame
  tooBright: boolean // mean luma >= 200 for 0.8 s; cleared below 180
  fps: number // 0 when the landmarker stopped receiving frames
}

const health: CameraHealth = { running: false, faceInFrame: false, frozen: false, brightness: null, tooBright: false, fps: 0 }

export function cameraHealth(): CameraHealth {
  return { ...health }
}

export type VisionListener = (info: { pose?: HeadPose; blend: Record<string, number>; face: boolean }) => void

export async function startVision(video: HTMLVideoElement, onFrame?: VisionListener): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
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
  const jaw: Array<{ t: number; v: number }> = []
  const emit = (type: EventType, data?: Record<string, unknown>): void => window.tap.emit(makeEvent(type, 'webcam', data))

  let running = true
  let lastVideoTime = -1
  let lastLandmarkAt = 0
  health.running = true
  health.faceInFrame = false
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
  const loop = (): void => {
    if (!running) return
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const t = performance.now()
      lastLandmarkAt = t
      const res: FaceLandmarkerResult = landmarker.detectForVideo(video, t)
      const face = res.faceLandmarks.length > 0
      health.faceInFrame = face
      frames++
      if (t - fpsSince >= 1000) {
        health.fps = Math.round((frames * 1000) / (t - fpsSince))
        frames = 0
        fpsSince = t
      }
      const blend: Record<string, number> = {}
      for (const c of res.faceBlendshapes[0]?.categories ?? []) blend[c.categoryName] = c.score
      const pose = res.facialTransformationMatrixes[0] ? headPose(res.facialTransformationMatrixes[0].data) : undefined

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

      // Mouth moving = jawOpen varies over the last second (talking, not just an open mouth).
      // Only trust it at a usable head pose: at a big pitch/yaw the jawOpen blendshape drifts.
      const poseOkForMouth = face && pose !== undefined && Math.abs(pose.yaw) < AWAY_YAW_ENTER_DEG && Math.abs(pose.pitch) < AWAY_PITCH_ENTER_DEG
      if (poseOkForMouth) {
        jaw.push({ t, v: blend['jawOpen'] ?? 0 })
        while (jaw.length && t - jaw[0].t > MOUTH_WINDOW_MS) jaw.shift()
        const mean = jaw.reduce((s, x) => s + x.v, 0) / jaw.length
        const std = Math.sqrt(jaw.reduce((s, x) => s + (x.v - mean) ** 2, 0) / jaw.length)
        const rawActive = std > MOUTH_STD_MIN

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
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

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
    health.running = false
    health.faceInFrame = false
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
