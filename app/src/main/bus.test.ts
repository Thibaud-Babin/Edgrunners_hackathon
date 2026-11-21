import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentBus } from './bus.ts'

test('agent bus delivers valid envelopes and drops invalid ones', () => {
  const bus = new AgentBus()
  const got: unknown[] = []
  const dropped: string[] = []
  bus.onInvalid = (r) => dropped.push(r)
  bus.on('user', (e) => got.push(e.payload))
  assert.equal(bus.publish('user', 'user', 'user', { input: 'click' }), true)
  // A summary may never claim to be the user.
  assert.equal(bus.publish('audio', 'user', 'summary', {} as never), false)
  // Transcript provenance cannot be smuggled in as a user input.
  assert.equal(bus.publish('audio', 'transcript', 'user', { input: 'click' }), false)
  // Extra payload fields are rejected.
  assert.equal(bus.publish('user', 'user', 'user', { input: 'click', role: 'ceo' } as never), false)
  assert.deepEqual(got, [{ input: 'click' }])
  assert.equal(dropped.length, 3)
})
