/**
 * OWNER: B. Windows microphones, at the SYSTEM level (what Meet, Teams and Tap all hear).
 * Runs scripts/win-mic.ps1 once (Windows Core Audio through PowerShell, nothing to install) and talks to it
 * over stdin/stdout. It can:
 *  - list the mics with their kind (headset / laptop), Windows mute state and which one is the default;
 *  - unmute a mic and make it the Windows default ("Switch to laptop mic" on a fix card).
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
  private lastMuted = new Map<string, boolean>()
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
   * The fix-card click: unmute the preferred kind of mic and make it the Windows default.
   * Falls back to any other mic when there is none of that kind. Returns what was done, for the activity log.
   */
  async useMic(prefer: MicKind): Promise<{ ok: boolean; text: string }> {
    if (!this.available) return { ok: false, text: 'Windows mic control is only available on Windows' }
    const mics = await this.list()
    if (!mics.length) return { ok: false, text: 'No microphone found in Windows' }
    const target = mics.find((m) => m.kind === prefer) ?? mics.find((m) => !m.default) ?? mics[0]
    const steps: string[] = []
    if (target.muted) {
      const u = await this.ask(`unmute ${target.id}`)
      steps.push(u.ok ? 'unmuted' : `could not unmute (${String(u.error ?? 'error')})`)
    } else steps.push('was not muted')
    if (!target.default) {
      const d = await this.ask(`default ${target.id}`)
      steps.push(d.ok ? 'set as the Windows default mic' : `could not set as default (${String(d.error ?? 'error')})`)
    } else steps.push('already the default mic')
    const ok = !steps.some((s) => s.startsWith('could not'))
    return { ok, text: `${target.kind === 'headset' ? 'Headset' : 'Laptop'} mic "${target.name}": ${steps.join(', ')}` }
  }

  /** Watch Windows mute changes (every `everyMs`): calls onChange when a mic gets muted or unmuted. */
  watch(onChange: (mic: WinMicInfo) => void, everyMs = 3000): void {
    if (!this.available || this.timer) return
    const tick = async (): Promise<void> => {
      for (const m of await this.list()) {
        const before = this.lastMuted.get(m.id)
        this.lastMuted.set(m.id, m.muted)
        if (before !== undefined && before !== m.muted) onChange(m)
        else if (before === undefined && m.muted) onChange(m) // already muted when Tap started
      }
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
