/**
 * OWNER: C. Agent 4, the checkup agent (doc §4). No LLM.
 * Its job: say, in plain log lines, whether every device works (camera, mic, call audio, AI).
 * It also watches every action result, and can only make things SAFER: template-only AI, screen flash instead of
 * haptics, pausing the executor. It never starts user-facing actions beyond LOG_ENTRY, COUNTERS and FLASH.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, TapEvent, UiCommand } from '../../shared/events.ts'
import { now as clock } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import { z } from 'zod'
import { cleanText, MAX } from './sanitize.ts'
import { RawTapEvent } from './schemas.ts'

export type Feed = 'camera' | 'mic' | 'callAudio'

/**
 * How long each feed may stay silent before the checkup flags it. Call audio is only transcribed speech,
 * so a quiet moment in the call is normal: it gets a longer limit.
 */
export const FEED_SILENT_S: Record<Feed, number> = { camera: 10, mic: 10, callAudio: 60 }
const FEED_NAME: Record<Feed, string> = { camera: 'Camera', mic: 'Mic', callAudio: 'Call audio' }
export const MIC_SILENT_RMS = 0.01 // TODO(B): tune on real headsets
export const MIC_SILENT_AFTER_S = 2
const MIC_LEVEL_STALE_S = 1.5 // mic levels come every ~250 ms while the mic is monitored
export const PROBLEM_COOLDOWN_S = 30 // the same device problem is logged at most once per 30 s
export const AI_BREAKER_FAILS = 2
export const AI_BREAKER_S = 60
export const HAPTIC_BREAKER_FAILS = 3
export const SPAM_MAX_ACTIONS = 5
export const SPAM_WINDOW_S = 10
export const SPAM_PAUSE_S = 5
const CHECKUP_EVERY_S = 30

/** B's measurement events (events.ts). Parsed here, never trusted as typed. Extra fields from B are allowed. */
const MicQuality = z.object({ level: z.enum(['ok', 'too_quiet', 'clipping', 'noisy']) })
const SttUsage = z.object({ engine: z.string().max(40), cost_usd: z.number().finite().nonnegative() })
const MIC_QUALITY_TEXT = { too_quiet: 'too quiet', clipping: 'clipping (too loud)', noisy: 'noisy' } as const

/** The safety levers the checkup agent may pull. */
export interface MonitorControls {
  llm: { hasKey: boolean; forceTemplateUntil(ts: number): void }
  executor: { pause(untilTs: number): void; hapticsOff(): void }
  haptics: { fire(w: 'knock'): Promise<boolean> }
}

export class Monitor {
  readonly reporter: Reporter
  private counters = { aiCalls: 0, costUsd: 0, events: 0, blocked: 0 }
  private detail = { actions: 0, invalid: 0, allowlist: 0, provenance: 0, paused: 0, injectionFlagged: 0, fallbacks: 0, deviceProblems: 0 }
  private lastSeen: Record<Feed, number>
  private silentFlagged: Record<Feed, boolean> = { camera: false, mic: false, callAudio: false }
  private lastProblem = new Map<string, number>()
  private mouthActive = false
  private lastMicLoud: number
  private lastMicLevelAt = -Infinity // when the last mic level arrived: none → mic not monitored → no alert
  private micQualityBad = false
  private sttCost = new Map<string, number>()
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
    this.lastSeen = { camera: this.now(), mic: this.now(), callAudio: this.now() }
    this.lastMicLoud = this.now()
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

    // B measures, the checkup decides: mic quality is a device problem; speech-to-text cost joins the AI cost.
    events.on('MIC_QUALITY', (e) => this.onMicQuality(e))
    events.on('STT_USAGE', (e) => this.onSttUsage(e))

    // Readable event log for judges.
    events.on('*', (e: TapEvent) => {
      this.counters.events++
      if (e.type !== 'MIC_LEVEL' && e.type !== 'TRANSCRIPT_PARTIAL' && e.type !== 'STT_USAGE') {
        const text = cleanText(e.data?.text, MAX.transcriptChunk)
        this.log('event', `${e.type}${text ? `: "${text}"` : ''}`)
      }
      this.pushCounters()
    })

    // Device health: a heartbeat per feed, plus the problems each feed reports.
    bus.on('vision', (e) => {
      this.seen('camera')
      this.onCamera(e.payload)
    })
    bus.on('mic', (e) => {
      this.seen('mic')
      this.lastMicLevelAt = this.now()
      if (e.payload.rms > MIC_SILENT_RMS) this.lastMicLoud = this.now()
      this.checkMicSilent()
    })
    bus.on('transcript', (e) => {
      this.seen('callAudio')
      if (e.payload.instructionLike) this.detail.injectionFlagged++
    })
    bus.on('detector', (e) => {
      this.seen('callAudio')
      if (e.payload.type === 'OTHERS_CANT_HEAR') this.problem('cant_hear', "Someone in the call said they can't hear you → check your mic")
      if (e.payload.type === 'VIDEO_FROZEN_REPORTED') this.problem('video_reported', 'Someone in the call said your video is frozen → check your camera')
    })

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
    }
    parts.push(`watching camera and mic (alert after ${FEED_SILENT_S.camera} s of silence) and call audio (after ${FEED_SILENT_S.callAudio} s)`)
    this.log('decision', `Self-check: ${parts.join(' · ')}`)
  }

  /** Once a second: feed heartbeats, mic check, AI breaker retry, periodic checkup line. */
  tick(): void {
    const t = this.now()
    for (const feed of ['camera', 'mic', 'callAudio'] as const) {
      const silent = t - this.lastSeen[feed]
      if (silent > FEED_SILENT_S[feed] && !this.silentFlagged[feed]) {
        this.silentFlagged[feed] = true
        this.log('error', `${FEED_NAME[feed]} feed silent ${Math.floor(silent)} s → check that it is connected and started`)
      }
    }
    this.checkMicSilent()
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
      this.log('decision', `${FEED_NAME[feed]} feed back`)
    }
  }

  private onCamera(v: { signal: string; active?: boolean }): void {
    if (v.signal === 'mouth') {
      this.mouthActive = v.active === true
      this.checkMicSilent()
    } else if (v.signal === 'camera_frozen') this.problem('camera_frozen', 'Camera image is frozen → check the webcam')
    else if (v.signal === 'face_out_of_frame') this.problem('face_out', "Face out of frame → Tap can't tell whether you are paying attention")
    else if (v.signal === 'low_light') this.problem('low_light', 'Room too dark for the camera → attention detection may fail')
  }

  /**
   * Mouth moving but the mic has sent nothing loud for 2 s: the user is probably talking into a muted mic.
   * Only while mic levels are arriving (B's fix: without "Start mic", Tap knows nothing about the mic, so no alert;
   * the "Mic feed silent" line covers that case).
   */
  private checkMicSilent(): void {
    const t = this.now()
    if (t - this.lastMicLevelAt > MIC_LEVEL_STALE_S) return
    if (this.mouthActive && t - this.lastMicLoud >= MIC_SILENT_AFTER_S)
      this.problem('mic_silent', 'Mouth moving but the mic sends nothing → check that your mic is not muted')
  }

  /** B's MIC_QUALITY: too quiet / clipping / noisy is a device problem; back to ok is logged once. */
  private onMicQuality(e: TapEvent): void {
    const q = MicQuality.safeParse(RawTapEvent.safeParse(e).data?.data)
    if (!q.success) return this.reporter.invalid('MIC_QUALITY with a bad shape')
    if (q.data.level === 'ok') {
      if (this.micQualityBad) this.log('decision', 'Mic quality back to ok')
      this.micQualityBad = false
      return
    }
    this.micQualityBad = true
    this.problem(`mic_${q.data.level}`, `Mic quality: ${MIC_QUALITY_TEXT[q.data.level]} → check your mic, or switch to the laptop mic`)
  }

  /** B's STT_USAGE carries the speech-to-text cost since start, per engine: add only what is new. */
  private onSttUsage(e: TapEvent): void {
    const u = SttUsage.safeParse(RawTapEvent.safeParse(e).data?.data)
    if (!u.success) return this.reporter.invalid('STT_USAGE with a bad shape')
    const before = this.sttCost.get(u.data.engine) ?? 0
    this.sttCost.set(u.data.engine, u.data.cost_usd)
    this.counters.costUsd += Math.max(0, u.data.cost_usd - before)
    this.pushCounters()
  }

  /** Log a device problem, at most once per PROBLEM_COOLDOWN_S for the same problem. */
  private problem(key: string, text: string): void {
    const t = this.now()
    if (t - (this.lastProblem.get(key) ?? -Infinity) < PROBLEM_COOLDOWN_S) return
    this.lastProblem.set(key, t)
    this.detail.deviceProblems++
    this.log('error', text)
  }

  private onSummary(r: { costUsd: number; usedLlm: boolean; fallback?: string }): void {
    if (r.usedLlm || r.costUsd > 0) {
      this.counters.aiCalls++
      this.counters.costUsd += r.costUsd
    }
    if (r.fallback && r.fallback !== 'empty' && r.fallback !== 'short') this.detail.fallbacks++ // only real AI fallbacks
    if (r.usedLlm) this.aiFails = 0
    else if (r.fallback === 'timeout' || r.fallback === 'auth' || r.fallback === 'error' || r.fallback === 'invalid') {
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
    // Spam guard: more than 5 actions in 10 s (e.g. vision flapping away/back) → pause automatic actions 5 s.
    // This also caps paid AI calls, since every recap may call the AI.
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
    const cost = this.counters.costUsd.toFixed(4)
    const line =
      `Checkup: ${d.actions} actions · ${this.counters.blocked} blocked (invalid ${d.invalid}, allowlist ${d.allowlist}, ` +
      `provenance ${d.provenance}, paused ${d.paused}) · ${d.injectionFlagged} instruction-like speech · ` +
      `${d.deviceProblems} device problems · ${d.fallbacks} AI fallbacks · AI cost ${cost} USD`
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
