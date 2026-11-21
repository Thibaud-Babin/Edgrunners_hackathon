/**
 * OWNER: C. Fires MX Master 4 waveforms.
 * Route 1 (now): HapticWeb plugin — POST {TAP_HAPTIC_URL}/haptic/{name} with an empty body.
 * Route 2 (P1-5): our own plugin (fork of Logitech's HapticsPlugin) — same URL shape on plain http://127.0.0.1.
 * If local.jmw.nz doesn't resolve on venue Wi-Fi: add "127.0.0.1 local.jmw.nz" to C:\Windows\System32\drivers\etc\hosts
 */
import type { Waveform } from '../shared/events'

export class Haptics {
  constructor(
    private baseUrl = process.env.TAP_HAPTIC_URL || 'https://local.jmw.nz:41443',
    private onFail: (reason: string) => void = () => {}
  ) {}

  // Waveforms sent back-to-back (the "knock knock" of WAITING_FOR_YOU) reached the mouse ~1 ms apart, while the
  // first was still playing, so the user felt ONE knock. Haptics are queued with a minimum gap between them (B).
  private chain: Promise<unknown> = Promise.resolve()
  private lastAt = 0
  static readonly GAP_MS = 350

  fire(waveform: Waveform): Promise<boolean> {
    const run = this.chain.then(async () => {
      const wait = this.lastAt + Haptics.GAP_MS - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      this.lastAt = Date.now()
      return this.send(waveform)
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  private async send(waveform: Waveform): Promise<boolean> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1000)
    try {
      const res = await fetch(`${this.baseUrl}/haptic/${waveform}`, { method: 'POST', body: '', signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return true
    } catch (err) {
      // Fallback: the UI flashes so the demo still shows *something*.
      this.onFail(`haptic ${waveform} failed: ${(err as Error).message}`)
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}
