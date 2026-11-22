import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { SpeakerNames } from './audio/speaker-names.ts'
import { acceptMeet, MEET_EXTENSION_ID, others } from './audio/meet-bridge.ts'

// The extension's pure rules (a plain browser script that sets globalThis.TapMeetParse)
createRequire(import.meta.url)('../../../extension/meet-names/parse.js')
const P = (globalThis as unknown as { TapMeetParse: {
  pickName: (l: string[]) => { name: string; self: boolean; presenting: boolean } | null
  speakingFrom: (c: number[], now: number) => boolean
  meetingCode: (p: string) => string
} }).TapMeetParse

function rig() {
  let t = 1_000_000
  const n = new SpeakerNames(() => t)
  const at = (ms: number) => (t = ms)
  const meet = (speaking: string[], people = ['Sarah Martin', 'Tom Weber']) =>
    n.update(people.map((name, i) => ({ id: `p${i}`, name, speaking: speaking.includes(name) })))
  return { n, at, meet }
}

test('meet names: the sentence gets the name Meet showed as speaking, and Speaker N learns it', () => {
  const { n, at, meet } = rig()
  at(1_000_000); meet([])
  at(1_001_000); meet(['Sarah Martin'])
  at(1_004_000); meet([])
  assert.equal(n.label(1, 1_001_100, 1_003_900), 'Sarah Martin', 'clear speaker → her name')
  at(1_005_000); meet(['Sarah Martin'])
  at(1_008_000); meet([])
  assert.equal(n.label(1, 1_005_100, 1_007_900), 'Sarah Martin')
  assert.equal(n.nameOf(1), 'Sarah Martin', '2 agreeing sentences → Speaker 2 is Sarah')
  // both talk at once: nobody clear → the learned name
  at(1_009_000); meet(['Sarah Martin', 'Tom Weber'])
  at(1_012_000); meet([])
  assert.equal(n.label(1, 1_009_100, 1_011_900), 'Sarah Martin')
  assert.equal(n.label(0, 1_009_100, 1_011_900), 'Speaker 1', 'nothing learned for Speaker 1 yet')
})

test('meet names: no extension, or it stopped → Speaker N as before; no diarization → name alone', () => {
  const { n, at, meet } = rig()
  assert.equal(n.label(0, 0, 1000), 'Speaker 1')
  assert.equal(n.label(undefined, 0, 1000), undefined)
  at(1_000_000); meet(['Tom Weber'])
  at(1_003_000); meet([])
  assert.equal(n.label(undefined, 1_000_100, 1_002_900), 'Tom Weber', 'engine without speaker numbers')
  at(1_020_000)
  assert.equal(n.connected, false)
  assert.deepEqual(n.participants, [])
})

test('meet names: names are cleaned like speech (bidi tricks, length)', () => {
  const { n, at, meet } = rig()
  at(1_000_000); meet(['‮Eve'], ['‮Eve'])
  at(1_002_000); meet([], ['‮Eve'])
  assert.equal(n.label(0, 1_000_100, 1_001_900), 'Eve')
})

test('meet bridge: only our extension, only JSON, only a valid update; your own tile is dropped', () => {
  const body = JSON.stringify({ v: 1, meeting: 'abc-defg-hij', people: [{ id: 'a', name: 'Sarah', speaking: true, self: false }, { id: 'b', name: 'Thibaud', speaking: false, self: true }] })
  const ok = acceptMeet(`chrome-extension://${MEET_EXTENSION_ID}`, 'application/json', body)
  assert.ok(ok.ok)
  assert.deepEqual(ok.ok && others(ok.update), [{ id: 'a', name: 'Sarah', speaking: true }])
  assert.equal(acceptMeet('https://evil.example', 'application/json', body).ok, false, 'a web page')
  assert.equal(acceptMeet('chrome-extension://someotherextensionid', 'application/json', body).ok, false, 'another extension')
  assert.equal(acceptMeet(undefined, 'application/json', body).ok, false, 'no origin (curl, other apps)')
  assert.equal(acceptMeet(`chrome-extension://${MEET_EXTENSION_ID}`, 'text/plain', body).ok, false)
  assert.equal(acceptMeet(`chrome-extension://${MEET_EXTENSION_ID}`, 'application/json', '{"v":1,"meeting":"x","people":[],"cmd":"rm"}').ok, false, 'extra fields')
})

test('extension: the name on a tile, you, presentations, icon text', () => {
  assert.deepEqual(P.pickName(['mic_off', 'Sarah Martin', 'more_vert']), { name: 'Sarah Martin', self: false, presenting: false })
  assert.equal(P.pickName(['bars', 'Sarah Martin'])?.name, 'Sarah Martin', 'a lowercase line before the name is not the name')
  assert.deepEqual(P.pickName(['Thibaud Babin (You)']), { name: 'Thibaud Babin', self: true, presenting: false })
  assert.equal(P.pickName(['You', 'Thibaud'])?.self, true)
  assert.equal(P.pickName(['Sarah Martin (Presentation)'])?.presenting ?? true, true)
  assert.equal(P.pickName(['frame_person', '', '  ']), null)
  assert.equal(P.speakingFrom([1000, 1300], 1500), true)
  assert.equal(P.speakingFrom([1000], 1500), false)
  assert.equal(P.speakingFrom([100, 200], 1500), false, 'old changes do not count')
  assert.equal(P.meetingCode('/abc-defg-hij'), 'abc-defg-hij')
  assert.equal(P.meetingCode('/landing'), '')
})
