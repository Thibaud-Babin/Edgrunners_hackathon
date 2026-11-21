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
      haptics: { fire: async () => true },
      role: 'intern'
    },
    { timers: false }
  )
  const summary = (fallback?: 'timeout' | 'error') =>
    bus.publish('audio', fallback ? 'transcript' : 'llm', 'summary', {
      requestId: 'r',
      summary: { kind: 'recap', text: 'x', askedYou: false, topics: [], source: fallback ? 'template' : 'cloud' },
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
  for (let i = 0; i < 5; i++) bus.publish('executor', 'system', 'action.result', { action: 'show_fix', ok: true })
  assert.deepEqual(calls, [])
  bus.publish('executor', 'system', 'action.result', { action: 'show_fix', ok: true })
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

test('heartbeat: a feed silent for more than 10 s is flagged once, then back', () => {
  const { m, bus, logs, advance } = setup()
  advance(11)
  m.tick()
  m.tick()
  assert.equal(logs.filter((l) => l.startsWith('Vision feed silent')).length, 1)
  bus.publish('vision', 'vision', 'vision', { signal: 'back' })
  assert.ok(logs.includes('Vision feed back'))
})
