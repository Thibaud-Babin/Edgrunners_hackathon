/**
 * B: is the face well framed for the call? "A face was found" is not enough: it can be half out of the picture,
 * off to one side, or tiny. Pure (tested in main/framing.test.ts); vision.ts feeds it the Face Landmarker points.
 */

/** Face points in 0..1 of the camera picture (raw, not mirrored), as the Face Landmarker gives them. */
export interface Pt {
  x: number
  y: number
}

/** The face box, smoothed over a few frames by the caller. */
export interface FaceBox {
  cx: number // centre, 0..1
  cy: number
  w: number // width, share of the picture's width
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type Framing =
  | { ok: true; text: string }
  | { ok: false; text: string; hint: string }

export const CENTER_TOL = 0.15 // the face centre may be this far from the middle
export const MIN_W = 0.12 // smaller → too far
export const MAX_W = 0.6 // larger → too close
export const EDGE = 0.01 // a point this close to the edge → cut off

export function faceBox(pts: readonly Pt[]): FaceBox | null {
  if (!pts.length) return null
  let minX = 1, maxX = 0, minY = 1, maxY = 0
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, minX, maxX, minY, maxY }
}

/**
 * The first problem, in order of what matters most. Left / right are the user's own: the camera sees them
 * mirrored, so a face on the right of the raw picture means the user sits too far to their left.
 */
export function framing(b: FaceBox | null): Framing {
  if (!b) return { ok: false, text: 'no face found', hint: 'Sit in front of the camera.' }
  if (b.minX <= EDGE || b.maxX >= 1 - EDGE || b.minY <= EDGE || b.maxY >= 1 - EDGE) {
    const side = b.minY <= EDGE ? 'top' : b.maxY >= 1 - EDGE ? 'bottom' : b.maxX >= 1 - EDGE ? 'left' : 'right'
    return { ok: false, text: 'part of your face is cut off', hint: `Your face goes past the ${side} edge. ${move(b) ?? 'Move back a little.'}` }
  }
  if (b.w < MIN_W) return { ok: false, text: 'face too small', hint: 'Move closer to the camera.' }
  if (b.w > MAX_W) return { ok: false, text: 'too close', hint: 'Move back a little.' }
  const m = move(b)
  if (m) return { ok: false, text: 'face not centered', hint: m }
  return { ok: true, text: 'face centered' }
}

function move(b: FaceBox): string | null {
  const dx = b.cx - 0.5
  const dy = b.cy - 0.5
  if (Math.abs(dx) <= CENTER_TOL && Math.abs(dy) <= CENTER_TOL) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'Move a bit to your right.' : 'Move a bit to your left.'
  return dy > 0 ? 'Move up a bit, or tilt the camera down.' : 'Move down a bit, or tilt the camera up.'
}
