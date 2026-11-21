import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gate } from './executor.ts'
import { ROLES } from './permissions.ts'

const T0 = { action: 'send_haptic', waveform: 'knock', why: 'test' }
const T1 = { action: 'switch_input_device', prefer: 'laptop', why: 'test' }
const T2 = { action: 'post_chat_reply', text: 'Yes', why: 'test' }

test('llm and transcript provenance never trigger anything, not even T0, for any role', () => {
  for (const role of ROLES) for (const p of ['llm', 'transcript'] as const) for (const req of [T0, T1, T2]) {
    assert.equal(gate(req, p, role, 'click').verdict, 'block', `${role} ${p} ${req.action}`)
  }
})

test('detector, vision and system provenance may trigger T0 only', () => {
  for (const p of ['detector', 'vision', 'system'] as const) {
    assert.equal(gate(T0, p, 'ceo', null).verdict, 'run')
    assert.equal(gate(T1, p, 'ceo', null).verdict, 'block', `${p} T1`)
    assert.equal(gate(T2, p, 'ceo', null).verdict, 'block', `${p} T2`)
  }
})

test('T1+ without a user trigger is blocked', () => {
  assert.equal(gate(T1, 'user', 'ceo', null).verdict, 'block')
  assert.equal(gate(T2, 'user', 'ceo', null).verdict, 'block')
})

test('role decides once provenance passes', () => {
  assert.equal(gate(T1, 'user', 'intern', 'nod').verdict, 'confirm')
  assert.equal(gate(T1, 'user', 'intern', 'click').verdict, 'run', 'a click on the fix card is the confirmation')
  assert.equal(gate(T1, 'user', 'senior', 'nod').verdict, 'run')
  assert.equal(gate(T2, 'user', 'intern', 'nod').verdict, 'deny')
  assert.equal(gate(T2, 'user', 'intern', 'click').verdict, 'deny', 'interns cannot reply even by click')
  assert.equal(gate(T2, 'user', 'senior', 'nod').verdict, 'confirm')
})

test('T2 never runs from a gesture alone, for any role', () => {
  for (const role of ROLES) for (const g of ['nod', 'shake', 'brow_raise'] as const) assert.notEqual(gate(T2, 'user', role, g).verdict, 'run')
})

test('actions not on the allowlist are blocked whatever the provenance', () => {
  assert.equal(gate({ action: 'unmute_everyone', why: 'x' }, 'user', 'ceo', 'click').verdict, 'block')
  assert.equal(gate({ ...T2, extra: 1 }, 'user', 'ceo', 'click').verdict, 'block')
})
