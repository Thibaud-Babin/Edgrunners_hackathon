import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gate } from './executor.ts'

const T0 = { action: 'send_haptic', waveform: 'knock', why: 'test' }
const T1 = { action: 'switch_input_device', prefer: 'laptop', why: 'test' }
const T2 = { action: 'post_chat_reply', text: 'Yes', why: 'test' }

test('llm and transcript provenance never trigger anything, not even T0', () => {
  for (const p of ['llm', 'transcript'] as const) for (const req of [T0, T1, T2]) assert.equal(gate(req, p).ok, false, `${p} ${req.action}`)
})

test('detector, vision and system provenance may trigger T0 only', () => {
  for (const p of ['detector', 'vision', 'system'] as const) {
    assert.equal(gate(T0, p).ok, true)
    assert.equal(gate(T1, p).ok, false, `${p} T1`)
    assert.equal(gate(T2, p).ok, false, `${p} T2`)
  }
})

test('user provenance passes the provenance gate', () => {
  for (const req of [T0, T1, T2]) assert.equal(gate(req, 'user').ok, true)
})

test('actions not on the allowlist are blocked whatever the provenance', () => {
  assert.equal(gate({ action: 'unmute_everyone', why: 'x' }, 'user').ok, false)
  assert.equal(gate({ ...T2, extra: 1 }, 'user').ok, false)
})
