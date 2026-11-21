// Run with: node --experimental-strip-types --test src/renderer/src/vision/health.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countChangedPixels, createFrameHealth, meanLuma } from './health.ts'

const cfg = {
  frozenAfterMs: 3000,
  maxChangedPixels: 3,
  lowLightEnter: 60,
  lowLightExit: 80,
  tooBrightEnter: 200,
  tooBrightExit: 180,
  lightingHoldMs: 800
}

function rgba(r: number, g: number, b: number, pixels: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return data
}

function classify(brightness: number) {
  const h = createFrameHealth({ ...cfg, lightingHoldMs: 0 })
  h.sample(0, 100, brightness)
  return h.sample(1, 100, brightness)
}

test('mean luma: black is 0, white is ~255', () => {
  assert.equal(meanLuma(rgba(0, 0, 0, 4)), 0)
  assert.ok(Math.abs(meanLuma(rgba(255, 255, 255, 4)) - 255) < 0.01)
})

test('changed pixels ignores tiny noise but sees a real change', () => {
  const a = rgba(100, 100, 100, 2)
  assert.equal(countChangedPixels(a, rgba(100, 100, 100, 2)), 0)
  assert.equal(countChangedPixels(a, rgba(101, 100, 100, 2)), 0)
  const b = rgba(100, 100, 100, 2)
  b[0] = 120
  assert.equal(countChangedPixels(a, b), 1)
})

test('frozen after 3 s of identical frames, unfreezes on motion', () => {
  const h = createFrameHealth(cfg)
  assert.equal(h.sample(0, 0, 120).frozen, false)
  assert.equal(h.sample(2999, 0, 120).frozen, false)
  const frozen = h.sample(3001, 0, 120)
  assert.equal(frozen.frozen, true)
  assert.equal(frozen.frozenChanged, true)
  const moved = h.sample(3250, 300, 120)
  assert.equal(moved.frozen, false)
  assert.equal(moved.frozenChanged, true)
})

test('low light enters below 60 after a hold and only exits above 80', () => {
  const h = createFrameHealth(cfg)
  assert.equal(h.sample(0, 999, 55).lowLight, false)
  assert.equal(h.sample(700, 999, 55).lowLight, false)
  assert.equal(h.sample(900, 999, 55).lowLight, true)
  assert.equal(h.sample(1200, 999, 70).lowLight, true)
  assert.equal(h.sample(1400, 999, 85).lowLight, false)
})

test('too bright enters above 200 after a hold and only exits below 180', () => {
  const h = createFrameHealth(cfg)
  assert.equal(h.sample(0, 999, 205).tooBright, false)
  assert.equal(h.sample(700, 999, 205).tooBright, false)
  assert.equal(h.sample(900, 999, 205).tooBright, true)
  assert.equal(h.sample(1200, 999, 190).tooBright, true)
  assert.equal(h.sample(1400, 999, 175).tooBright, false)
})

// Means measured on the labelled 8-image test set at 64x48 (4 dark / 4 light; images not committed).
test('the 8 labelled sample images are classified correctly', () => {
  for (const mean of [31.5, 10.9, 28.4, 16.6]) {
    const u = classify(mean)
    assert.equal(u.lowLight, true, `mean ${mean} should be too dark`)
    assert.equal(u.tooBright, false, `mean ${mean} should not be too bright`)
  }
  for (const mean of [203.5, 202.3, 206.8, 202.9]) {
    const u = classify(mean)
    assert.equal(u.lowLight, false, `mean ${mean} should not be too dark`)
    assert.equal(u.tooBright, true, `mean ${mean} should be too bright`)
  }
})