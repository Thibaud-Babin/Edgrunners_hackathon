import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mouthMoving } from './mouth.ts'

const samples = (...v: number[]) => v.map((x) => ({ v: x }))

test('a static open mouth is not talking', () => {
  assert.equal(mouthMoving(samples(0.6, 0.6, 0.6)), false)
})

test('tiny lip noise stays quiet', () => {
  assert.equal(mouthMoving(samples(0.15, 0.2, 0.15)), false)
})

test('a small speech oscillation is detected at 0.035 (the old 0.06 missed it)', () => {
  assert.equal(mouthMoving(samples(0.15, 0.23, 0.15)), true)
})

test('a clear open/close is talking', () => {
  assert.equal(mouthMoving(samples(0.1, 0.5)), true)
})
