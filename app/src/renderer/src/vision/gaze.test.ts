// Run with: node --experimental-strip-types --test src/renderer/src/vision/gaze.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGazeAway, gazeAvailability, parseGazeSnapshot, type GazeSnapshot } from './gaze.ts'

const cfg = { awayAfterMs: 3000, backAfterMs: 700, tolerancePx: 64, smoothing: 0.25 }

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

test('away after 3 s off-screen, with the first-off-screen timestamp', () => {
  const g = createGazeAway(cfg)
  assert.equal(g.update(0, snap({ gaze: { x: -200, y: 300 } })), null)
  assert.equal(g.update(2999, snap({ gaze: { x: -200, y: 300 } })), null)
  assert.deepEqual(g.update(3000, snap({ gaze: { x: -200, y: 300 } })), { kind: 'away', reason: 'turned_away', since: 0 })
})

test('a short off-screen blip does not fire', () => {
  const g = createGazeAway(cfg)
  assert.equal(g.update(0, snap({ gaze: { x: -200, y: 300 } })), null)
  assert.equal(g.update(2000, snap()), null)
  assert.equal(g.update(4000, snap()), null)
  assert.equal(g.away, false)
})

test('back after 700 ms on-screen', () => {
  const g = createGazeAway(cfg)
  g.update(0, snap({ gaze: { x: -200, y: 300 } }))
  assert.equal(g.update(3000, snap({ gaze: { x: -200, y: 300 } }))?.kind, 'away')
  assert.equal(g.update(3100, snap()), null)
  assert.equal(g.update(3799, snap()), null)
  assert.deepEqual(g.update(3800, snap()), { kind: 'back' })
})

test('gaze null with no face produces no event', () => {
  const g = createGazeAway(cfg)
  for (let t = 0; t <= 4000; t += 100) assert.equal(g.update(t, snap({ gaze: null, facePresent: false })), null)
  assert.equal(g.away, false)
})

test('gaze null with a face present counts as off-screen', () => {
  const g = createGazeAway(cfg)
  g.update(0, snap({ gaze: null, facePresent: true }))
  assert.deepEqual(g.update(3000, snap({ gaze: null, facePresent: true })), { kind: 'away', reason: 'turned_away', since: 0 })
})

test('an away state survives a gaze-null gap and closes on a real return', () => {
  const g = createGazeAway(cfg)
  g.update(0, snap({ gaze: { x: -200, y: 300 } }))
  assert.equal(g.update(3000, snap({ gaze: { x: -200, y: 300 } }))?.kind, 'away')
  assert.equal(g.update(3100, snap({ gaze: null })), null)
  assert.equal(g.away, true)
  g.update(3200, snap())
  assert.equal(g.update(3899, snap()), null)
  assert.deepEqual(g.update(3900, snap()), { kind: 'back' })
})

test('uncalibrated or tracking off produces no events', () => {
  const g = createGazeAway(cfg)
  for (let t = 0; t <= 4000; t += 100) {
    assert.equal(g.update(t, snap({ gaze: { x: -500, y: -500 }, calibrated: false })), null)
    assert.equal(g.update(t, snap({ gaze: { x: -500, y: -500 }, tracking: false })), null)
  }
  assert.equal(g.away, false)
})

test('64 px outward tolerance: 10 and -60 are on-screen, -70 is off-screen', () => {
  const g1 = createGazeAway(cfg)
  assert.equal(g1.update(0, snap({ gaze: { x: 10, y: 500 } })), null)
  assert.equal(g1.update(3000, snap({ gaze: { x: 10, y: 500 } })), null)
  assert.equal(g1.away, false)

  const g2 = createGazeAway(cfg)
  assert.equal(g2.update(0, snap({ gaze: { x: -60, y: 500 } })), null)
  assert.equal(g2.update(3000, snap({ gaze: { x: -60, y: 500 } })), null)
  assert.equal(g2.away, false)

  const g3 = createGazeAway(cfg)
  g3.update(0, snap({ gaze: { x: -70, y: 500 } }))
  assert.equal(g3.update(3000, snap({ gaze: { x: -70, y: 500 } }))?.kind, 'away')
})

test('reset clears the away state', () => {
  const g = createGazeAway(cfg)
  g.update(0, snap({ gaze: { x: -500, y: 500 } }))
  g.update(3000, snap({ gaze: { x: -500, y: 500 } }))
  assert.equal(g.away, true)
  g.reset()
  assert.equal(g.away, false)
})

test('availability: usable / not connected / uncalibrated / stale / no face', () => {
  const base = {
    connected: true,
    calibrated: true,
    lastSnapshotAt: 3900,
    lastFaceAt: 3800,
    lastGazeAt: 3850,
    now: 4000,
    staleMs: 3000,
    noFaceMs: 3000
  }
  assert.deepEqual(gazeAvailability(base), { usable: true, reason: null })
  assert.deepEqual(gazeAvailability({ ...base, connected: false }), { usable: false, reason: 'not-connected' })
  assert.deepEqual(gazeAvailability({ ...base, calibrated: false }), { usable: false, reason: 'uncalibrated' })
  assert.deepEqual(gazeAvailability({ ...base, lastSnapshotAt: 0 }), { usable: false, reason: 'stale' })
  assert.deepEqual(gazeAvailability({ ...base, lastFaceAt: 0, lastGazeAt: 0 }), { usable: false, reason: 'no-face' })
  assert.deepEqual(gazeAvailability({ ...base, lastGazeAt: null }), { usable: true, reason: null })
  assert.deepEqual(gazeAvailability({ ...base, lastFaceAt: null }), { usable: true, reason: null })
})