import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, hapticSettings, initialState, type RulesState } from './rules.ts'
import type { Envelope } from './schemas.ts'

const env = (kind: string, payload: unknown, ts: number, provenance: Envelope['provenance'] = 'vision'): Envelope<unknown> => ({
  id: 'e',
  ts,
  from: 'vision',
  provenance,
  kind,
  payload
})
const away = (ts: number, since?: number) => env('vision', { signal: 'away', ...(since !== undefined ? { since } : {}) }, ts)
const back = (ts: number) => env('vision', { signal: 'back' }, ts)

function play(steps: [Envelope<unknown>, number][]) {
  let s: RulesState = initialState()
  const out = { actions: [] as unknown[], log: [] as string[], blocked: [] as string[] }
  for (const [e, t] of steps) {
    const d = decide(s, e, t)
    s = d.state
    out.actions.push(...d.actions)
    out.log.push(...d.log.map((l) => l.text))
    out.blocked.push(...d.blocked)
  }
  return out
}

test('away then back → one recap of exactly that window', () => {
  const r = play([[away(100), 100], [back(130), 130]])
  assert.deepEqual(r.actions, [
    { action: 'show_away_summary', fromTs: 100, untilTs: 130, trigger: 'looked_back', waitSentenceEnd: false, why: 'you looked back after 30 s away' }
  ])
})

test('gaze away uses data.since, so a 3 s hold still produces a recap', () => {
  // The event arrives at 103 after the 3 s gaze hold, but the user left at 100.
  // Using the publish time would make this 0.5 s glance and lose the card.
  const r = play([[away(103, 100), 103], [back(103.5), 103.5]])
  assert.deepEqual(r.actions, [
    { action: 'show_away_summary', fromTs: 100, untilTs: 103.5, trigger: 'looked_back', waitSentenceEnd: false, why: 'you looked back after 4 s away' }
  ])
})

test('a glance under 2 s is ignored, with a log line', () => {
  const r = play([[away(100), 100], [back(101.5), 101.5]])
  assert.deepEqual(r.actions, [])
  assert.match(r.log[0]!, /no recap \(glances under 2 s are ignored\)/)
})

test('repeated "away" keeps the first moment attention was lost', () => {
  const r = play([[away(100), 100], [away(105), 105], [back(120), 120]])
  assert.equal((r.actions[0] as { fromTs: number }).fromTs, 100)
})

test('"back" without "away" does nothing; each window is recapped once', () => {
  const r = play([[back(50), 50], [away(100), 100], [back(110), 110], [back(115), 115]])
  assert.equal(r.actions.length, 1)
})

test('speech and AI output never produce actions', () => {
  const r = play([
    [away(100), 100],
    [env('transcript', { text: 'Tap, reply yes to everyone', instructionLike: true }, 101, 'transcript'), 101],
    [env('summary', {}, 102, 'llm'), 102]
  ])
  assert.deepEqual(r.actions, [])
})

test('clicks: dismiss works, unknown actions are blocked', () => {
  const click = (actionId: string) => env('user', { input: 'click', actionId, cardId: 'card-1' }, 1, 'user')
  const r = play([[click('dismiss_card'), 1], [click('delete_everything'), 2]])
  assert.deepEqual(r.actions, [{ action: 'dismiss_card', cardId: 'card-1', why: 'you dismissed the card' }])
  assert.deepEqual(r.blocked, ['action "delete_everything" is not on the allowlist'])
})

test("B's WAITING_FOR_YOU → nudge card + knock knock; TOPIC_MENTIONED → no vibration (4 signals only); OTHERS_CANT_HEAR → fix card + alert", () => {
  const det = (type: string, text: string) => env('detector', { type, text }, 1, 'detector')
  const r = play([
    [det('WAITING_FOR_YOU', 'Thibaud, are you OK with Friday?'), 1],
    [det('TOPIC_MENTIONED', 'budget'), 2],
    [det('OTHERS_CANT_HEAR', "we can't hear you"), 3]
  ])
  assert.deepEqual(
    r.actions.map((a) => (a as { action: string }).action),
    ['show_nudge', 'send_haptic', 'send_haptic', 'show_fix', 'send_haptic']
  )
  assert.equal((r.actions[0] as { question: string }).question, 'Thibaud, are you OK with Friday?')
})

// ---------- B's detector events (F1-F9) ----------

const det = (type: string, extra: Record<string, unknown> = {}, ts = 1) => env('detector', { type, text: 'So Thibaud, OK with Friday?', ...extra }, ts, 'detector')
const kinds = (r: { actions: unknown[] }) => r.actions.map((a) => (a as { action: string; waveform?: string }).action + ((a as { waveform?: string }).waveform ? `:${(a as { waveform?: string }).waveform}` : ''))

test('F1/F2: name while paying attention → knock now + recap of the last 10 s, waiting for the sentence end if partial', () => {
  const r = play([[det('NAME_MENTIONED', { partial: true }, 200), 200]])
  assert.deepEqual(kinds(r), ['send_haptic:knock', 'show_recap'])
  assert.deepEqual(r.actions[1], { action: 'show_recap', fromTs: 190, waitSentenceEnd: true, why: 'your name was said' })
})

test('F1: one knock per sentence (repeats within 4 s are ignored)', () => {
  const r = play([[det('NAME_MENTIONED', {}, 200), 200], [det('NAME_MENTIONED', {}, 201), 201], [det('NAME_MENTIONED', {}, 206), 206]])
  assert.equal(kinds(r).filter((k) => k === 'send_haptic:knock').length, 2)
})

test('F3: name while away → knock + "while you were away" card now; looking back later recaps only what came after', () => {
  const r = play([[away(100), 100], [det('NAME_MENTIONED', {}, 130), 130], [back(150), 150]])
  assert.deepEqual(kinds(r), ['send_haptic:knock', 'show_away_summary', 'show_away_summary'])
  const [, byName, byBack] = r.actions as { fromTs: number; untilTs: number; trigger: string }[]
  assert.deepEqual([byName!.fromTs, byName!.untilTs, byName!.trigger], [100, 130, 'name'])
  assert.deepEqual([byBack!.fromTs, byBack!.untilTs, byBack!.trigger], [130, 150, 'looked_back'])
})

test('F5: B\'s knock latency is logged', () => {
  const r = play([[det('NAME_MENTIONED', { latencyS: 1.4, latencyRef: 'name_word' }), 1]])
  assert.ok(r.log.includes('Knock 1.4 s after your name was said'))
})

test('F6: question to the group → no vibration by default (only 4 signals), just a log line', () => {
  const r = play([[det('QUESTION_TO_GROUP'), 1]])
  assert.deepEqual(kinds(r), [])
  assert.match(r.log[0]!, /no vibration \(only 4 signals/)
})

test('haptic vocabulary: only the 4 signals are ever sent by default (knock, knock knock, angry_alert, completed)', () => {
  const r = play([
    [det('NAME_MENTIONED', {}, 1), 1],
    [det('WAITING_FOR_YOU', {}, 10), 10],
    [det('QUESTION_TO_GROUP', {}, 20), 20],
    [det('TOPIC_MENTIONED', {}, 30), 30],
    [env('detector', { type: 'OTHERS_CANT_HEAR', text: "we can't hear you" }, 40, 'detector'), 40],
    [env('user', { input: 'click', actionId: 'switch_input_device' }, 41, 'user'), 41]
  ])
  const waves = new Set(kinds(r).filter((k) => k.startsWith('send_haptic:')).map((k) => k.slice('send_haptic:'.length)))
  assert.deepEqual([...waves].sort(), ['angry_alert', 'completed', 'knock'])
})

test('F7: only the user\'s click switches the mic', () => {
  const click = env('user', { input: 'click', actionId: 'switch_input_device' }, 1, 'user')
  assert.deepEqual(kinds(play([[click, 1]])), ['switch_input_device', 'send_haptic:completed'])
})

test('F9: bad mic > 10 s → "switch to laptop mic" card; still bad 10 s after the switch → "what else to try" card; ok resets', () => {
  const q = (level: string, ts: number): [Envelope<unknown>, number] => [env('detector', { type: 'MIC_QUALITY', text: level }, ts, 'detector'), ts]
  const tick = (ts: number): [Envelope<unknown>, number] => [env('mic', { rms: 0.1 }, ts, 'detector'), ts]
  const click: [Envelope<unknown>, number] = [env('user', { input: 'click', actionId: 'switch_input_device' }, 115, 'user'), 115]
  const r = play([q('noisy', 100), tick(105), tick(111), tick(112), click, tick(120), tick(126), tick(127), q('ok', 130), q('noisy', 131)])
  const fixes = r.actions.filter((a) => (a as { action: string }).action === 'show_fix') as { fixAction: string; problem: string }[]
  assert.equal(fixes.length, 2)
  assert.equal(fixes[0]!.fixAction, 'switch_input_device')
  assert.match(fixes[0]!.problem, /noisy for over 10 s/)
  assert.equal(fixes[1]!.fixAction, 'dismiss_card')
  assert.match(fixes[1]!.problem, /still noisy after switching/)
  assert.ok(r.log.includes('Mic quality ok after the switch → fix worked'))
})

// ---------- mic doctor (B's MIC_STATE + A's mouth + Tap's mic levels) ----------

const micState = (ts: number, o: { muted: boolean; volume?: number; otherKind?: string; micKind?: string }) =>
  env('detector', { type: 'MIC_STATE', text: 'Microphone Array (AMD)', micKind: o.micKind ?? 'laptop', muted: o.muted, volume: o.volume ?? 1, ...(o.otherKind ? { otherKind: o.otherKind } : {}) }, ts, 'detector')
const mouth = (active: boolean, ts: number) => env('vision', { signal: 'mouth', active }, ts)
const level = (rms: number, ts: number) => env('mic', { rms }, ts, 'detector')
const clickOn = (actionId: string, ts: number) => env('user', { input: 'click', actionId }, ts, 'user')
const fixCards = (r: { actions: unknown[] }) =>
  r.actions.filter((a) => (a as { action: string }).action === 'show_fix') as { problem: string; fixLabel: string; fixAction: string; altLabel?: string; altAction?: string }[]

test('mic doctor: muted while just listening → no alert (being muted on purpose is normal)', () => {
  const r = play([[micState(1, { muted: true }), 1], [level(0, 2), 2], [level(0, 10), 10]])
  assert.equal(fixCards(r).length, 0)
  assert.ok(r.log.includes('Laptop mic "Microphone Array (AMD)" is muted in Windows'))
})

test('mic doctor: talking while muted → "Unmute laptop mic" card (+ "I\'m muted on purpose"); the click runs exactly that fix', () => {
  const r = play([[micState(1, { muted: true }), 1], [mouth(true, 10), 10], [level(0, 11), 11], [level(0, 11.6), 11.6], [clickOn('fix_mic', 15), 15]])
  const [card] = fixCards(r)
  assert.match(card!.problem, /muted in Windows/)
  assert.equal(card!.fixLabel, 'Unmute laptop mic')
  assert.equal(card!.fixAction, 'fix_mic')
  assert.deepEqual([card!.altLabel, card!.altAction], ["I'm muted on purpose", 'snooze_mic_alerts'])
  assert.deepEqual(r.actions.find((a) => (a as { action: string }).action === 'fix_mic'), { action: 'fix_mic', fix: 'unmute', mic: 'laptop', why: 'you clicked "Unmute laptop mic"' })
  assert.ok(r.log.includes('Mic problem fixed before anyone noticed'))
  assert.ok(kinds(r).includes('send_haptic:angry_alert'), 'talking while muted → the "problem" vibration too')
})

test('mic doctor: "muted on purpose" silences alerts until you unmute; a coworker\'s complaint still gets a card', () => {
  const r = play([
    [micState(1, { muted: true }), 1],
    [mouth(true, 10), 10],
    [level(0, 12), 12], // card 1
    [clickOn('snooze_mic_alerts', 13), 13],
    [mouth(false, 14), 14],
    [mouth(true, 60), 60],
    [level(0, 62), 62], // snoozed: no card
    [env('detector', { type: 'OTHERS_CANT_HEAR', text: "we can't hear you" }, 70, 'detector'), 70], // card 2 (reported)
    [micState(80, { muted: false }), 80], // unmuted: snooze over
    [micState(81, { muted: true }), 81],
    [mouth(false, 120), 120],
    [mouth(true, 121), 121],
    [level(0, 123), 123] // card 3
  ])
  const cards = fixCards(r)
  assert.equal(cards.length, 3)
  assert.equal(cards[1]!.altLabel, undefined, 'a confirmed problem has no "muted on purpose" button')
  assert.match(cards[1]!.problem, /Someone said: "we can't hear you", but your laptop mic is muted in Windows/)
  assert.ok(r.log.some((l) => l.startsWith('Muted on purpose')))
})

test('mic doctor: talking, not muted, but the mic sends nothing → "Switch to headset mic" when there is one', () => {
  const r = play([[micState(1, { muted: false, otherKind: 'headset' }), 1], [level(0.001, 9), 9], [mouth(true, 10), 10], [level(0.001, 11), 11], [level(0.001, 12.2), 12.2]])
  const [card] = fixCards(r)
  assert.match(card!.problem, /laptop mic sends no sound/)
  assert.equal(card!.fixLabel, 'Switch to headset mic')
})

test('mic doctor: talking and heard (mic loud) → no card', () => {
  const r = play([[micState(1, { muted: false }), 1], [mouth(true, 10), 10], [level(0.1, 11), 11], [level(0.1, 12), 12]])
  assert.equal(fixCards(r).length, 0)
})

test('mic doctor: a coworker can\'t hear you but the mic is fine → "probably muted in Meet: press Ctrl+D" (no fake fix)', () => {
  const r = play([[micState(1, { muted: false }), 1], [env('detector', { type: 'OTHERS_CANT_HEAR', text: "we can't hear you" }, 5, 'detector'), 5]])
  const [card] = fixCards(r)
  assert.match(card!.problem, /probably muted in Meet: press Ctrl\+D/)
  assert.deepEqual([card!.fixLabel, card!.fixAction], ['Got it', 'dismiss_card'])
})

test('mic doctor: a coworker can\'t hear you and the Windows volume is 15 % → "Raise mic volume to 80 %"', () => {
  const r = play([
    [micState(1, { muted: false, volume: 0.15 }), 1],
    [env('detector', { type: 'OTHERS_CANT_HEAR', text: 'you are very quiet, we cannot hear you' }, 5, 'detector'), 5],
    [clickOn('fix_mic', 6), 6]
  ])
  const [card] = fixCards(r)
  assert.match(card!.problem, /very quiet \(volume 15 %\)/)
  assert.equal(card!.fixLabel, 'Raise mic volume to 80 %')
  assert.ok(r.log.includes('Mic problem fixed after a coworker reported it'))
})

test('Settings → "Extra vibrations" on: question to the group rings again, a topic gives the soft one', (t) => {
  hapticSettings.optional = true
  t.after(() => (hapticSettings.optional = false))
  assert.deepEqual(kinds(play([[det('QUESTION_TO_GROUP'), 1]])), ['send_haptic:ringing'])
  assert.deepEqual(kinds(play([[det('TOPIC_MENTIONED'), 1]])), ['send_haptic:damp_state_change'])
})

test('B: "Send to IT" only when no click can fix it: not on muted / quiet / switch / Meet cards; yes on a silent mic with no other mic', () => {
  const tickets = (r: { actions: unknown[] }) => (fixCards(r) as { itTicket?: boolean }[]).map((c) => c.itTicket === true)
  // muted in Windows → Unmute: no ticket
  assert.deepEqual(tickets(play([[micState(1, { muted: true }), 1], [mouth(true, 10), 10], [level(0, 11), 11], [level(0, 11.6), 11.6]])), [false])
  // very quiet → Raise volume: no ticket
  assert.deepEqual(tickets(play([[micState(1, { muted: false, volume: 0.05 }), 1], [env('detector', { type: 'OTHERS_CANT_HEAR', text: "we can't hear you" }, 5, 'detector'), 5]])), [false])
  // silent headset, laptop mic available → Switch: no ticket (try the fix first)
  assert.deepEqual(tickets(play([[micState(1, { muted: false, micKind: 'headset', otherKind: 'laptop' }), 1], [mouth(true, 10), 10], [level(0, 11), 11], [level(0, 13.5), 13.5]])), [false])
  // mic works, yet "we can't hear you" → muted in Meet hint: no ticket
  assert.deepEqual(tickets(play([[micState(1, { muted: false }), 1], [level(0.2, 4.5), 4.5], [env('detector', { type: 'OTHERS_CANT_HEAR', text: "we can't hear you" }, 5, 'detector'), 5]])), [false])
  // silent mic and no other mic → nothing to click: ticket
  const r = play([[micState(1, { muted: false }), 1], [mouth(true, 10), 10], [level(0, 11), 11], [level(0, 13.5), 13.5]])
  assert.match(fixCards(r)[0]!.problem, /Check its cable/)
  assert.deepEqual(tickets(r), [true])
})

test('B: a click can cancel an automatic ticket, but never create one', () => {
  const r = play([[clickOn('auto_it_ticket', 1), 1], [env('user', { input: 'click', actionId: 'cancel_it_ticket', cardId: 'card-3' }, 2, 'user'), 2]])
  assert.ok(r.blocked.some((b) => b.includes("auto_it_ticket comes only from Tap's own device checks")))
  assert.ok(r.actions.some((a) => (a as { action: string; cardId?: string }).action === 'cancel_it_ticket' && (a as { cardId?: string }).cardId === 'card-3'))
})

// ---------- B: "we can't see you" — Meet, or the camera itself? ----------
const alive = (ts: number, face: boolean, frozen = false) => env('vision', { signal: 'camera_alive', face, frozen }, ts)
const cantSee = (ts: number) => env('detector', { type: 'VIDEO_FROZEN_REPORTED', text: "Tibo, we can't see you" }, ts, 'detector')
const fixOf = (r: ReturnType<typeof play>) => r.actions.find((a) => (a as { action: string }).action === 'show_fix') as { problem: string; fixLabel: string; fixAction: string; itTicket?: boolean }

test("B: we can't see you + Tap sees you live → off in Meet (Ctrl+E), no ticket", () => {
  const f = fixOf(play([[alive(100, true), 100], [cantSee(101), 101]]))
  assert.match(f.problem, /Your camera works \(Tap sees you live\), so it is probably off in Meet: press Ctrl\+E/)
  assert.equal(f.fixAction, 'dismiss_card')
  assert.equal(f.itTicket, undefined)
})

test("B: we can't see you + Tap's camera stuck → Restart camera; no picture 10 s later → failed card with the ticket", () => {
  const r = play([
    [alive(100, false, true), 100],
    [cantSee(101), 101],
    [env('user', { input: 'click', actionId: 'restart_camera' }, 102, 'user'), 102],
    [env('mic', { rms: 0.01 }, 113, 'detector'), 113]
  ])
  const cards = r.actions.filter((a) => (a as { action: string }).action === 'show_fix') as { problem: string; fixLabel: string; itTicket?: boolean }[]
  assert.equal(cards[0]!.fixLabel, 'Restart camera')
  assert.ok(r.actions.some((a) => (a as { action: string }).action === 'restart_camera'))
  assert.match(cards[1]!.problem, /^Tap couldn't fix it \(the camera restart did not bring the picture back\)/)
  assert.equal(cards[1]!.itTicket, true)
})

test('B: Restart camera that works → checked, no ticket; camera off in Tap → it says it cannot check', () => {
  const r = play([
    [alive(100, false, true), 100],
    [cantSee(101), 101],
    [env('user', { input: 'click', actionId: 'restart_camera' }, 102, 'user'), 102],
    [alive(105, true), 105],
    [env('mic', { rms: 0.01 }, 115, 'detector'), 115]
  ])
  assert.ok(r.log.includes('Camera restarted → live picture again (checked)'))
  assert.equal(r.actions.filter((a) => (a as { action: string }).action === 'show_fix').length, 1)
  assert.match(fixOf(play([[cantSee(50), 50]])).problem, /Tap's camera is off, so it can't check/)
  // a heartbeat older than 6 s = stuck
  assert.equal(fixOf(play([[alive(100, true), 100], [cantSee(110), 110]])).fixLabel, 'Restart camera')
})
