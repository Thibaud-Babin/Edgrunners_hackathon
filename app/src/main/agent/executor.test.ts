import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { UiCommand } from '../../shared/events.ts'
import { now } from '../../shared/events.ts'
import { AgentBus, EventBus } from '../bus.ts'
import { Executor, gate } from './executor.ts'
import { ROLES, type Role } from './permissions.ts'

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

// ---------- wiring: the real Executor on a real bus, fake UI and haptics ----------

function rig(role: Role) {
  const ui: UiCommand[] = []
  const logs: string[] = []
  const events = new EventBus()
  const bus = new AgentBus()
  const report = { log: (_k: string, t: string) => logs.push(t), blocked: (t: string) => logs.push(t), invalid: (t: string) => logs.push(t) }
  const ex = new Executor(events, bus, (c) => ui.push(c), { fire: async () => true }, report, role)
  const flush = () => new Promise((r) => setImmediate(r))
  const user = async (input: 'nod' | 'shake' | 'brow_raise') => {
    bus.publish('vision', 'user', 'user', { input })
    await flush()
  }
  const click = async (action_id: string) => {
    events.publish({ type: 'USER_CLICK', ts: now(), source: 'ui', data: { action_id } })
    await flush()
  }
  const replies = () => ui.filter((c) => c.type === 'SHOW_REPLY')
  return { ex, bus, ui, logs, user, click, replies, flush }
}

test('intern: a nod never sends a reply, an eyebrow raise after it does not either', async () => {
  const r = rig('intern')
  await r.user('nod')
  await r.user('brow_raise')
  assert.equal(r.replies().length, 0)
  assert.ok(r.logs.some((l) => l.includes('suggested, not done (as intern')))
})

test('senior: a nod only asks; the eyebrow raise sends "Yes" and removes the card', async () => {
  const r = rig('senior')
  await r.user('nod')
  assert.equal(r.replies().length, 0)
  const card = r.ui.find((c) => c.type === 'SHOW_FIX' && c.action_id === 'post_chat_reply')
  assert.ok(card)
  await r.user('brow_raise')
  assert.deepEqual(r.replies().map((c) => c.type === 'SHOW_REPLY' && c.text), ['Yes'])
  assert.ok(r.ui.some((c) => c.type === 'DISMISS' && card.type === 'SHOW_FIX' && c.id === card.id))
})

test('senior: clicking the confirm card also sends; an eyebrow raise with nothing waiting sends nothing', async () => {
  const r = rig('senior')
  await r.user('brow_raise')
  assert.equal(r.replies().length, 0)
  await r.user('shake')
  await r.click('post_chat_reply')
  assert.deepEqual(r.replies().map((c) => c.type === 'SHOW_REPLY' && c.text), ['No'])
})

test('an unconfirmed card is removed after 15 s and a late eyebrow raise sends nothing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const r = rig('senior')
    await r.user('nod')
    const card = r.ui.find((c) => c.type === 'SHOW_FIX')
    mock.timers.tick(15_000)
    assert.ok(r.ui.some((c) => c.type === 'DISMISS' && card?.type === 'SHOW_FIX' && c.id === card.id))
    assert.ok(r.logs.some((l) => l.includes('not confirmed within 15 s')))
    await r.user('brow_raise')
    assert.equal(r.replies().length, 0)
  } finally {
    mock.timers.reset()
  }
})

test('spam guard pause skips automatic actions but never the user\'s own click', async () => {
  const r = rig('intern')
  r.ex.pause(now() + 60)
  r.bus.publish('detector', 'detector', 'detector', { type: 'OTHERS_CANT_HEAR', text: "we can't hear you" })
  await r.flush()
  assert.equal(r.ui.filter((c) => c.type === 'SHOW_FIX').length, 0)
  assert.ok(r.logs.some((l) => l.includes('skipped (executor paused by the spam guard)')))
  await r.click('switch_input_device')
  assert.ok(r.ui.some((c) => c.type === 'SWITCH_MIC'))
})
