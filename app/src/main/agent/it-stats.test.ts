import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TapEvent, UiCommand } from '../../shared/events.ts'
import { ItStats, parseCallReports, parseTicket, problemType, recurring } from './it-stats.ts'

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
  assert.deepEqual(snap.tiles, { caught: 1, beforeNoticed: 1, reported: 0, fixed: 1, secondsLost: 4, medianFixS: 4 })
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
