/**
 * OWNER: A. Logi Gaze Tracker -> true look-away state machine.
 * Pure module (no DOM, no WebSocket) so it is unit-tested in Node.
 *
 * The Gaze Tracker is a separate Logitech tray app that streams screen-space gaze.
 * Report leaving the tracked display early: C's rules.ts already ignores away intervals
 * under 2 s, so the product's 2 s rule stays in one place.
 */

export interface GazeSnapshot {
  /** Monotonic timestamp from the tracker; used to dedupe re-sent snapshots. */
  timestampMs: number
  screenW: number
  screenH: number
  calibrated: boolean
  tracking: boolean
  facePresent: boolean
  source: string
  /** null when the tracker has no prediction (no face, eyes not visible, not calibrated). */
  gaze: { x: number; y: number } | null
}

export interface GazeConfig {
  awayAfterMs: number
  backAfterMs: number
  tolerancePx: number
  smoothing: number
}

export type GazeUpdate =
  | { kind: 'away'; reason: 'turned_away' | 'no_face'; since: number }
  | { kind: 'back' }
  | null

export interface GazeAwayTracker {
  update(t: number, snapshot: GazeSnapshot | null): GazeUpdate
  readonly away: boolean
  reset(): void
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Parse one Gaze Tracker websocket message. Returns null for anything that is not a usable snapshot. */
export function parseGazeSnapshot(raw: unknown): GazeSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.type !== 'snapshot') return null

  const screen = m.screen as Record<string, unknown> | undefined
  const w = num(screen?.width_px)
  const h = num(screen?.height_px)
  const timestampMs = num(m.timestamp_ms)
  if (w === null || h === null || w <= 0 || h <= 0 || timestampMs === null) return null

  const state = m.state as Record<string, unknown> | undefined
  const tracking = state?.tracking_enabled === true
  const calibrated = state?.model_calibrated === true || state?.geometric_calibrated === true

  const face = m.face as Record<string, unknown> | undefined
  const box = face?.bounding_box_norm as Record<string, unknown> | undefined
  const faceW = num(box?.width)
  const faceH = num(box?.height)
  const facePresent = faceW !== null && faceW > 0 && faceH !== null && faceH > 0

  const g = m.gaze as Record<string, unknown> | null | undefined
  let gaze: { x: number; y: number } | null = null
  let source = 'unknown'
  if (g && typeof g === 'object') {
    const x = num(g.x_px)
    const y = num(g.y_px)
    if (x !== null && y !== null) gaze = { x, y }
    if (typeof g.source === 'string') source = g.source
  }

  return { timestampMs, screenW: w, screenH: h, calibrated, tracking, facePresent, source, gaze }
}

/**
 * Off-screen -> away, on-screen -> back. Gaze null counts as off-screen (no prediction).
 * No usable signal (disconnected / uncalibrated / tracking off) never invents a "back".
 */
export function createGazeAway(cfg: GazeConfig): GazeAwayTracker {
  let away = false
  let offSince: number | null = null
  let onSince: number | null = null
  let sx = 0
  let sy = 0
  let smoothed = false
  let lastAt = 0

  return {
    update(t, s) {
      if (!s || !s.tracking || !s.calibrated) {
        offSince = null
        onSince = null
        smoothed = false
        return null
      }

      if (!s.gaze && !s.facePresent) {
        // No face at all: no signal (the tracker camera may be blocked). Keep any current away state.
        offSince = null
        onSince = null
        smoothed = false
        return null
      }

      let inside = false
      if (s.gaze) {
        if (!smoothed || t - lastAt > 1000) {
          sx = s.gaze.x
          sy = s.gaze.y
          smoothed = true
        } else {
          sx = cfg.smoothing * s.gaze.x + (1 - cfg.smoothing) * sx
          sy = cfg.smoothing * s.gaze.y + (1 - cfg.smoothing) * sy
        }
        lastAt = t
        const tol = cfg.tolerancePx
        inside = sx >= -tol && sx <= s.screenW + tol && sy >= -tol && sy <= s.screenH + tol
      }
      // gaze null + face present = the user is there but there is no prediction
      // (eyes not visible / looking far off-screen): treat it as off-screen.

      if (!away) {
        if (!inside) {
          offSince ??= t
          if (t - offSince >= cfg.awayAfterMs) {
            away = true
            onSince = null
            return { kind: 'away', reason: 'turned_away', since: offSince ?? t }
          }
        } else {
          offSince = null
        }
        return null
      }

      if (inside) {
        onSince ??= t
        if (t - onSince >= cfg.backAfterMs) {
          away = false
          offSince = null
          return { kind: 'back' }
        }
      } else {
        onSince = null
      }
      return null
    },

    get away() {
      return away
    },

    reset() {
      away = false
      offSince = null
      onSince = null
      smoothed = false
    }
  }
}

export type GazeFallbackReason = 'not-connected' | 'uncalibrated' | 'stale' | 'no-face'

export interface GazeAvailabilityInput {
  connected: boolean
  calibrated: boolean
  lastSnapshotAt: number | null
  lastFaceAt: number | null
  lastGazeAt: number | null
  now: number
  staleMs: number
  noFaceMs: number
}

export interface GazeAvailability {
  usable: boolean
  reason: GazeFallbackReason | null
}

/** Can the tracker drive away right now? Otherwise the caller falls back to head pose. */
export function gazeAvailability(i: GazeAvailabilityInput): GazeAvailability {
  if (!i.connected) return { usable: false, reason: 'not-connected' }
  if (!i.calibrated) return { usable: false, reason: 'uncalibrated' }
  if (i.lastSnapshotAt === null || i.now - i.lastSnapshotAt > i.staleMs) return { usable: false, reason: 'stale' }

  const faceRecent = i.lastFaceAt !== null && i.now - i.lastFaceAt <= i.noFaceMs
  const gazeRecent = i.lastGazeAt !== null && i.now - i.lastGazeAt <= i.noFaceMs
  if (!faceRecent && !gazeRecent) return { usable: false, reason: 'no-face' }
  return { usable: true, reason: null }
}
