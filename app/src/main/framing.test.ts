import { test } from 'node:test'
import assert from 'node:assert/strict'
import { faceBox, framing } from '../shared/framing.ts'

// A face as a box of points: centre (cx, cy), width w, height h (0..1 of the picture)
const face = (cx: number, cy: number, w: number, h = w * 1.3) =>
  faceBox([{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx, y: cy }])

test('framing: centered and a normal size → ok', () => {
  assert.deepEqual(framing(face(0.5, 0.5, 0.3)), { ok: true, text: 'face centered' })
  assert.equal(framing(face(0.6, 0.42, 0.3)).ok, true, 'a little off is fine')
})

test('framing: a face is found but it is not well framed (the old check said ✓)', () => {
  assert.deepEqual(framing(null), { ok: false, text: 'no face found', hint: 'Sit in front of the camera.' })
  const r = framing(face(0.8, 0.5, 0.3))
  assert.equal(r.ok, false)
  assert.equal(r.text, 'face not centered')
  // raw picture: face on the right = the user sits to their left → move to their right
  assert.equal(!r.ok && r.hint, 'Move a bit to your right.')
  assert.equal(!framing(face(0.2, 0.5, 0.3)).ok && (framing(face(0.2, 0.5, 0.3)) as { hint: string }).hint, 'Move a bit to your left.')
  assert.match((framing(face(0.5, 0.75, 0.2)) as { hint: string }).hint, /Move up a bit/)
  assert.equal(framing(face(0.5, 0.5, 0.08)).text, 'face too small')
  assert.equal(framing(face(0.5, 0.5, 0.7, 0.7)).text, 'too close')
})

test('framing: partly out of the picture → cut off, with which edge', () => {
  const r = framing(face(0.5, 0.15, 0.3, 0.4)) // top of the head past the top edge
  assert.equal(r.text, 'part of your face is cut off')
  assert.match((r as { hint: string }).hint, /past the top edge/)
})
