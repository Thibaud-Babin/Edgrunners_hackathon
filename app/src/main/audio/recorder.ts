/**
 * OWNER: B. Debug recorder: with TAP_RECORD=1, saves what Tap hears to demo/recordings/session-<time>-<source>.wav
 * (16 kHz mono). Used to benchmark speech models offline on REAL call audio (scripts/stt-bench.mts).
 * The WAV header is rewritten every few seconds, so the file stays playable even if the app is killed.
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Source } from '../../shared/events'

const DIR = resolve('..', 'demo', 'recordings')

function header(dataBytes: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + dataBytes, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16) // PCM chunk size
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28) // byte rate
  h.writeUInt16LE(2, 32) // block align
  h.writeUInt16LE(16, 34) // bits
  h.write('data', 36)
  h.writeUInt32LE(dataBytes, 40)
  return h
}

export class Recorder {
  private files = new Map<Source, { fd: number; bytes: number; lastHeader: number }>()
  private stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  push(source: Source, pcm: Int16Array): void {
    let f = this.files.get(source)
    if (!f) {
      mkdirSync(DIR, { recursive: true })
      const path = join(DIR, `session-${this.stamp}-${source}.wav`)
      f = { fd: openSync(path, 'w'), bytes: 0, lastHeader: 0 }
      writeSync(f.fd, header(0), 0, 44, 0)
      this.files.set(source, f)
      console.log(`[rec] recording ${source} → ${path}`)
    }
    const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    writeSync(f.fd, buf, 0, buf.length, 44 + f.bytes)
    f.bytes += buf.length
    if (Date.now() - f.lastHeader > 3000) {
      writeSync(f.fd, header(f.bytes), 0, 44, 0)
      f.lastHeader = Date.now()
    }
  }

  close(): void {
    for (const f of this.files.values()) {
      writeSync(f.fd, header(f.bytes), 0, 44, 0)
      closeSync(f.fd)
    }
    this.files.clear()
  }
}
