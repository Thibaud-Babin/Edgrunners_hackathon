// The role-based features end to end: real agents on a real bus, fake clock, fake AI client that counts calls.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { EventType, UiCommand } from '../../shared/events.ts'
import { AgentBus, EventBus } from '../bus.ts'
import { AudioAgent } from './audio-agent.ts'
import { type CallReport, Executor, gate, type ItTicket, STT_GRACE_MS } from './executor.ts'
import { Monitor } from './monitor.ts'
import { Llm, type MessagesClient } from './llm.ts'
import { RoleState, type UserRole } from './permissions.ts'
import { startVisionIntake } from './vision-intake.ts'

const T0 = 1_000

export function roleRig(role: UserRole) {
  const tickets: ItTicket[] = []
  const reports: CallReport[] = []
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
  const monitor = new Monitor(events, bus, () => {})
  new AudioAgent(events, bus, new Llm({ client }), 'Thibaud', report, roles)
  startVisionIntake(events, bus, report)
  new Executor(events, bus, (c) => ui.push(c), { fire: async () => true }, report, null, roles, {
    tickets: { send: async (t) => (tickets.push(t), { ok: true, where: 'test outbox' }) },
    itLog: { add: async (r) => (reports.push(r), { ok: true, where: 'test log' }) },
    diagnostics: () => monitor.diagnostics(),
    resetCall: () => monitor.resetCall()
  })
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
  return { ui, logs, roles, tickets, reports, events, say, cam, wait, flush, awayRecap, ui_, aiCalls: () => aiCalls }
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

test('CALL_ENDED from anything but the UI is dropped', async (t) => {
  t.after(() => mock.timers.reset())
  const r = roleRig('ceo')
  r.cam('CALL_ENDED' as EventType)
  await r.flush()
  assert.ok(r.logs.some((l) => l.includes('CALL_ENDED with a bad shape or source')))
})


// Muted mic while the mouth moves → fix card with "Send diagnostics to IT"; the user clicks it.
async function mutedMicTicket(r: ReturnType<typeof roleRig>) {
  const at = () => Date.now() / 1000
  r.say('The secret budget is 4 million.', at())
  r.events.publish({ type: 'MIC_STATE', ts: at(), source: 'mic', data: { name: "Thibaud's AirPods", kind: 'headset', muted: true, volume: 1 } })
  r.events.publish({ type: 'MOUTH_MOVING', ts: at(), source: 'webcam', data: { active: true } })
  await r.wait(2)
  r.events.publish({ type: 'MIC_LEVEL', ts: at(), source: 'mic', data: { rms: 0 } })
  await r.flush()
  const card = r.ui.find((c) => c.type === 'SHOW_FIX')
  assert.ok(card && card.type === 'SHOW_FIX' && card.it_ticket === true, 'device fix cards offer the IT ticket')
  r.ui_('USER_CLICK', { action_id: 'open_it_ticket', args: { id: card.id } })
  await r.flush()
}

test('IT ticket: device facts only (no speech, no device name), priority by role', async (t) => {
  t.after(() => mock.timers.reset())
  for (const [role, priority, queue] of [['intern', 'normal', 'normal queue'], ['ceo', 'priority', 'priority: executive support']] as const) {
    const r = roleRig(role)
    await mutedMicTicket(r)
    assert.equal(r.tickets.length, 1, role)
    const ticket = r.tickets[0]
    assert.equal(ticket.priority, priority)
    assert.deepEqual(ticket.mic, { kind: 'headset', muted: true, volume: 1 })
    assert.ok(ticket.diagnostics?.problems.some((p) => p.key === 'mic_silent'), JSON.stringify(ticket.diagnostics))
    const json = JSON.stringify(ticket)
    assert.doesNotMatch(json, /budget|AirPods|Thibaud/, 'no speech, no names in the ticket')
    const notice = r.ui.find((c) => c.type === 'SHOW_NOTICE')
    assert.ok(notice && notice.type === 'SHOW_NOTICE')
    assert.equal(notice.text, `Ticket T-0001 sent to IT (${queue}, simulated helpdesk)`)
    mock.timers.reset()
  }
})

test('IT ticket: only the user\'s click opens it, never a detector, speech or the AI', () => {
  const req = { action: 'open_it_ticket', cardId: 'c1', why: 'test' }
  assert.equal(gate(req, 'user', 'intern').verdict, 'run')
  for (const p of ['detector', 'vision', 'transcript', 'llm', 'system'] as const) assert.equal(gate(req, p, 'ceo').verdict, 'block', p)
})

test('End call, clean call: a device report is added to the IT log as "log only", for every role', async (t) => {
  t.after(() => mock.timers.reset())
  for (const role of ['intern', 'senior', 'executive', 'ceo'] as const) {
    const r = roleRig(role)
    r.say('Budget approved, Sara sends the numbers tonight.', Date.now() / 1000)
    await r.wait(30)
    r.ui_('CALL_ENDED')
    await r.flush()
    assert.equal(r.reports.length, 1, role)
    const rep = r.reports[0]
    assert.equal(rep.priority, 'log', role)
    assert.equal(rep.diagnostics?.callDurationS, 30)
    assert.doesNotMatch(JSON.stringify(rep), /Budget|Sara/, 'no speech in the report')
    assert.ok(r.ui.some((c) => c.type === 'SHOW_NOTICE' && c.text === 'Call report added to the IT log (log only: no problem)'))
    mock.timers.reset()
  }
})

test('End call after device trouble: priority for the intern, urgent for the CEO; fixes listed; no speech or mic name', async (t) => {
  t.after(() => mock.timers.reset())
  for (const [role, priority] of [['intern', 'priority'], ['ceo', 'urgent']] as const) {
    const r = roleRig(role)
    await mutedMicTicket(r) // mic trouble + a ticket click
    r.ui_('CALL_ENDED')
    await r.flush()
    const rep = r.reports[0]
    assert.ok(rep, role)
    assert.equal(rep.priority, priority)
    assert.ok((rep.diagnostics?.problems.length ?? 0) > 0)
    assert.deepEqual(rep.mic, { kind: 'headset', muted: true, volume: 1 })
    assert.doesNotMatch(JSON.stringify(rep), /budget|AirPods|Thibaud/)
    assert.ok(r.logs.some((l) => l.startsWith(`Call ended → device report R-0001 added to the IT log (`)), r.logs.join('\n'))
    // The next call starts clean.
    r.ui_('CALL_ENDED')
    await r.flush()
    assert.equal(r.reports[1]?.priority, 'log')
    mock.timers.reset()
  }
})

test('the call report lists the fixes the user clicked', async (t) => {
  t.after(() => mock.timers.reset())
  const r = roleRig('intern')
  r.events.publish({ type: 'USER_CLICK', ts: Date.now() / 1000, source: 'ui', data: { action_id: 'switch_input_device' } })
  await r.flush()
  r.ui_('CALL_ENDED')
  await r.flush()
  assert.deepEqual(r.reports[0]?.diagnostics?.fixesApplied, ['switch_input_device'])
})

test('a call report is never started by a detector, speech or the AI', () => {
  const req = { action: 'send_call_report', why: 'x' }
  for (const p of ['transcript', 'llm'] as const) assert.equal(gate(req, p, 'ceo').verdict, 'block', p)
})

test('sharing is gone: a share or send click is not on the allowlist, for every role', async (t) => {
  t.after(() => mock.timers.reset())
  for (const role of ['intern', 'ceo'] as const) {
    const r = roleRig(role)
    for (const id of ['share_recap', 'send_action_items']) r.ui_('USER_CLICK', { action_id: id, args: { id: 'card-1' } })
    await r.flush()
    assert.ok(r.logs.includes('action "share_recap" is not on the allowlist'), role)
    assert.ok(r.logs.includes('action "send_action_items" is not on the allowlist'), role)
    mock.timers.reset()
  }
})
