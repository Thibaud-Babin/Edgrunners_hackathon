/**
 * Mock mode (`npm run mock`): replays a scripted meeting or a real recording, so the agents can be tested
 * without a live call.
 *
 * Scripted (`demo/mock-events.json`, the default), one JSON array:
 *   { "t": seconds from start, "speech": "..." }  → goes through the audio pipeline as call audio
 *   { "t": ..., "event": { "type": "USER_AWAY", "source": "webcam", "data": {...} } } → published as-is
 *   { "t": ..., "sim": "ai_timeout" } → the next LLM call hangs (tests the 3 s timeout + template fallback)
 *
 * Recorded (`*.jsonl`, written by `startRecording`): one TapEvent per line, replayed with its original timing.
 * Choose the file with TAP_MOCK_FILE (relative to the repo root).
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TapEvent } from '../shared/events.ts'
import { now } from '../shared/events.ts'
import type { EventBus } from './bus.ts'
import type { AudioPipeline } from './audio/pipeline.ts'

export interface MockLine {
  t: number
  speech?: string
  event?: Omit<TapEvent, 'ts'>
  sim?: 'ai_timeout'
}

export function runMock(file: string, bus: EventBus, audio: AudioPipeline, onSim: (sim: 'ai_timeout') => void = () => {}): void {
  const text = readFileSync(file, 'utf-8')
  const lines = file.endsWith('.jsonl') ? parseRecording(text) : (JSON.parse(text) as MockLine[])
  console.log(`[mock] replaying ${lines.length} lines from ${file}`)
  for (const l of lines) {
    setTimeout(() => {
      if (l.speech) audio.onText('call_audio', l.speech, true)
      if (l.sim) onSim(l.sim)
      // Fresh timestamps keep the original spacing. The agents re-validate every event, as for live input.
      if (l.event) bus.publish({ ...l.event, ts: now() })
    }, l.t * 1000)
  }
}

/**
 * A recording → mock lines: each event at its offset from the first one.
 * Recorded events are published as they are (not re-run through speech-to-text or the detectors),
 * since the recording already holds what B's pipeline produced. Unreadable lines are skipped.
 */
export function parseRecording(text: string): MockLine[] {
  const events: TapEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as TapEvent
      if (typeof e?.type === 'string' && typeof e.ts === 'number') events.push(e)
    } catch {
      console.warn('[mock] skipped an unreadable recording line')
    }
  }
  const start = events[0]?.ts ?? 0
  return events.map(({ ts, ...event }) => ({ t: ts - start, event }))
}

/**
 * Dev only (TAP_RECORD=1): writes every event on the bus to `<dir>/<time>.jsonl`, to replay real sessions later.
 * Recordings hold real speech: `demo/recordings/` is gitignored and must never be committed.
 */
export function startRecording(bus: EventBus, dir: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
  bus.on('*', (e) => appendFileSync(file, JSON.stringify(e) + '\n'))
  console.log(`[record] writing every event to ${file}`)
  return file
}
