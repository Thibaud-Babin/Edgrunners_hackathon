/**
 * Mock mode (`npm run mock`): replays demo/mock-events.json so everyone can work without the real senses.
 * Each line: { "t": seconds from start, "speech": "..." }  → goes through the audio pipeline as call audio
 *        or: { "t": ..., "event": { "type": "USER_AWAY", "source": "webcam", "data": {...} } } → published as-is
 */
import { readFileSync } from 'node:fs'
import type { TapEvent } from '../shared/events'
import { now } from '../shared/events'
import type { EventBus } from './bus'
import type { AudioPipeline } from './audio/pipeline'

interface MockLine {
  t: number
  speech?: string
  event?: Omit<TapEvent, 'ts'>
}

export function runMock(file: string, bus: EventBus, audio: AudioPipeline): void {
  const lines = JSON.parse(readFileSync(file, 'utf-8')) as MockLine[]
  console.log(`[mock] replaying ${lines.length} lines from ${file}`)
  for (const l of lines) {
    setTimeout(() => {
      if (l.speech) audio.onText('call_audio', l.speech, true)
      if (l.event) bus.publish({ ...l.event, ts: now() })
    }, l.t * 1000)
  }
}
