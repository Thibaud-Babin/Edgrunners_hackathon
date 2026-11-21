// The role-based features end to end: real agents on a real bus, fake clock, fake AI client that counts calls.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { EventType, UiCommand } from '../../shared/events.ts'
import { AgentBus, EventBus } from '../bus.ts'
import { AudioAgent } from './audio-agent.ts'
import { Executor, STT_GRACE_MS } from './executor.ts'
import { Llm, type MessagesClient } from './llm.ts'
import { RoleState, type UserRole } from './permissions.ts'
import { startVisionIntake } from './vision-intake.ts'

const T0 = 1_000

export function roleRig(role: UserRole) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 * 1000 })
  const ui: UiCommand[] = []
  const logs: string[] = []
  const events = new EventBus()
  const bus = new AgentBus()
  const roles = new RoleState(role)
  let aiCalls = 0
  const client: MessagesClient = {
    messages: {
      create: async () => {
        aiCalls++
        return { content: [{ type: 'text', text: '{"text":"Cloud summary.","askedYou":false,"topics":[]}' }], usage: { input_tokens: 10, output_tokens: 5 } }
      }
    }
  }
  const report = { log: (_k: string, t: string) => logs.push(t), blocked: (t: string) => logs.push(t), invalid: (t: string) => logs.push(t) }
  new AudioAgent(events, bus, new Llm({ client }), 'Thibaud', report, roles)
  startVisionIntake(events, bus, report)
  new Executor(events, bus, (c) => ui.push(c), { fire: async () => true }, report, null, roles)
  const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
  }
  const wait = async (s: number) => {
    mock.timers.tick(s * 1000)
    await flush()
  }
  const say = (text: string, ts: number) => events.publish({ type: 'TRANSCRIPT_FINAL', ts, source: 'call_audio', data: { text } })
  const cam = (type: EventType) => events.publish({ type, ts: Date.now() / 1000, source: 'webcam' })
  const ui_ = (type: EventType, data: Record<string, unknown> = {}) => events.publish({ type, ts: Date.now() / 1000, source: 'ui', data })
  const awayRecap = async () => {
    cam('USER_AWAY')
    await wait(20)
    say('The release moves to Friday because the tests are not ready yet.', T0 + 5)
    cam('USER_BACK')
    await wait(STT_GRACE_MS / 1000)
  }
  return { ui, logs, roles, say, cam, wait, flush, awayRecap, ui_, aiCalls: () => aiCalls }
}

test('confidential (CEO): the recap is made on the laptop, zero cloud AI calls', async (t) => {
  t.after(() => mock.timers.reset())
  const r = roleRig('ceo')
  await r.awayRecap()
  assert.equal(r.aiCalls(), 0)
  const card = r.ui.find((c) => c.type === 'SHOW_AWAY_SUMMARY')
  assert.ok(card && card.type === 'SHOW_AWAY_SUMMARY')
  assert.match(card.summary, /release moves to Friday/) // the local template
  assert.ok(r.logs.includes('Confidential (CEO): summary made on this laptop (no cloud AI)'))
})

test('not confidential (intern): the recap uses the cloud AI', async (t) => {
  t.after(() => mock.timers.reset())
  const r = roleRig('intern')
  await r.awayRecap()
  assert.equal(r.aiCalls(), 1)
  const card = r.ui.find((c) => c.type === 'SHOW_AWAY_SUMMARY')
  assert.ok(card && card.type === 'SHOW_AWAY_SUMMARY' && card.summary === 'Cloud summary.')
})

test('retention: at call end the CEO\'s transcript is deleted, the intern\'s is kept', async (t) => {
  t.after(() => mock.timers.reset())
  for (const [role, wiped] of [['ceo', true], ['intern', false]] as const) {
    const r = roleRig(role)
    r.say('Budget approved, Sara sends the numbers tonight.', T0 + 1)
    r.ui_('CALL_ENDED')
    await r.flush()
    if (wiped) assert.ok(r.logs.some((l) => l.startsWith('Call ended: 1 transcript lines deleted from this laptop (CEO, confidential)')))
    else assert.ok(r.logs.some((l) => l.startsWith('Call ended: what was said stays on this laptop')))
    // A later recap over the same time window shows the line only if it was kept.
    await r.awayRecap()
    const card = r.ui.find((c) => c.type === 'SHOW_AWAY_SUMMARY')
    assert.ok(card && card.type === 'SHOW_AWAY_SUMMARY')
    assert.equal(/Budget approved/.test(card.transcript), !wiped, role)
    mock.timers.reset()
  }
})

test('CALL_ENDED from anything but the UI is dropped', async (t) => {
  t.after(() => mock.timers.reset())
  const r = roleRig('ceo')
  r.cam('CALL_ENDED' as EventType)
  await r.flush()
  assert.ok(r.logs.some((l) => l.includes('CALL_ENDED with a bad shape or source')))
})
