/**
 * OWNER: A. Tiny pure helper for MOUTH_MOVING: is jawOpen varying enough over the last second?
 * Talking produces a small oscillation; a static open mouth or a still face does not.
 */
export const MOUTH_STD_MIN = 0.035 // std of jawOpen; 0.06 forced an exaggerated open/close to trigger

export interface JawSample {
  v: number
}

export function mouthMoving(samples: readonly JawSample[], minStd = MOUTH_STD_MIN): boolean {
  if (samples.length < 2) return false
  const mean = samples.reduce((s, x) => s + x.v, 0) / samples.length
  const std = Math.sqrt(samples.reduce((s, x) => s + (x.v - mean) ** 2, 0) / samples.length)
  return std > minStd
}
