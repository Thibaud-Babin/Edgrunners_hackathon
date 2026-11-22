import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TapEvent, UiCommand } from '../../shared/events.ts'
import { ItStats, parseCallReports, parseTicket, problemType, recurring, ticketReason } from './it-stats.ts'

function setup() {
  let t = 1000
  const s = new ItStats(null, () => t)
  return { s, at: (v: number) => (t = v) }
}
const fix = (id: string, problem: string, label: string): UiCommand => ({ type: 'SHOW_FIX', id, problem, fix_label: label, action_id: 'fix_mic' })
const log = (kind: 'action' | 'decision' | 'blocked' | 'error', text: string): UiCommand => ({ type: 'LOG_ENTRY', entry: { ts: 0, kind, text } })
const clickEv = (action_id: string, args: Record<string, unknown> = {}): TapEvent => ({ type: 'USER_CLICK', ts: 0, source: 'ui', data: { action_id, args } })

test('it-stats: muted while talking, caught by Tap, fixed and checked → before anyone noticed, time lost, fix checked', () => {
  const { s, at } = setup()
  s.onUi(fix('card-1', 'You are talking, but your laptop mic is muted in Windows', 'Unmute laptop mic'))
  s.onUi(log('action', 'You are talking while muted → fix card shown ("Unmute laptop mic"; nothing changes until you click)'))
  at(1004)
  s.onEvent(clickEv('fix_mic'))
  s.onUi(log('decision', 'Mic problem fixed before anyone noticed'))
  s.onUi(log('action', 'You clicked the fix → laptop mic "X" unmuted (checked)'))
  const snap = s.snapshot([], [])
  assert.deepEqual(snap.tiles, { caught: 1, beforeNoticed: 1, reported: 0, fixed: 1, secondsLost: 4, medianFixS: 4, solvedWithoutTicket: 1, autoTickets: 0 })
  assert.deepEqual(snap.byType, [{ type: 'Mic muted in Windows', count: 1 }])
  assert.deepEqual(snap.fixes, [{ label: 'Unmute mic', used: 1, checked: 1, failed: 0 }])
})

test('it-stats: a coworker reported it → counted as reported; a failed fix is not "checked"', () => {
  const { s } = setup()
  s.onUi(fix('card-2', "Someone said: we can't hear you, but your laptop mic is muted in Windows", 'Unmute laptop mic'))
  s.onUi(log('action', 'Others cannot hear you → fix card shown ("Unmute laptop mic"; nothing changes until you click)'))
  s.onEvent(clickEv('fix_mic'))
  s.onUi(log('error', 'You clicked the fix → could not unmute laptop mic "X"'))
  const snap = s.snapshot([], [])
  assert.equal(snap.tiles.reported, 1)
  assert.equal(snap.tiles.beforeNoticed, 0)
  assert.equal(snap.tiles.fixed, 0)
  assert.deepEqual(snap.fixes, [{ label: 'Unmute mic', used: 1, checked: 0, failed: 1 }])
})

test('it-stats: misfires, "muted on purpose", refusals and AI cost', () => {
  const { s } = setup()
  s.onUi(fix('card-3', 'You are talking, but your laptop mic is muted in Windows', 'Unmute laptop mic'))
  s.onEvent(clickEv('snooze_mic_alerts'))
  s.onUi(fix('card-4', 'Your mic has been too quiet for over 20 s', 'Switch to laptop mic'))
  s.onEvent(clickEv('dismiss_card', { id: 'card-4' }))
  s.onEvent(clickEv('dismiss_card', { id: 'recap-9' })) // not a fix card: not a misfire
  s.onUi(log('blocked', 'share_screen blocked (not on the allowlist)'))
  s.onUi(log('decision', "Instruction-like speech ignored, speech can't trigger actions"))
  s.onUi({ type: 'COUNTERS', aiCalls: 3, costUsd: 0.0021, events: 10, blocked: 1 })
  const a = s.snapshot([], []).agent
  assert.equal(a.misfires, 1)
  assert.equal(a.notNeeded, 1)
  assert.equal(a.blockedCount, 2)
  assert.match(a.blocked[0]!.text, /^Spoken instruction in the call ignored/)
  assert.equal(a.blocked[1]!.text, 'share_screen blocked (not on the allowlist)')
  assert.equal(a.aiCalls, 3)
  assert.equal(a.costUsd, 0.0021)
})

test('it-stats: problem types from the fix card', () => {
  assert.equal(problemType('x', 'Raise mic volume to 80 %'), 'Mic volume too low')
  assert.equal(problemType('Someone said… Your mic works in Windows, so you are probably muted in Meet: press Ctrl+D in Meet.', 'Got it'), 'Muted in the call app (Meet)')
  assert.equal(problemType('…but your headset mic sends no sound', 'Switch to laptop mic'), 'Mic sends no sound')
  assert.equal(problemType('Someone said… Move closer to the mic, or plug in a headset.', 'Got it'), 'Poor mic quality')
})

test('it-stats: helpdesk files are parsed; a problem in 2 of the last 5 calls is flagged with a hint', () => {
  const ticket = parseTicket(JSON.stringify({ id: 'T-0001', createdAt: '2026-11-22T02:00:00Z', priority: 'normal', requesterRole: 'intern' }))
  assert.equal(ticket?.id, 'T-0001')
  assert.equal(parseTicket('not json'), null)
  const line = (id: string, at: string, keys: string[]) => JSON.stringify({ id, endedAt: at, priority: keys.length ? 'priority' : 'log', diagnostics: { problems: keys.map((key) => ({ key })), fixesApplied: [] } })
  const reports = parseCallReports([line('R-1', '2026-11-22T01:00:00Z', ['camera_frozen']), 'garbage', line('R-2', '2026-11-22T02:00:00Z', ['camera_frozen', 'low_light']), line('R-3', '2026-11-22T03:00:00Z', [])].join('\n'))
  assert.equal(reports.length, 3)
  const rec = recurring(reports)
  assert.equal(rec.length, 1)
  assert.equal(rec[0]!.problem, 'Camera image froze')
  assert.equal(rec[0]!.calls, 2)
  assert.equal(rec[0]!.of, 3)
  assert.match(rec[0]!.hint, /USB|driver/)
})

test('it-stats: no transcript ever stored (only counts, types, fixed reasons)', () => {
  const { s } = setup()
  s.onUi({ type: 'CAPTION', text: 'secret project budget', final: true } as unknown as UiCommand)
  s.onUi({ type: 'SHOW_RECAP', id: 'r', summary: 'secret project budget' } as unknown as UiCommand)
  assert.ok(!JSON.stringify(s.state).includes('secret'))
})

test('it-stats: the same problem for the 3rd time this week → the card says so, and an automatic ticket is asked for', () => {
  const { s, at } = setup()
  const card = (id: string) => ({ type: 'SHOW_FIX' as const, id, problem: 'You are talking, but your laptop mic sends no sound. Check its cable or Bluetooth connection.', fix_label: 'Got it', action_id: 'dismiss_card' as const })
  for (const [i, id] of ['a', 'b'].entries()) {
    at(1000 + i * 3600)
    const e = s.escalate(card(id))
    assert.equal(e.auto, undefined, `${id}: 1st/2nd time → no ticket`)
    s.onUi(e.cmd)
  }
  at(1000 + 2 * 3600)
  const third = s.escalate(card('c'))
  assert.equal(third.cmd.it_ticket, true)
  assert.match(third.cmd.problem, /3rd time this week: this may be a device problem/)
  assert.deepEqual(third.auto, { reason: 'same problem 3 times this week (mic sends no sound)', key: 'repeat:Mic sends no sound' })
  // more than a week later it starts again from 1
  at(1000 + 9 * 24 * 3600)
  assert.equal(s.escalate(card('d')).auto, undefined)
})

test("it-stats (B): muted / camera off in Meet or muted in Windows is the user's setting → never a ticket, however often", () => {
  const { s, at } = setup()
  const cards = [
    { problem: `Someone said: "we can't hear you". Your mic works in Windows, so you are probably muted in Meet: press Ctrl+D in Meet.`, fix_label: 'Got it', action_id: 'dismiss_card' as const },
    { problem: `Someone said: "we cannot see you". Your camera works (Tap sees you live), so it is probably off in Meet: press Ctrl+E in Meet.`, fix_label: 'Got it', action_id: 'dismiss_card' as const },
    { problem: 'You are talking, but your laptop mic is muted in Windows', fix_label: 'Unmute laptop mic', action_id: 'fix_mic' as const }
  ]
  for (const [k, c] of cards.entries()) for (let i = 0; i < 5; i++) {
    at(1000 + k * 100000 + i * 3600)
    const e = s.escalate({ type: 'SHOW_FIX', id: `${k}-${i}`, ...c })
    assert.equal(e.auto, undefined)
    assert.equal(e.cmd.it_ticket, undefined)
    s.onUi(e.cmd)
  }
})

test('it-stats: ticket reason, ticketed problems are not "solved without a ticket"', () => {
  assert.equal(ticketReason("Tap couldn't fix it (could not unmute laptop mic). This may be a device or driver problem."), 'the one-click fix failed')
  assert.equal(ticketReason('Mic still too quiet after switching. Check it is not muted, move closer, or plug in a headset.'), 'still bad after switching mics')
  assert.equal(ticketReason('You are talking, but your laptop mic sends no sound. Check its cable or Bluetooth connection.'), 'no other mic to switch to')
  assert.equal(ticketReason('…muted in Windows · 3rd time this week: this may be a device problem.'), 'same problem 3 times this week')
  const { s } = setup()
  // problem 1: fixed in one click
  s.onUi(fix('c1', 'You are talking, but your laptop mic is muted in Windows', 'Unmute laptop mic'))
  s.onEvent(clickEv('fix_mic'))
  s.onUi(log('action', 'You clicked the fix → laptop mic "X" unmuted (checked)'))
  // problem 2: the fix fails → follow-up card (same problem) → ticket
  s.onUi(fix('c2', 'You are talking, but your laptop mic is muted in Windows', 'Unmute laptop mic'))
  s.onEvent(clickEv('fix_mic'))
  s.onUi(log('error', 'You clicked the fix → could not unmute laptop mic "X"'))
  s.onUi({ type: 'SHOW_FIX', id: 'c3', problem: "Tap couldn't fix it (could not unmute laptop mic \"X\"). This may be a device or driver problem.", fix_label: 'OK', action_id: 'dismiss_card', it_ticket: true })
  s.onUi({ type: 'IT_TICKET', card_id: 'c3', state: 'sent', reason: 'the one-click fix failed', auto: true, ref: 'T-0001' })
  const snap = s.snapshot([{ id: 'T-0001', createdAt: '2026-11-22T04:00:00Z', priority: 'normal', requesterRole: 'intern', json: '{}' }], [])
  assert.equal(snap.tiles.caught, 2, 'the follow-up card is not a new problem')
  assert.equal(snap.tiles.solvedWithoutTicket, 1)
  assert.equal(snap.tickets[0]!.reason, 'the one-click fix failed')
  assert.equal(snap.tiles.autoTickets, 1)
})

test("it-stats: 'I'm muted on purpose' is not a problem: not counted, never escalates to IT", () => {
  const { s } = setup()
  const card = (id: string) => ({ type: 'SHOW_FIX' as const, id, problem: 'You are talking, but your laptop mic is muted in Windows', fix_label: 'Unmute laptop mic', action_id: 'fix_mic' as const })
  for (const id of ['a', 'b']) {
    s.onUi(s.escalate(card(id)).cmd)
    s.onEvent(clickEv('snooze_mic_alerts'))
  }
  assert.equal(s.escalate(card('c')).auto, undefined, '2 on purpose + this one = 1 real → no ticket')
  assert.equal(s.snapshot([], []).tiles.caught, 0)
  assert.equal(s.snapshot([], []).agent.notNeeded, 2)
})
