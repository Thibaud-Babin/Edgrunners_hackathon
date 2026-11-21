/**
 * OWNER: B. Windows microphones, at the SYSTEM level (what Meet, Teams and Tap all hear).
 * Runs scripts/win-mic.ps1 once (Windows Core Audio through PowerShell, nothing to install) and talks to it
 * over stdin/stdout. It can:
 *  - list the mics with their kind (headset / laptop), Windows mute state, volume and which one is the default;
 *  - watch the default mic and report every change (B publishes it as MIC_STATE for the agent's mic doctor);
 *  - run the fix a card names (unmute / switch / raise the volume) and CHECK it worked (the agent's MicPort).
 * It only measures and obeys: deciding what to suggest is the agent's job (rules.ts), and only a click runs a fix.
 * Meet follows the new default when its microphone setting is "Default" (Meet's own setting).
 * Meet's OWN mute button is inside the web page: no app can read or press it, so it is out of reach.
 * Not Windows → every call answers { ok: false } and Tap behaves as before.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'

export type MicKind = 'headset' | 'laptop'
export interface WinMicInfo {
  id: string
  name: string
  kind: MicKind
  default: boolean
  muted: boolean
  volume: number
}

/** Headset / Bluetooth / USB mics vs the laptop's built-in mic, from the Windows device name. */
export function micKind(name: string): MicKind {
  return /headset|headphone|hands-?free|casque|bluetooth|airpods|buds|wh-|wf-|jabra|usb/i.test(name) ? 'headset' : 'laptop'
}

export class WinMic {
  private proc: ChildProcessWithoutNullStreams | null = null
  private queue: Array<(line: string) => void> = []
  private buf = ''
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private log: (text: string) => void = (t) => console.log(`[mic] ${t}`)) {}

  get available(): boolean {
    return process.platform === 'win32'
  }

  private start(): void {
    if (this.proc || !this.available) return
    const script = resolve(process.cwd(), 'scripts', 'win-mic.ps1')
    this.proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (line) this.queue.shift()?.(line)
      }
    })
    this.proc.on('exit', () => {
      this.proc = null
      for (const r of this.queue.splice(0)) r('{"ok":false,"error":"helper stopped"}')
    })
  }

  private ask(cmd: string): Promise<Record<string, unknown>> {
    this.start()
    if (!this.proc) return Promise.resolve({ ok: false, error: 'not Windows' })
    return new Promise((res) => {
      const timeout = setTimeout(() => res({ ok: false, error: 'timeout' }), 8000)
      this.queue.push((line) => {
        clearTimeout(timeout)
        try {
          res(JSON.parse(line))
        } catch {
          res({ ok: false, error: line })
        }
      })
      this.proc!.stdin.write(cmd + '\n')
    })
  }

  async list(): Promise<WinMicInfo[]> {
    const r = await this.ask('list')
    if (!r.ok || !Array.isArray(r.mics)) return []
    return (r.mics as Array<Omit<WinMicInfo, 'kind'>>).map((m) => ({ ...m, kind: micKind(m.name) }))
  }

  /**
   * The agent's MicPort: run the fix the card named, then check it worked.
   *   unmute: unmute the mic of that kind · switch: unmute + make it the Windows default · volume: default mic to 80 %
   */
  async fix(fix: 'unmute' | 'switch' | 'volume', kind: MicKind): Promise<{ ok: boolean; text: string }> {
    if (!this.available) return { ok: false, text: 'Windows mic control is only available on Windows' }
    const mics = await this.list()
    const target = fix === 'volume' ? mics.find((m) => m.default) : (mics.find((m) => m.kind === kind && m.default) ?? mics.find((m) => m.kind === kind))
    if (!target) return { ok: false, text: `no ${kind} mic found in Windows` }
    const label = `${kind === 'headset' ? 'headset' : 'laptop'} mic "${target.name}"`
    if (fix === 'volume') await this.ask(`volume ${target.id} 0.8`)
    else {
      if (target.muted) await this.ask(`unmute ${target.id}`)
      if (fix === 'switch' && !target.default) await this.ask(`default ${target.id}`)
    }
    // Check: read Windows again.
    const after = (await this.list()).find((m) => m.id === target.id)
    if (!after) return { ok: false, text: `${label} disappeared` }
    if (fix === 'unmute') return after.muted ? { ok: false, text: `could not unmute ${label}` } : { ok: true, text: `${label} unmuted (checked)` }
    if (fix === 'volume')
      return after.volume >= 0.75
        ? { ok: true, text: `${label} volume raised to ${Math.round(after.volume * 100)} % (checked)` }
        : { ok: false, text: `could not raise the volume of ${label}` }
    return after.default && !after.muted
      ? { ok: true, text: `switched to ${label}, now the Windows default (checked)` }
      : { ok: false, text: `could not switch to ${label}` }
  }

  /**
   * Watch the Windows DEFAULT mic (every `everyMs`) and report it on every change: name, kind, muted, volume,
   * and the kind of another active mic if there is one (what "switch" could use).
   */
  watch(onChange: (mic: WinMicInfo & { otherKind?: MicKind }) => void, everyMs = 2000): void {
    if (!this.available || this.timer) return
    let last = ''
    const tick = async (): Promise<void> => {
      const mics = await this.list()
      const def = mics.find((m) => m.default)
      if (!def) return
      const other = mics.find((m) => !m.default && m.kind !== def.kind && !m.muted) ?? mics.find((m) => !m.default && !m.muted)
      const state = { ...def, volume: Math.round(def.volume * 100) / 100, ...(other ? { otherKind: other.kind } : {}) }
      const key = JSON.stringify(state)
      if (key === last) return
      last = key
      onChange(state)
    }
    void tick()
    this.timer = setInterval(() => void tick(), everyMs)
  }

  stop(): void {
    clearInterval(this.timer)
    this.proc?.kill()
    this.proc = null
  }
}
