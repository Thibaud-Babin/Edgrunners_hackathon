import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOUTH_STD_MIN, mouthMoving, mouthSignal, mouthStd } from './mouth.ts'

const samples = (...v: number[]) => v.map((x) => ({ v: x }))

test('the signal is the jaw plus the average of the two lower lips', () => {
  // 0.25 + (0.125 + 0.125) / 2 = 0.375: exact in binary, so the assertion stays strict
  assert.equal(mouthSignal({ jawOpen: 0.25, mouthLowerDownLeft: 0.125, mouthLowerDownRight: 0.125 }), 0.375)
  assert.equal(mouthSignal({ mouthLowerDownLeft: 0.5 }), 0.25) // a missing blendshape counts as 0
})

test('a static open mouth is not talking', () => {
  assert.equal(mouthMoving(samples(0.6, 0.6, 0.6)), false) // openness is not movement
})

test('idle jitter stays under the threshold', () => {
  assert.equal(mouthStd(samples(0.15, 0.17, 0.15)) < MOUTH_STD_MIN, true) // std 0.009
  assert.equal(mouthMoving(samples(0.15, 0.2)), false) // std 0.025
})

test('normal speech is detected (the old 0.06 on jawOpen alone needed a wide-open mouth)', () => {
  assert.equal(mouthMoving(samples(0.15, 0.23, 0.15)), true) // std 0.038
})

test('the lower lip alone counts: jawOpen flat at 0.1 is still talking (PR #21)', () => {
  const closed = mouthSignal({ jawOpen: 0.1, mouthLowerDownLeft: 0.05, mouthLowerDownRight: 0.05 })
  const open = mouthSignal({ jawOpen: 0.1, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3 })
  assert.equal(mouthMoving(samples(closed, open)), true) // jawOpen moved nowhere: exactly what 0.06 missed
})

test('a clear open/close is talking; too few samples never is', () => {
  assert.equal(mouthMoving(samples(0.1, 0.5)), true)
  assert.equal(mouthMoving(samples(0.5)), false)
  assert.equal(mouthStd([]), 0)
})
