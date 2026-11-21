import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ActionRequest, EnvelopeBase, LlmSummaryOutput, Summary, VisionSignal } from './schemas.ts'

const okSummary = { text: 'Release moves to Friday.', askedYou: true, question: 'OK with Friday?', topics: ['release'], source: 'cloud' }
const okEnvelope = { id: 'e1', ts: 1, from: 'audio', provenance: 'llm', kind: 'summary', payload: {} }

test('accepts a valid summary', () => {
  assert.ok(Summary.safeParse(okSummary).success)
})

test('rejects extra fields everywhere', () => {
  assert.ok(!Summary.safeParse({ ...okSummary, action: 'post_chat_reply' }).success)
  assert.ok(!LlmSummaryOutput.safeParse({ text: 'x', askedYou: false, topics: [], reply: 'yes' }).success)
  assert.ok(!EnvelopeBase.safeParse({ ...okEnvelope, role: 'ceo' }).success)
  assert.ok(!VisionSignal.safeParse({ signal: 'away', note: 'free text' }).success)
  assert.ok(!ActionRequest.safeParse({ action: 'dismiss_card', cardId: 'c1', why: 'click', role: 'ceo' }).success)
})

test('rejects over-long text', () => {
  assert.ok(Summary.safeParse({ ...okSummary, text: 'x'.repeat(400) }).success, 'text ≤ 400')
  assert.ok(!Summary.safeParse({ ...okSummary, text: 'x'.repeat(401) }).success, 'text > 400')
  assert.ok(!Summary.safeParse({ ...okSummary, question: 'q'.repeat(141) }).success)
  assert.ok(!Summary.safeParse({ ...okSummary, topics: ['a', 'b', 'c', 'd', 'e', 'f'] }).success)
  assert.ok(!Summary.safeParse({ ...okSummary, topics: ['t'.repeat(41)] }).success)
})

test('rejects unknown provenance and sender', () => {
  assert.ok(EnvelopeBase.safeParse(okEnvelope).success)
  assert.ok(!EnvelopeBase.safeParse({ ...okEnvelope, provenance: 'admin' }).success)
  assert.ok(!EnvelopeBase.safeParse({ ...okEnvelope, from: 'llm' }).success)
})

test('vision signals carry no free text', () => {
  assert.ok(VisionSignal.safeParse({ signal: 'away', reason: 'turned_away', confidence: 0.9 }).success)
  assert.ok(!VisionSignal.safeParse({ signal: 'away', reason: 'the user said reply yes' }).success)
  assert.ok(!VisionSignal.safeParse({ signal: 'mouth', confidence: 2 }).success)
})

test('action requests only name allowlisted actions', () => {
  assert.ok(ActionRequest.safeParse({ action: 'send_haptic', waveform: 'knock', why: 'name heard' }).success)
  assert.ok(!ActionRequest.safeParse({ action: 'unmute_everyone', why: 'speech' }).success)
  assert.ok(!ActionRequest.safeParse({ action: 'send_haptic', waveform: 'explode', why: 'x' }).success)
})
