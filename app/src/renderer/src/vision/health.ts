/**
 * Camera frame health: brightness, frozen frames, low light, too bright.
 * Pure module (works on RGBA buffers) so it can be unit-tested in Node.
 */

/** Mean luma (0..255) of an RGBA buffer (Rec. 601 weights). */
export function meanLuma(rgba: Uint8ClampedArray): number {
  let sum = 0
  let pixels = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
    pixels++
  }
  return pixels === 0 ? 0 : sum / pixels
}

/** Number of pixels whose R/G/B changed by more than tolerance between two RGBA buffers. */
export function countChangedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance = 2): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER
  let changed = 0
  for (let i = 0; i + 3 < a.length; i += 4) {
    if (
      Math.abs(a[i] - b[i]) > tolerance ||
      Math.abs(a[i + 1] - b[i + 1]) > tolerance ||
      Math.abs(a[i + 2] - b[i + 2]) > tolerance
    ) {
      changed++
    }
  }
  return changed
}

export interface FrameHealthConfig {
  frozenAfterMs: number
  /** A real camera always has sensor noise; a stalled one repeats identical frames. */
  maxChangedPixels: number
  lowLightEnter: number
  lowLightExit: number
  tooBrightEnter: number
  tooBrightExit: number
  /** How long a lighting condition must hold before it is reported. */
  lightingHoldMs: number
}

export interface FrameHealthUpdate {
  frozen: boolean
  lowLight: boolean
  tooBright: boolean
  frozenChanged: boolean
  lowLightChanged: boolean
  tooBrightChanged: boolean
}

export interface FrameHealth {
  sample(t: number, changedPixels: number, brightness: number): FrameHealthUpdate
  readonly frozen: boolean
  readonly lowLight: boolean
  readonly tooBright: boolean
}

export function createFrameHealth(cfg: FrameHealthConfig): FrameHealth {
  let frozen = false
  let frozenSince: number | null = null
  let lowLight = false
  let lowSince: number | null = null
  let tooBright = false
  let brightSince: number | null = null

  return {
    sample(t, changedPixels, brightness) {
      let frozenChanged = false
      let lowLightChanged = false
      let tooBrightChanged = false

      // Frozen = (almost) no pixel changed for a while. Real cameras are noisy; a stalled driver is not.
      if (changedPixels <= cfg.maxChangedPixels) {
        frozenSince ??= t
        if (!frozen && t - frozenSince >= cfg.frozenAfterMs) {
          frozen = true
          frozenChanged = true
        }
      } else {
        frozenSince = null
        if (frozen) {
          frozen = false
          frozenChanged = true
        }
      }

      // Lighting with hysteresis + a short hold, so a hand passing in front does not flash.
      if (brightness <= cfg.lowLightEnter) {
        lowSince ??= t
        if (!lowLight && t - lowSince >= cfg.lightingHoldMs) {
          lowLight = true
          lowLightChanged = true
        }
      } else if (lowLight && brightness >= cfg.lowLightExit) {
        lowLight = false
        lowLightChanged = true
      } else if (brightness > cfg.lowLightEnter) {
        lowSince = null
      }

      if (brightness >= cfg.tooBrightEnter) {
        brightSince ??= t
        if (!tooBright && t - brightSince >= cfg.lightingHoldMs) {
          tooBright = true
          tooBrightChanged = true
        }
      } else if (tooBright && brightness <= cfg.tooBrightExit) {
        tooBright = false
        tooBrightChanged = true
      } else if (brightness < cfg.tooBrightEnter) {
        brightSince = null
      }

      return { frozen, lowLight, tooBright, frozenChanged, lowLightChanged, tooBrightChanged }
    },

    get frozen() {
      return frozen
    },

    get lowLight() {
      return lowLight
    },

    get tooBright() {
      return tooBright
    }
  }
}