/**
 * OWNER: A. Webcam → MediaPipe Face Landmarker → events.
 * Runs on the laptop (wasm + model served locally, see scripts/setup-models.mjs).
 * Done here: USER_AWAY / USER_BACK, MOUTH_MOVING, FACE_OUT_OF_FRAME.
 * TODO(A): move into a Web Worker if the UI stutters; gestures (P1-1); CAMERA_FROZEN; LOW_LIGHT; calibration.
 */
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import type { EventType } from '../../shared/events'
import { makeEvent } from '../../shared/events'

// Starting thresholds from docs/PRD.md §4 "Gesture rules" — tune them during calibration.
const AWAY_YAW_DEG = 28
const AWAY_AFTER_MS = 2000
const MOUTH_WINDOW_MS = 1000
const MOUTH_STD_MIN = 0.06

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
  frozen: boolean // TODO(A): compare consecutive frames on a 64×48 canvas
  brightness: number | null // TODO(A): mean luma 0..255 from the same small canvas; < ~60 = too dark
  fps: number
}

const health: CameraHealth = { running: false, faceInFrame: false, frozen: false, brightness: null, fps: 0 }

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
  const jaw: Array<{ t: number; v: number }> = []
  const emit = (type: EventType, data?: Record<string, unknown>): void => window.tap.emit(makeEvent(type, 'webcam', data))

  let running = true
  let lastVideoTime = -1
  health.running = true
  let frames = 0
  let fpsSince = performance.now()
  const loop = (): void => {
    if (!running) return
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const t = performance.now()
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

      // Away = no face, or head turned far to the side, for > 2 s.
      const lookingAway = !face || (pose !== undefined && Math.abs(pose.yaw) > AWAY_YAW_DEG)
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
      if (face) {
        jaw.push({ t, v: blend['jawOpen'] ?? 0 })
        while (jaw.length && t - jaw[0].t > MOUTH_WINDOW_MS) jaw.shift()
        const mean = jaw.reduce((s, x) => s + x.v, 0) / jaw.length
        const std = Math.sqrt(jaw.reduce((s, x) => s + (x.v - mean) ** 2, 0) / jaw.length)
        const active = std > MOUTH_STD_MIN
        if (active !== mouthActive) {
          mouthActive = active
          emit('MOUTH_MOVING', { active })
        }
      }

      // TODO(A, P1-1): nod / shake (pitch / yaw reversals), brow raise (browInnerUp vs baseline), tilt (roll).
      onFrame?.({ pose, blend, face })
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  return () => {
    running = false
    health.running = false
    landmarker.close()
    stream.getTracks().forEach((tr) => tr.stop())
  }
}
