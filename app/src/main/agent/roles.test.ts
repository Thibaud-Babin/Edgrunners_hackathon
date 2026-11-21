// The role-based features end to end: real agents on a real bus, fake clock, fake AI client that counts calls.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { EventType, UiCommand } from '../../shared/events.ts'
import { AgentBus, EventBus } from '../bus.ts'
import { AudioAgent, templateMinutes } from './audio-agent.ts'
import { Executor, gate, type ItTicket, STT_GRACE_MS } from './executor.ts'
import { Llm, type MessagesClient } from './llm.ts'
import { RoleState, type UserRole } from './permissions.ts'
import { startVisionIntake } from './vision-intake.ts'

const T0 = 1_000

export function roleRig(role: UserRole) {
  const tickets: ItTicket[] = []
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
  new Executor(events, bus, (c) => ui.push(c), { fire: async () => true }, report, null, roles, {
    tickets: { send: async (t) => (tickets.push(t), { ok: true, where: 'test outbox' }) },
    diagnostics: () => ({ problems: [{ key: 'mic_muted', firstSeenS: 1, lastSeenS: 2, count: 1 }], feeds: { camera: 'ok', mic: 'ok', callAudio: 'ok' }, micQualityBad: false, aiBreakerOpen: false })
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
  return { ui, logs, roles, tickets, events, say, cam, wait, flush, awayRecap, ui_, aiCalls: () => aiCalls }
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
    assert.equal(ticket.diagnostics?.problems[0]?.key, 'mic_muted')
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

test('share recap: the CEO\'s click shares the summary; the intern\'s click is blocked with the reason', async (t) => {
  t.after(() => mock.timers.reset())
  for (const role of ['ceo', 'senior', 'intern'] as const) {
    const r = roleRig(role)
    await r.awayRecap()
    const card = r.ui.find((c) => c.type === 'SHOW_AWAY_SUMMARY')
    assert.ok(card && card.type === 'SHOW_AWAY_SUMMARY' && card.share === true, 'every recap card offers Share')
    r.ui_('USER_CLICK', { action_id: 'share_recap', args: { id: card.id } })
    await r.flush()
    const shared = r.ui.some((c) => c.type === 'SHOW_NOTICE' && c.text === 'Recap shared with #team (simulated)')
    assert.equal(shared, role === 'ceo', role)
    if (role === 'ceo') assert.ok(r.logs.some((l) => l.startsWith('You clicked "Share with team" → recap summary shared with #team')))
    else assert.ok(r.logs.includes(`share_recap blocked (sharing meeting content outside the call is for executives and the CEO (you: ${role === 'senior' ? 'senior / tech lead' : 'intern'}, T3))`), r.logs.join('\n'))
    mock.timers.reset()
  }
})

test('share recap: after the CEO\'s call ends, old recaps can no longer be shared', async (t) => {
  t.after(() => mock.timers.reset())
  const r = roleRig('ceo')
  await r.awayRecap()
  const card = r.ui.find((c) => c.type === 'SHOW_AWAY_SUMMARY')
  assert.ok(card)
  r.ui_('CALL_ENDED')
  await r.flush()
  r.ui_('USER_CLICK', { action_id: 'share_recap', args: { id: card.id } })
  await r.flush()
  assert.ok(!r.ui.some((c) => c.type === 'SHOW_NOTICE'))
  assert.ok(r.logs.includes('You clicked "Share with team" → nothing shared (that recap is no longer kept)'))
})

test('share recap: a detector or the AI can never share, even for the CEO', () => {
  const req = { action: 'share_recap', cardId: 'card-1', why: 'test' }
  for (const p of ['detector', 'vision', 'transcript', 'llm', 'system'] as const) assert.equal(gate(req, p, 'ceo').verdict, 'block', p)
})

test('minutes by rules: decisions and action items, capped, never more than asked', () => {
  const m = templateMinutes([
    'Hello everyone.',
    'Budget approved, Sara sends the numbers tonight.',
    'We decided to ship on Friday.',
    'Paul will check the tests by Monday.',
    'Nice weather today.'
  ])
  assert.deepEqual(m.decisions, ['Budget approved, Sara sends the numbers tonight.', 'We decided to ship on Friday.'])
  assert.deepEqual(m.actionItems, ['Budget approved, Sara sends the numbers tonight.', 'Paul will check the tests by Monday.'])
  const many = templateMinutes(Array.from({ length: 9 }, (_, i) => `We agreed on point ${i}. ${'x'.repeat(200)}`))
  assert.equal(many.decisions.length, 5)
  assert.ok(many.decisions.every((l) => l.length <= 140))
})

test('end of call: the CEO gets a minutes card (zero AI calls) and may send it; then the transcript is wiped', async (t) => {
  t.after(() => mock.timers.reset())
  const r = roleRig('ceo')
  r.say('Budget approved, Sara sends the numbers tonight.', T0 + 1)
  r.ui_('CALL_ENDED')
  await r.flush()
  assert.equal(r.aiCalls(), 0)
  const card = r.ui.find((c) => c.type === 'SHOW_MINUTES')
  assert.ok(card && card.type === 'SHOW_MINUTES')
  assert.deepEqual([card.decisions, card.action_items, card.can_send], [['Budget approved, Sara sends the numbers tonight.'], ['Budget approved, Sara sends the numbers tonight.'], true])
  // Minutes were made before the wipe.
  const minutesAt = r.logs.findIndex((l) => l.startsWith('Call ended → minutes card: 1 decisions, 1 action items'))
  const wipeAt = r.logs.findIndex((l) => l.startsWith('Call ended: 1 transcript lines deleted'))
  assert.ok(minutesAt >= 0 && wipeAt > minutesAt, r.logs.join('\n'))
  r.ui_('USER_CLICK', { action_id: 'send_action_items', args: { id: card.id } })
  await r.flush()
  assert.ok(r.ui.some((c) => c.type === 'SHOW_NOTICE' && c.text === 'Decisions and action items sent to the attendees (simulated)'))
  // A second click sends nothing again.
  r.ui_('USER_CLICK', { action_id: 'send_action_items', args: { id: card.id } })
  await r.flush()
  assert.ok(r.logs.includes('You clicked "Send to attendees" → nothing sent (those minutes are no longer kept)'))
})

test('end of call: the intern and the senior get no minutes card, and a forged send click is blocked', async (t) => {
  t.after(() => mock.timers.reset())
  for (const role of ['intern', 'senior'] as const) {
    const r = roleRig(role)
    r.say('Budget approved, Sara sends the numbers tonight.', T0 + 1)
    r.ui_('CALL_ENDED')
    await r.flush()
    assert.ok(!r.ui.some((c) => c.type === 'SHOW_MINUTES'), role)
    r.ui_('USER_CLICK', { action_id: 'send_action_items', args: { id: 'card-1' } })
    await r.flush()
    assert.ok(r.logs.some((l) => l.startsWith('send_action_items blocked (sharing meeting content outside the call')), role)
    mock.timers.reset()
  }
})

test('end of call with nothing decided: no minutes card', async (t) => {
  t.after(() => mock.timers.reset())
  const r = roleRig('executive')
  r.say('Nice weather today.', T0 + 1)
  r.ui_('CALL_ENDED')
  await r.flush()
  assert.ok(!r.ui.some((c) => c.type === 'SHOW_MINUTES'))
  assert.ok(r.logs.includes('Call ended → no minutes card (no decision or action item was heard)'))
})
