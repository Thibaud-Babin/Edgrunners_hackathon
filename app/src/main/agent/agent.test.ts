import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UiCommand } from '../../shared/events.ts'
import { now } from '../../shared/events.ts'
import { EventBus } from '../bus.ts'
import { Agent } from './agent.ts'
import { Llm } from './llm.ts'
import { RoleState } from './permissions.ts'

function rig(role: 'intern' | 'ceo', allowRoleSwitch: boolean) {
  const ui: UiCommand[] = []
  const events = new EventBus()
  const roles = new RoleState(role)
  const haptics = { fire: async () => true } as unknown as ConstructorParameters<typeof Agent>[2]
  const agent = new Agent(events, (c) => ui.push(c), haptics, new Llm({ client: null }), 'Thibaud', { roles, allowRoleSwitch })
  const logs = () => ui.flatMap((c) => (c.type === 'LOG_ENTRY' ? [c.entry.text] : []))
  const setRole = (role: unknown, source: 'ui' | 'webcam' = 'ui') => events.publish({ type: 'USER_SET_ROLE', ts: now(), source, data: { role } })
  return { ui, roles, agent, logs, setRole }
}

test('the role from config is logged at start; announceRole tells the UI what it shows', () => {
  const r = rig('intern', false)
  assert.ok(r.logs().some((l) => l.startsWith('Role: intern (from config)')))
  r.agent.announceRole()
  assert.deepEqual(r.ui.at(-1), { type: 'ROLE', role: 'intern', sees_it_view: false, confidential: false })
})

test('production build: the UI cannot change the role', () => {
  const r = rig('intern', false)
  r.setRole('ceo')
  assert.equal(r.roles.role, 'intern')
  assert.ok(r.logs().some((l) => l.includes('Role switch from the UI ignored')))
})

test('dev build: the switch changes the role, logs it and re-announces it', () => {
  const r = rig('intern', true)
  r.setRole('ceo')
  assert.equal(r.roles.role, 'ceo')
  assert.ok(r.logs().some((l) => l.startsWith('Role switched to CEO (dev only)')))
  assert.deepEqual(r.ui.filter((c) => c.type === 'ROLE').at(-1), { type: 'ROLE', role: 'ceo', sees_it_view: true, confidential: true })
})

test('dev build: an unknown role or a non-UI source is dropped', () => {
  const r = rig('intern', true)
  r.setRole('admin')
  r.setRole('ceo', 'webcam')
  assert.equal(r.roles.role, 'intern')
})
