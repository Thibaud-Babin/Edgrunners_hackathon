/**
 * OWNER: A. Tiny pure helpers for MOUTH_MOVING: does the mouth move enough over the last second?
 *
 * Talking moves the jaw AND the lips, but normal speech hardly opens the jaw: with jawOpen alone the demo
 * needed an exaggerated wide-open mouth (B, PR #21). The signal is therefore jawOpen + the average of the two
 * lower-lip blendshapes, and the bar is lower. A held-open mouth never passes: MOUTH_MOVING measures variation,
 * not openness. Kept free of MediaPipe types so the decision is unit-tested in mouth.test.ts.
 */
export const MOUTH_STD_MIN = 0.03 // std of the jaw + lower-lip signal over 1 s (B's real-call value, PR #21)

/** MediaPipe blendshape map (name → 0..1) → the mouth-activity signal. A missing blendshape counts as 0. */
export function mouthSignal(blend: Record<string, number>): number {
  return (blend['jawOpen'] ?? 0) + ((blend['mouthLowerDownLeft'] ?? 0) + (blend['mouthLowerDownRight'] ?? 0)) / 2
}

export interface JawSample {
  v: number
}

/** How much the signal moved over the window (not how open the mouth is). */
export function mouthStd(samples: readonly JawSample[]): number {
  if (samples.length < 2) return 0
  const mean = samples.reduce((s, x) => s + x.v, 0) / samples.length
  return Math.sqrt(samples.reduce((s, x) => s + (x.v - mean) ** 2, 0) / samples.length)
}

export function mouthMoving(samples: readonly JawSample[], minStd = MOUTH_STD_MIN): boolean {
  if (samples.length < 2) return false
  return mouthStd(samples) > minStd
}
