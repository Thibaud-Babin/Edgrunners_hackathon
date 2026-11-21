import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_TIER, MATRIX, permission, roleFromConfig, ROLES, type Permission, type Role, type Tier } from './permissions.ts'

// The doc §3 table, written out cell by cell so a change to MATRIX must be a deliberate change here too.
const EXPECTED: [Tier, Role, Permission][] = [
  [0, 'intern', 'auto'], [0, 'senior', 'auto'], [0, 'executive', 'auto'], [0, 'ceo', 'auto'],
  [1, 'intern', 'confirm'], [1, 'senior', 'auto'], [1, 'executive', 'auto'], [1, 'ceo', 'auto'],
  [2, 'intern', 'deny'], [2, 'senior', 'confirm'], [2, 'executive', 'confirm'], [2, 'ceo', 'confirm'],
  [3, 'intern', 'deny'], [3, 'senior', 'deny'], [3, 'executive', 'confirm'], [3, 'ceo', 'confirm']
]

for (const [tier, role, want] of EXPECTED) {
  test(`T${tier} × ${role} = ${want}`, () => assert.equal(permission(role, tier), want))
}

test('the matrix has exactly these 16 cells', () => {
  assert.equal(Object.values(MATRIX).flatMap((r) => Object.keys(r)).length, 16)
})

test('T2 is never automatic for any role', () => {
  for (const r of ROLES) assert.notEqual(permission(r, 2), 'auto')
})

test('missing or invalid role → intern', () => {
  for (const v of [undefined, null, '', 'admin', 'CEO please', 42, {}]) assert.equal(roleFromConfig(v), 'intern', String(v))
  assert.equal(roleFromConfig(' Senior '), 'senior')
  assert.equal(roleFromConfig('ceo'), 'ceo')
})

test('reply actions are T2, mic switch is T1, notifications are T0', () => {
  assert.equal(ACTION_TIER.post_chat_reply, 2)
  assert.equal(ACTION_TIER.speak_reply, 2)
  assert.equal(ACTION_TIER.switch_input_device, 1)
  assert.equal(ACTION_TIER.send_haptic, 0)
})
