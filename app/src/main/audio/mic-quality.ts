/**
 * OWNER: B. Mic quality meter (MEASURES only; the agent decides what to suggest).
 * Looks at the user's own mic PCM over a sliding 8 s window of 100 ms chunks:
 *  - noise_rms  = 20th percentile of chunk loudness (the background when nobody speaks)
 *  - speech_rms = 90th percentile (the user's voice when they speak)
 *  - clipped_pct = share of samples at full scale
 * Levels: clipping (> 1 % clipped) · noisy (background > -32 dBFS) · too_quiet (voice < -46 dBFS while
 * the background is low, i.e. they talk but the mic barely hears them) · ok.
 * Publishes MIC_QUALITY only when the level changes (and at most every 10 s), so the log stays readable.
 * TODO(B): tune the thresholds on the demo headset + laptop mic.
 */
const WINDOW_CHUNKS = 80 // 8 s of 100 ms chunks
const CLIP = 32000
const NOISY_RMS = 0.025 // ≈ -32 dBFS
const QUIET_SPEECH_RMS = 0.005 // ≈ -46 dBFS
const MIN_INTERVAL_MS = 10_000

export type MicLevel = 'ok' | 'too_quiet' | 'clipping' | 'noisy'
export interface MicQuality {
  level: MicLevel
  speech_rms: number
  noise_rms: number
  clipped_pct: number
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

export class MicQualityMeter {
  private rms: number[] = []
  private clipped: number[] = []
  private last: MicLevel | null = null
  private lastAt = 0

  constructor(private publish: (q: MicQuality) => void) {}

  push(pcm: Int16Array): void {
    let sum = 0
    let clip = 0
    for (const v of pcm) {
      sum += (v / 32768) ** 2
      if (v >= CLIP || v <= -CLIP) clip++
    }
    this.rms.push(Math.sqrt(sum / pcm.length))
    this.clipped.push(clip / pcm.length)
    if (this.rms.length > WINDOW_CHUNKS) {
      this.rms.shift()
      this.clipped.shift()
    }
    if (this.rms.length < WINDOW_CHUNKS) return // wait for a full window

    const sorted = [...this.rms].sort((a, b) => a - b)
    const noise = pct(sorted, 0.2)
    const speech = pct(sorted, 0.9)
    const clippedPct = (100 * this.clipped.reduce((a, b) => a + b, 0)) / this.clipped.length
    let level: MicLevel = 'ok'
    if (clippedPct > 1) level = 'clipping'
    else if (noise > NOISY_RMS) level = 'noisy'
    else if (speech < QUIET_SPEECH_RMS && speech > noise * 1.5) level = 'too_quiet'

    const t = Date.now()
    if (level === this.last || t - this.lastAt < MIN_INTERVAL_MS) return
    this.last = level
    this.lastAt = t
    this.publish({ level, speech_rms: +speech.toFixed(4), noise_rms: +noise.toFixed(4), clipped_pct: +clippedPct.toFixed(2) })
  }
}
