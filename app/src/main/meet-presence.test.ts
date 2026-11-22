import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GONE_S, LEFT_S, MeetPresence } from './audio/meet-presence.ts'

test('meet presence: another meeting code → the old meeting ended', () => {
  const p = new MeetPresence()
  assert.equal(p.update('abc-defg-hij', 3, 0), null)
  assert.equal(p.update('abc-defg-hij', 3, 2), null)
  assert.deepEqual(p.update('xyz-abcd-efg', 2, 4), { meeting: 'abc-defg-hij', why: 'another meeting' })
  assert.equal(p.current, 'xyz-abcd-efg')
})

test('meet presence: no tiles for a few seconds → you left; the lobby before joining is not a call', () => {
  const p = new MeetPresence()
  assert.equal(p.update('abc-defg-hij', 0, 0), null, 'lobby: never in the call')
  assert.equal(p.update('abc-defg-hij', 0, 30), null)
  p.update('abc-defg-hij', 2, 31)
  assert.equal(p.update('abc-defg-hij', 0, 32), null, 'a tile blinking away is not leaving')
  assert.equal(p.update('abc-defg-hij', 2, 34), null)
  assert.equal(p.update('abc-defg-hij', 0, 35), null)
  assert.deepEqual(p.update('abc-defg-hij', 0, 35 + LEFT_S), { meeting: 'abc-defg-hij', why: 'you left the call' })
  assert.equal(p.update('abc-defg-hij', 0, 60), null, 'ended once only')
})

test('meet presence: the extension goes quiet while in a call → the tab was closed', () => {
  const p = new MeetPresence()
  p.update('abc-defg-hij', 2, 0)
  assert.equal(p.tick(GONE_S - 1), null)
  assert.deepEqual(p.tick(GONE_S), { meeting: 'abc-defg-hij', why: 'the Meet tab was closed' })
  assert.equal(p.tick(GONE_S + 10), null)
  assert.equal(new MeetPresence().tick(100), null, 'never connected: nothing to end')
})
