/**
 * OWNER: C. Agent 4, the Monitor (checkup agent, doc §4). No LLM.
 * Watches every bus message and every action result. It can only make things SAFER:
 * template-only AI, screen flash instead of haptics, pausing the executor. It never starts user-facing actions
 * beyond LOG_ENTRY, COUNTERS and FLASH.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, TapEvent, UiCommand } from '../../shared/events.ts'
import { now as clock } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { BlockCategory, Reporter } from './agent.ts'
import { cleanText, MAX } from './sanitize.ts'

export const FEED_SILENT_S = 10
export const AI_BREAKER_FAILS = 2
export const AI_BREAKER_S = 60
export const HAPTIC_BREAKER_FAILS = 3
export const SPAM_MAX_ACTIONS = 5
export const SPAM_WINDOW_S = 10
export const SPAM_PAUSE_S = 5
const CHECKUP_EVERY_S = 30

/** The safety levers the Monitor may pull. */
export interface MonitorControls {
  llm: { hasKey: boolean; forceTemplateUntil(ts: number): void }
  executor: { pause(untilTs: number): void; hapticsOff(): void }
  haptics: { fire(w: 'knock'): Promise<boolean> }
}

type Feed = 'vision' | 'audio'

export class Monitor {
  readonly reporter: Reporter
  private counters = { aiCalls: 0, costUsd: 0, events: 0, blocked: 0 }
  private detail = { actions: 0, invalid: 0, allowlist: 0, provenance: 0, paused: 0, injectionFlagged: 0, fallbacks: 0 }
  private lastSeen: Record<Feed, number>
  private silentFlagged: Record<Feed, boolean> = { vision: false, audio: false }
  private aiFails = 0
  private aiBreakerUntil = 0
  private hapticFails = 0
  private hapticsOpen = false
  private recentActions: number[] = []
  private pausedUntil = 0
  private lastCheckup = ''
  private controls: MonitorControls | null = null
  private ui: (cmd: UiCommand) => void
  private now: () => number

  constructor(events: EventBus, bus: AgentBus, ui: (cmd: UiCommand) => void, opts: { now?: () => number } = {}) {
    this.ui = ui
    this.now = opts.now ?? clock
    this.lastSeen = { vision: this.now(), audio: this.now() }
    this.reporter = {
      log: (kind, text, costUsd) => this.log(kind, text, costUsd),
      blocked: (text, category) => {
        this.counters.blocked++
        this.detail[category]++
        this.log('blocked', text)
        this.pushCounters()
      },
      invalid: (reason) => this.reporter.blocked(`invalid message dropped: ${reason}`, 'invalid')
    }

    // Readable event log for judges.
    events.on('*', (e: TapEvent) => {
      this.counters.events++
      if (e.type !== 'MIC_LEVEL' && e.type !== 'TRANSCRIPT_PARTIAL') {
        const text = cleanText(e.data?.text, MAX.transcriptChunk)
        this.log('event', `${e.type}${text ? `: "${text}"` : ''}`)
      }
      this.pushCounters()
    })

    // Heartbeats.
    bus.on('vision', () => this.seen('vision'))
    bus.on('transcript', (e) => {
      this.seen('audio')
      if (e.payload.instructionLike) this.detail.injectionFlagged++
    })
    bus.on('mic', () => this.seen('audio'))
    bus.on('detector', () => this.seen('audio'))

    bus.on('summary', (e) => this.onSummary(e.payload))
    bus.on('action.result', (e) => this.onResult(e.payload))
  }

  /** Startup self-check (one log line), then the periodic checks. */
  start(controls: MonitorControls, opts: { timers?: boolean } = {}): void {
    this.controls = controls
    void this.selfCheck(controls)
    if (opts.timers === false) return
    setInterval(() => this.tick(), 1000).unref?.()
  }

  private async selfCheck(c: MonitorControls): Promise<void> {
    const parts = [
      existsSync(join(process.cwd(), '.env')) ? '.env loaded' : 'no .env (defaults)',
      c.llm.hasKey ? 'AI key present' : 'no AI key → template mode'
    ]
    if (process.env.TAP_SELFTEST_HAPTIC === '1') {
      parts.push((await c.haptics.fire('knock')) ? 'HapticWeb reachable' : 'HapticWeb NOT reachable (check the hosts file: 127.0.0.1 local.jmw.nz)')
    } else {
      parts.push('haptics not tested (set TAP_SELFTEST_HAPTIC=1)')
    }
    parts.push(`watching vision and audio feeds (alert after ${FEED_SILENT_S} s of silence)`)
    this.log('decision', `Self-check: ${parts.join(' · ')}`)
  }

  /** Once a second: feed heartbeats, AI breaker retry, periodic checkup line. */
  tick(): void {
    const t = this.now()
    for (const feed of ['vision', 'audio'] as const) {
      const silent = t - this.lastSeen[feed]
      if (silent > FEED_SILENT_S && !this.silentFlagged[feed]) {
        this.silentFlagged[feed] = true
        this.log('error', `${feed === 'vision' ? 'Vision' : 'Audio'} feed silent ${Math.round(silent)} s`)
      }
    }
    if (this.aiBreakerUntil && t >= this.aiBreakerUntil) {
      this.aiBreakerUntil = 0
      this.aiFails = 0
      this.log('decision', 'AI breaker closed → cloud summaries retried')
    }
    if (Math.floor(t) % CHECKUP_EVERY_S === 0) this.checkup()
  }

  private seen(feed: Feed): void {
    this.lastSeen[feed] = this.now()
    if (this.silentFlagged[feed]) {
      this.silentFlagged[feed] = false
      this.log('decision', `${feed === 'vision' ? 'Vision' : 'Audio'} feed back`)
    }
  }

  private onSummary(r: { costUsd: number; usedLlm: boolean; fallback?: string }): void {
    if (r.usedLlm || r.costUsd > 0) {
      this.counters.aiCalls++
      this.counters.costUsd += r.costUsd
    }
    if (r.fallback && r.fallback !== 'empty') this.detail.fallbacks++
    if (r.usedLlm) this.aiFails = 0
    else if (r.fallback === 'timeout' || r.fallback === 'error' || r.fallback === 'invalid') {
      this.aiFails++
      if (this.aiFails >= AI_BREAKER_FAILS && !this.aiBreakerUntil) {
        this.aiBreakerUntil = this.now() + AI_BREAKER_S
        this.controls?.llm.forceTemplateUntil(this.aiBreakerUntil)
        this.log('error', `AI breaker open: ${this.aiFails} failures in a row → template summaries for ${AI_BREAKER_S} s`)
      }
    }
    this.pushCounters()
  }

  private onResult(r: { action: string; ok: boolean }): void {
    const t = this.now()
    this.detail.actions++
    if (r.action === 'send_haptic') {
      this.hapticFails = r.ok ? 0 : this.hapticFails + 1
      if (this.hapticFails >= HAPTIC_BREAKER_FAILS && !this.hapticsOpen) {
        this.hapticsOpen = true
        this.controls?.executor.hapticsOff()
        this.log(
          'error',
          `Haptics breaker open: ${this.hapticFails} failed calls → screen flash instead. Hint: add "127.0.0.1 local.jmw.nz" to the hosts file and check HapticWeb is running`
        )
      }
    }
    // Spam guard: more than 5 actions in 10 s → pause the executor for 5 s.
    this.recentActions = [...this.recentActions.filter((x) => t - x < SPAM_WINDOW_S), t]
    if (this.recentActions.length > SPAM_MAX_ACTIONS && t >= this.pausedUntil) {
      this.pausedUntil = t + SPAM_PAUSE_S
      this.recentActions = []
      this.controls?.executor.pause(this.pausedUntil)
      this.log('error', `Spam guard: more than ${SPAM_MAX_ACTIONS} actions in ${SPAM_WINDOW_S} s → executor paused ${SPAM_PAUSE_S} s`)
    }
  }

  /** The counter breakdown that does not fit the COUNTERS command, logged when it changed. */
  checkup(): void {
    const d = this.detail
    const line =
      `Checkup: ${d.actions} actions · ${this.counters.blocked} blocked (invalid ${d.invalid}, allowlist ${d.allowlist}, ` +
      `provenance ${d.provenance}, paused ${d.paused}) · ${d.injectionFlagged} instruction-like speech · ` +
      `${d.fallbacks} AI fallbacks · AI $${this.counters.costUsd.toFixed(4)}`
    if (line === this.lastCheckup) return
    this.lastCheckup = line
    this.log('decision', line)
  }

  private log(kind: LogEntry['kind'], text: string, costUsd?: number): void {
    this.ui({ type: 'LOG_ENTRY', entry: { ts: this.now(), kind, text, costUsd } })
  }

  private pushCounters(): void {
    this.ui({ type: 'COUNTERS', ...this.counters })
  }
}

