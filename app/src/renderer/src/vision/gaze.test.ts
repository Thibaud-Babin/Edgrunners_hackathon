// Run with: node --experimental-strip-types --test src/renderer/src/vision/gaze.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGazeAway, parseGazeSnapshot, type GazeSnapshot } from './gaze.ts'

const cfg = { awayAfterMs: 250, backAfterMs: 500, marginPx: 24, smoothing: 0.35 }

const snap = (over: Partial<GazeSnapshot> = {}): GazeSnapshot => ({
  timestampMs: 1,
  screenW: 1920,
  screenH: 1080,
  calibrated: true,
  tracking: true,
  facePresent: true,
  source: 'geometric',
  gaze: { x: 960, y: 540 },
  ...over
})

test('parses a real snapshot from the tracker protocol', () => {
  const s = parseGazeSnapshot({
    type: 'snapshot',
    timestamp_ms: 123456.7,
    screen: { width_px: 1728, height_px: 1117 },
    gaze: { x_px: 842.1, y_px: 391.6, source: 'geometric' },
    face: { bounding_box_norm: { x: 0.3, y: 0.2, width: 0.3, height: 0.4 } },
    state: { tracking_enabled: true, model_calibrated: true, geometric_calibrated: true }
  })
  assert.ok(s)
  assert.equal(s?.screenW, 1728)
  assert.equal(s?.gaze?.x, 842.1)
  assert.equal(s?.calibrated, true)
  assert.equal(s?.facePresent, true)
  assert.equal(s?.source, 'geometric')
})

test('rejects non-snapshot, missing screen or missing timestamp', () => {
  assert.equal(parseGazeSnapshot({ type: 'ack' }), null)
  assert.equal(parseGazeSnapshot({ type: 'snapshot', timestamp_ms: 1, screen: {} }), null)
  assert.equal(parseGazeSnapshot({ type: 'snapshot', screen: { width_px: 1920, height_px: 1080 } }), null)
})

test('parses gaze null (no prediction)', () => {
  const s = parseGazeSnapshot({
    type: 'snapshot',
    timestamp_ms: 2,
    screen: { width_px: 1920, height_px: 1080 },
    gaze: null,
    state: { tracking_enabled: true, model_calibrated: true }
  })
  assert.equal(s?.gaze, null)
})

test('away after 250 ms off-screen; nothing before', () => {
  const g = createGazeAway(cfg)
  assert.equal(g.update(0, snap({ gaze: { x: -200, y: 300 } })), null)
  assert.equal(g.update(249, snap({ gaze: { x: -200, y: 300 } })), null)
  assert.deepEqual(g.update(250, snap({ gaze: { x: -200, y: 300 } })), { kind: 'away', reason: 'turned_away' })
})

test('a short off-screen blip does not fire', () => {
  const g = createGazeAway(cfg)
  assert.equal(g.update(0, snap({ gaze: { x: -200, y: 300 } })), null)
  assert.equal(g.update(200, snap()), null)
  assert.equal(g.update(400, snap()), null)
  assert.equal(g.away, false)
})

test('back after 500 ms on-screen', () => {
  const g = createGazeAway(cfg)
  g.update(0, snap({ gaze: { x: -200, y: 300 } }))
  assert.equal(g.update(250, snap({ gaze: { x: -200, y: 300 } }))?.kind, 'away')
  assert.equal(g.update(300, snap()), null)
  assert.equal(g.update(799, snap()), null)
  assert.deepEqual(g.update(800, snap()), { kind: 'back' })
})

test('gaze null with no face produces no event', () => {
  const g = createGazeAway(cfg)
  for (let t = 0; t <= 2000; t += 100) assert.equal(g.update(t, snap({ gaze: null, facePresent: false })), null)
  assert.equal(g.away, false)
})

test('gaze null with a face present counts as off-screen', () => {
  const g = createGazeAway(cfg)
  g.update(0, snap({ gaze: null, facePresent: true }))
  assert.deepEqual(g.update(250, snap({ gaze: null, facePresent: true })), { kind: 'away', reason: 'turned_away' })
})

test('an away state survives a gaze-null gap and closes on a real return', () => {
  const g = createGazeAway(cfg)
  g.update(0, snap({ gaze: { x: -200, y: 300 } }))
  assert.equal(g.update(250, snap({ gaze: { x: -200, y: 300 } }))?.kind, 'away')
  assert.equal(g.update(300, snap({ gaze: null })), null)
  assert.equal(g.away, true)
  g.update(400, snap())
  assert.equal(g.update(899, snap()), null)
  assert.deepEqual(g.update(900, snap()), { kind: 'back' })
})

test('uncalibrated or tracking off produces no events', () => {
  const g = createGazeAway(cfg)
  for (let t = 0; t <= 2000; t += 100) {
    assert.equal(g.update(t, snap({ gaze: { x: -500, y: -500 }, calibrated: false })), null)
    assert.equal(g.update(t, snap({ gaze: { x: -500, y: -500 }, tracking: false })), null)
  }
  assert.equal(g.away, false)
})

test('edge margin: just inside the border is on-screen', () => {
  const g = createGazeAway(cfg)
  assert.equal(g.update(0, snap({ gaze: { x: 10, y: 500 } })), null)
  assert.equal(g.update(250, snap({ gaze: { x: 10, y: 500 } }))?.kind, 'away')
})

test('reset clears the away state', () => {
  const g = createGazeAway(cfg)
  g.update(0, snap({ gaze: { x: -100, y: 500 } }))
  g.update(250, snap({ gaze: { x: -100, y: 500 } }))
  assert.equal(g.away, true)
  g.reset()
  assert.equal(g.away, false)
})