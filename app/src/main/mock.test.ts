import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRecording } from './mock.ts'

test('a recording replays every event at its offset from the first one', () => {
  const rec = [
    { type: 'USER_AWAY', ts: 1000, source: 'webcam', data: { reason: 'turned_away' } },
    { type: 'TRANSCRIPT_FINAL', ts: 1004.5, source: 'call_audio', data: { text: 'Release on Friday.' } },
    { type: 'USER_BACK', ts: 1012, source: 'webcam' }
  ]
    .map((e) => JSON.stringify(e))
    .join('\n')
  const lines = parseRecording(rec + '\n')
  assert.deepEqual(
    lines.map((l) => [l.t, l.event?.type]),
    [
      [0, 'USER_AWAY'],
      [4.5, 'TRANSCRIPT_FINAL'],
      [12, 'USER_BACK']
    ]
  )
  assert.equal('ts' in (lines[1]!.event as object), false, 'replay sets a fresh ts')
})

test('unreadable or shapeless lines are skipped, not fatal', () => {
  const lines = parseRecording('not json\n{"foo":1}\n{"type":"USER_BACK","ts":5,"source":"webcam"}\n')
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.t, 0)
})
