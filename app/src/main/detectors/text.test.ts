// Run with: npm test   (Node's built-in test runner, no extra deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findName, findTrouble, isQuestion } from './text.ts'

const NAMES = ['Thibaud', 'Thibault', 'Tibo']

test('finds the exact name', () => {
  assert.ok(findName('so Thibaud, are you OK with Friday?', NAMES))
})

test('finds ASR spellings of the name', () => {
  assert.ok(findName('Tibeau what do you think', NAMES))
  assert.ok(findName('thibeaux can you check', NAMES))
})

test('real sherpa-onnx outputs (Windows TTS through the speakers, 2026-11-21)', () => {
  assert.ok(findName('Tiboo what do you think a boozhabitjay', NAMES)) // "Tibo, what do you think about the budget?"
  assert.ok(findName('Suitiboo ario kait friday', NAMES)) // "So Thibaud, are you OK with Friday?"
  assert.equal(findName("Let's talk a boozoo tabou by the window", NAMES), null)
  assert.equal(findName('The release his moving to friday because the testa not ready', NAMES), null)
})

test('does not fire on unrelated speech', () => {
  assert.equal(findName('the table is over there by the window', NAMES), null)
  assert.equal(findName('let us talk about the budget', NAMES), null)
})

test('detects trouble phrases', () => {
  assert.equal(findTrouble('Hello? Can you hear me?'), 'cant_hear')
  assert.equal(findTrouble("sorry we can't hear you"), 'cant_hear')
  assert.equal(findTrouble("I think you're frozen"), 'frozen')
  assert.equal(findTrouble('the release is on Friday'), null)
  assert.equal(findTrouble('Yes, I can hear you. Your audio is fine now.'), null) // real false alert, 2026-11-21
  assert.equal(findTrouble("can't hear you. i think you're on mute."), 'cant_hear')
})

test('detects questions', () => {
  assert.ok(isQuestion('are you ok with friday'))
  assert.ok(isQuestion('Friday works for you?'))
  assert.ok(!isQuestion('the release moved to friday'))
})
