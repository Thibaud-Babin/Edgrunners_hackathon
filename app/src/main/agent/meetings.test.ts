import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { CallTranscript } from './call-summary.ts'
import { Meetings, type SummaryFrom } from './meetings.ts'

interface Run {
  id: string
  final: boolean
  from: SummaryFrom
  lines: string[]
}

function rig(t: { after: (fn: () => void) => void }) {
  mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => mock.timers.reset())
  const runs: Run[] = []
  const m = new Meetings(async (call: CallTranscript, final, from) => {
    runs.push({ id: call.id, final, from, lines: call.lines.map((l) => l.text) })
    call.markSummarized()
  })
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await m.idle()
  }
  return { m, runs, flush }
}

const MEETING_1 = ['Morning everyone, the budget is ten percent over.', 'Thibaud, can you send the numbers by Monday?', 'We move the release to Friday.']

test('meetings: goodbye + 15 s of silence → final summary, and the next call is a NEW meeting with a fresh transcript', async (t) => {
  const { m, runs, flush } = rig(t)
  MEETING_1.forEach((l, i) => m.onLine(l, 100 + i * 10))
  m.onLine('OK, thanks everyone, bye.', 140)
  mock.timers.tick(14_000)
  await flush()
  assert.equal(runs.length, 0, 'not before 15 s')
  mock.timers.tick(1_000)
  await flush()
  assert.equal(runs.length, 1)
  assert.equal(runs[0]!.final, true)
  assert.equal(runs[0]!.from, 'auto')
  assert.equal(runs[0]!.lines.length, 4)

  m.onLine('Hi, this is the design review.', 400)
  m.request('overlay')
  await flush()
  assert.notEqual(runs[1]!.id, runs[0]!.id, 'a different meeting')
  assert.deepEqual(runs[1]!.lines, ['Hi, this is the design review.'], 'the first meeting is not mixed in')
  assert.equal(runs[1]!.final, false)
})

test('meetings: a goodbye followed by more talk does not end the meeting', async (t) => {
  const { m, runs, flush } = rig(t)
  MEETING_1.forEach((l, i) => m.onLine(l, 100 + i * 10))
  m.onLine('Bye Marie, see you tomorrow!', 130) // Marie leaves, the others go on
  mock.timers.tick(5_000)
  m.onLine('So, back to the roadmap for the next quarter.', 136)
  mock.timers.tick(15_000)
  await flush()
  assert.equal(runs.length, 0, '15 s after the goodbye, but people kept talking: no summary yet')
})

test('meetings: no goodbye → after 2 min of silence a summary "so far"; the meeting stays open', async (t) => {
  const { m, runs, flush } = rig(t)
  MEETING_1.forEach((l, i) => m.onLine(l, 100 + i * 10))
  mock.timers.tick(120_000)
  await flush()
  assert.equal(runs.length, 1)
  assert.equal(runs[0]!.final, false)
  m.onLine('Sorry, I was sharing my screen. Next point.', 250)
  m.request('main')
  await flush()
  assert.equal(runs[1]!.id, runs[0]!.id, 'same meeting: the panel entry is replaced, not duplicated')
  assert.equal(runs[1]!.lines.length, 4)
})

test('meetings: speech after more than 5 min of silence closes the previous meeting first (final), then starts a new one', async (t) => {
  const { m, runs, flush } = rig(t)
  m.autoSummary = true
  MEETING_1.forEach((l, i) => m.onLine(l, 100 + i * 10))
  m.onLine('One more thing about the budget, then we stop.', 125)
  // (the 2-min "so far" timer would fire here in real life; skip it to test the gap rule alone)
  m.stop()
  m.onLine('Hello, welcome to the weekly sync.', 125 + 301)
  await flush()
  assert.equal(runs.length, 1)
  assert.equal(runs[0]!.final, true)
  assert.equal(runs[0]!.lines.length, 4)
  assert.equal(m.current.lines.length, 1)
})

test('meetings: Settings "summary at the end" off → nothing by itself, meetings still split; the button still works', async (t) => {
  const { m, runs, flush } = rig(t)
  m.autoSummary = false
  MEETING_1.forEach((l, i) => m.onLine(l, 100 + i * 10))
  m.onLine('Thanks everyone, bye!', 130)
  mock.timers.tick(200_000)
  m.onLine('New call starting now.', 1000)
  await flush()
  assert.equal(runs.length, 0)
  assert.equal(m.current.lines.length, 1, 'split anyway')
  m.request('main')
  await flush()
  assert.equal(runs.length, 1)
})

test('meetings: two stray lines then silence → no automatic summary (needs a real conversation)', async (t) => {
  const { m, runs, flush } = rig(t)
  m.onLine('Can you hear me?', 100)
  m.onLine('Bye.', 101)
  mock.timers.tick(200_000)
  await flush()
  assert.equal(runs.length, 0)
})

test('meetings (B): end() from Meet (you left / another meeting) → final summary now, the next call starts fresh', async (t) => {
  const { m, runs, flush } = rig(t)
  MEETING_1.forEach((l, i) => m.onLine(l, 100 + i))
  assert.equal(m.end(), true)
  await flush()
  assert.equal(runs.length, 1)
  assert.equal(runs[0]!.final, true)
  assert.deepEqual(runs[0]!.lines, MEETING_1)
  m.onLine('Hi, new call here.', 110)
  await m.request('main')
  await flush()
  assert.deepEqual(runs[1]!.lines, ['Hi, new call here.'], 'the second call does not contain the first')
  assert.equal(new Meetings(async () => {}).end(), false, 'nothing said: nothing to end')
})
