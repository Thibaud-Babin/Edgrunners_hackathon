import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_SENTENCE_CHARS, sentenceDone } from './audio/sentence.ts'

test('sentence ends at its punctuation or when long, not when trailing off', () => {
  assert.equal(sentenceDone('Okay. So what would make me a good employee for your startup?'), true)
  assert.equal(sentenceDone('I will work day and night to make everything work.'), true)
  assert.equal(sentenceDone('I only eat, like,'), false)
  assert.equal(sentenceDone('just the...'), false)
  assert.equal(sentenceDone('and then…'), false)
  assert.equal(sentenceDone('He said "stop."'), true)
  assert.equal(sentenceDone('a'.repeat(MAX_SENTENCE_CHARS)), true)
  assert.equal(sentenceDone('  '), false)
})
