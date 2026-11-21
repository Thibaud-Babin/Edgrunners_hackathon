import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UiCommand } from '../../shared/events.ts'
import { AgentBus, EventBus } from '../bus.ts'
import { Monitor } from './monitor.ts'

function setup() {
  let t = 1000
  const logs: string[] = []
  const calls: string[] = []
  const bus = new AgentBus()
  const m = new Monitor(new EventBus(), bus, (c: UiCommand) => c.type === 'LOG_ENTRY' && logs.push(c.entry.text), { now: () => t })
  m.start(
    {
      llm: { hasKey: true, forceTemplateUntil: (ts) => calls.push(`template until ${ts}`) },
      executor: { pause: (ts) => calls.push(`pause until ${ts}`), hapticsOff: () => calls.push('haptics off') },
      haptics: { fire: async () => true }
    },
    { timers: false }
  )
  const summary = (fallback?: 'timeout' | 'error') =>
    bus.publish('audio', fallback ? 'transcript' : 'llm', 'summary', {
      requestId: 'r',
      summary: { text: 'x', askedYou: false, topics: [], source: fallback ? 'template' : 'cloud' },
      transcript: 'x',
      costUsd: 0,
      usedLlm: !fallback,
      ...(fallback ? { fallback } : {})
    })
  return { m, bus, logs, calls, summary, advance: (s: number) => (t += s) }
}

test('startup self-check writes one line', async () => {
  const { logs } = setup()
  await new Promise((r) => setImmediate(r))
  assert.equal(logs.filter((l) => l.startsWith('Self-check:')).length, 1)
})

test('spam guard: more than 5 actions in 10 s pauses the executor 5 s', () => {
  const { bus, calls, logs } = setup()
  for (let i = 0; i < 5; i++) bus.publish('executor', 'system', 'action.result', { action: 'show_away_summary', ok: true })
  assert.deepEqual(calls, [])
  bus.publish('executor', 'system', 'action.result', { action: 'show_away_summary', ok: true })
  assert.deepEqual(calls, ['pause until 1005'])
  assert.ok(logs.some((l) => l.startsWith('Spam guard')))
})

test('AI breaker: 2 failures in a row → template for 60 s, a success in between resets', () => {
  const { summary, calls, m, advance, logs } = setup()
  summary('timeout')
  summary()
  summary('error')
  assert.deepEqual(calls, [])
  summary('timeout')
  assert.deepEqual(calls, ['template until 1060'])
  advance(60)
  m.tick()
  assert.ok(logs.includes('AI breaker closed → cloud summaries retried'))
})

test('haptics breaker: 3 failed calls in a row → haptics off', () => {
  const { bus, calls, logs } = setup()
  for (let i = 0; i < 2; i++) bus.publish('executor', 'system', 'action.result', { action: 'send_haptic', ok: false })
  assert.deepEqual(calls, [])
  bus.publish('executor', 'system', 'action.result', { action: 'send_haptic', ok: false })
  assert.deepEqual(calls, ['haptics off'])
  assert.ok(logs.some((l) => l.includes('local.jmw.nz')))
})

test('heartbeat: camera and mic silent > 10 s are flagged once, then back; call audio waits 60 s', () => {
  const { m, bus, logs, advance } = setup()
  advance(11)
  m.tick()
  m.tick()
  assert.equal(logs.filter((l) => l.startsWith('Camera feed silent')).length, 1)
  assert.equal(logs.filter((l) => l.startsWith('Mic feed silent')).length, 1)
  assert.equal(logs.filter((l) => l.startsWith('Call audio feed silent')).length, 0, 'a quiet call is normal')
  bus.publish('vision', 'vision', 'vision', { signal: 'back' })
  assert.ok(logs.includes('Camera feed back'))
  advance(50)
  m.tick()
  assert.equal(logs.filter((l) => l.startsWith('Call audio feed silent')).length, 1)
})

test('mic: mouth moving with a silent mic for 2 s is reported, once per 30 s', () => {
  const { m, bus, logs, advance } = setup()
  const micProblems = () => logs.filter((l) => l.startsWith('Mouth moving but the mic sends nothing')).length
  bus.publish('audio', 'detector', 'mic', { rms: 0.2 })
  bus.publish('vision', 'vision', 'vision', { signal: 'mouth', active: true })
  assert.equal(micProblems(), 0, 'the mic was loud just now')
  advance(1)
  bus.publish('audio', 'detector', 'mic', { rms: 0 })
  assert.equal(micProblems(), 0)
  advance(1.5)
  m.tick()
  assert.equal(micProblems(), 1)
  advance(10)
  bus.publish('audio', 'detector', 'mic', { rms: 0 })
  assert.equal(micProblems(), 1, 'cooldown')
  advance(30)
  bus.publish('audio', 'detector', 'mic', { rms: 0 })
  assert.equal(micProblems(), 2)
})

test('mic: no mic levels at all (mic not monitored) → no "mic sends nothing" alert (B\'s fix)', () => {
  const { m, bus, logs, advance } = setup()
  bus.publish('vision', 'vision', 'vision', { signal: 'mouth', active: true })
  advance(5)
  m.tick()
  assert.ok(!logs.some((l) => l.startsWith('Mouth moving')))
  assert.ok(logs.some((l) => l.startsWith('Mic feed silent')) === false, 'feed-silent only after 10 s')
})

test('mic: a silent mic while the mouth is still is not a problem', () => {
  const { m, bus, logs, advance } = setup()
  bus.publish('vision', 'vision', 'vision', { signal: 'mouth', active: false })
  advance(5)
  bus.publish('audio', 'detector', 'mic', { rms: 0 })
  m.tick()
  assert.ok(!logs.some((l) => l.startsWith('Mouth moving')))
})

test('camera problems and problems reported in the call are logged in plain words', () => {
  const { bus, logs } = setup()
  bus.publish('vision', 'vision', 'vision', { signal: 'camera_frozen' })
  bus.publish('vision', 'vision', 'vision', { signal: 'camera_frozen' })
  bus.publish('vision', 'vision', 'vision', { signal: 'low_light' })
  bus.publish('detector', 'detector', 'detector', { type: 'OTHERS_CANT_HEAR', text: "we can't hear you" })
  assert.equal(logs.filter((l) => l === 'Camera image is frozen → check the webcam').length, 1)
  assert.ok(logs.includes('Room too dark for the camera → attention detection may fail'))
  assert.ok(logs.includes("Someone in the call said they can't hear you → check your mic"))
})

test("B's MIC_QUALITY: a bad level is a device problem, back to ok is logged once", () => {
  const events = new EventBus()
  const logs: string[] = []
  new Monitor(events, new AgentBus(), (c: UiCommand) => c.type === 'LOG_ENTRY' && logs.push(c.entry.text), { now: () => 1000 })
  const q = (level: string) => events.publish({ type: 'MIC_QUALITY', ts: 1000, source: 'mic', data: { level, speech_rms: 0.01 } })
  q('noisy')
  q('ok')
  q('ok')
  q('loud!') // not one of B's levels → dropped as invalid
  assert.ok(logs.includes('Mic quality: noisy → check your mic, or switch to the laptop mic'))
  assert.equal(logs.filter((l) => l === 'Mic quality back to ok').length, 1)
  assert.ok(logs.some((l) => l.startsWith('invalid message dropped: MIC_QUALITY')))
})

test("B's STT_USAGE: speech-to-text cost (running total per engine) is added to the cost counter once", () => {
  const events = new EventBus()
  let cost = 0
  new Monitor(events, new AgentBus(), (c: UiCommand) => { if (c.type === 'COUNTERS') cost = c.costUsd }, { now: () => 1000 })
  const u = (cost_usd: number) => events.publish({ type: 'STT_USAGE', ts: 1000, source: 'call_audio', data: { engine: 'deepgram', seconds: 60, cost_usd } })
  u(0.004)
  u(0.009)
  assert.ok(Math.abs(cost - 0.009) < 1e-9)
})
