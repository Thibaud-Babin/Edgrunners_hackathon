import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_TIER, MATRIX, permission, ROLE_FLAGS, RoleState, roleFromConfig, ROLES, type Permission, type Tier, type UserRole } from './permissions.ts'
import { gate } from './executor.ts'

// The policy table written out cell by cell: changing MATRIX must be a deliberate change here too.
const EXPECTED: [Tier, UserRole, Permission][] = [
  [0, 'intern', 'auto'], [0, 'senior', 'auto'], [0, 'executive', 'auto'], [0, 'ceo', 'auto'],
  [1, 'intern', 'click'], [1, 'senior', 'click'], [1, 'executive', 'click'], [1, 'ceo', 'click'],
  [2, 'intern', 'deny'], [2, 'senior', 'click'], [2, 'executive', 'click'], [2, 'ceo', 'click'],
  [3, 'intern', 'deny'], [3, 'senior', 'deny'], [3, 'executive', 'click'], [3, 'ceo', 'click']
]
for (const [tier, role, want] of EXPECTED) test(`T${tier} × ${role} = ${want}`, () => assert.equal(MATRIX[tier][role], want))

test('the matrix has exactly 16 cells and nothing is ever automatic above T0', () => {
  assert.equal(Object.values(MATRIX).flatMap((r) => Object.keys(r)).length, 16)
  for (const t of [1, 2, 3] as const) for (const r of ROLES) assert.notEqual(MATRIX[t][r], 'auto')
})

test('action tiers: cards are T0, own device and own data are T1; nothing is T2 or T3 today', () => {
  assert.equal(ACTION_TIER.fix_mic, 1)
  assert.equal(ACTION_TIER.switch_input_device, 1)
  assert.equal(ACTION_TIER.open_it_ticket, 1)
  assert.equal(ACTION_TIER.show_recap, 0)
  assert.ok(Object.values(ACTION_TIER).every((t) => t <= 1))
  assert.equal(permission('intern', 'open_it_ticket'), 'click')
})

test('higher tiers stay ranked for future actions: T2 denied to interns, T3 only for executive and CEO', () => {
  assert.deepEqual(ROLES.map((r) => MATRIX[2][r]), ['deny', 'click', 'click', 'click'])
  assert.deepEqual(ROLES.map((r) => MATRIX[3][r]), ['deny', 'deny', 'click', 'click'])
})

test('role flags: confidentiality and IT view grow with rank', () => {
  assert.deepEqual(ROLES.map((r) => ROLE_FLAGS[r].confidential), [false, false, true, true])
  assert.deepEqual(ROLES.map((r) => ROLE_FLAGS[r].seesItView), [false, true, true, true])
  assert.deepEqual(ROLES.map((r) => ROLE_FLAGS[r].ticketPriority), ['normal', 'normal', 'priority', 'priority'])
})

test('missing or invalid role → intern (least privilege)', () => {
  for (const v of [undefined, null, '', 'admin', 'CEO please', 42, {}]) assert.equal(roleFromConfig(v), 'intern', String(v))
  assert.equal(roleFromConfig(' CEO '), 'ceo')
  assert.equal(roleFromConfig('executive'), 'executive')
})

test('RoleState notifies only on a real change', () => {
  const s = new RoleState()
  const seen: string[] = []
  s.onChange((r) => seen.push(r))
  s.set('intern')
  s.set('ceo')
  assert.equal(s.role, 'ceo')
  assert.equal(s.flags.confidential, true)
  assert.deepEqual(seen, ['ceo'])
})

// ---------- the gate with roles ----------
const FIX = { action: 'fix_mic', fix: 'unmute', mic: 'laptop', why: 'test' }

test('click-only actions never run from a detector, vision or the system, even for the CEO', () => {
  for (const p of ['detector', 'vision', 'system'] as const) {
    assert.equal(gate({ action: 'open_it_ticket', cardId: '', why: 'x' }, p, 'ceo').verdict, 'block')
    assert.equal(gate(FIX, p, 'ceo').verdict, 'block')
  }
})

test('speech and AI output never trigger anything, whatever the role', () => {
  for (const r of ROLES) for (const p of ['transcript', 'llm'] as const) {
    assert.equal(gate(FIX, p, r).verdict, 'block')
    assert.equal(gate({ action: 'send_haptic', waveform: 'knock', why: 'x' }, p, r).verdict, 'block')
  }
})

test('fixing your own mic is allowed at every rank, on your click', () => {
  for (const r of ROLES) assert.equal(gate(FIX, 'user', r).verdict, 'run')
})

test('gate without a role behaves as intern', () => {
  assert.equal(gate(FIX, 'user').verdict, 'run')
  assert.equal(gate(FIX, 'detector').verdict, 'block')
})
