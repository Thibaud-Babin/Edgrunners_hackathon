/**
 * OWNER: C. The agent: listens to all events, decides, and acts through the allowlist.
 *
 * Rule S-1 (PRD §7): transcript text goes to DETECTORS and SUMMARIES only.
 * The executor is only ever called from USER_* handlers (the user's own clicks/gestures).
 */
import type { AllowedAction, LogEntry, TapEvent, UiCommand, Waveform } from '../../shared/events'
import { ALLOWED_ACTIONS, HAPTIC, now } from '../../shared/events'
import type { EventBus } from '../bus'
import type { Haptics } from '../haptics'
import type { Llm } from './llm'

interface Line {
  ts: number
  text: string
}

const RECAP_WINDOW_S = 10
const AWAY_MIN_S = 2 // ignore glances shorter than this
const MIC_SILENT_RMS = 0.01 // TODO(B): tune on real headsets
const MIC_SILENT_AFTER_S = 2
const MIC_ALERT_COOLDOWN_S = 15

export class Agent {
  private transcript: Line[] = []
  private speakers = new Set<string>()
  private awayFrom: number | null = null
  private lastMicLoud = now()
  private lastMicLevelAt = 0 // when we last got a MIC_LEVEL: no mic monitoring → no mic-silent alert
  private mouthActive = false
  private lastMicAlert = 0
  private counters = { aiCalls: 0, costUsd: 0, events: 0, blocked: 0 }
  private cardSeq = 0
  /** Name heard; the card waits for the end of the sentence (next final transcript) so it includes the question. */
  private pendingAddress: { e: TapEvent; timer: ReturnType<typeof setTimeout> } | null = null

  constructor(
    bus: EventBus,
    private ui: (cmd: UiCommand) => void,
    private haptics: Haptics,
    private llm: Llm,
    private userName: string
  ) {
    bus.on('*', (e) => this.onAny(e))
    bus.on('TRANSCRIPT_FINAL', (e) => this.onTranscript(e))
    bus.on('NAME_MENTIONED', (e) => void this.onName(e))
    bus.on('USER_AWAY', (e) => this.onAway(e))
    bus.on('USER_BACK', () => void this.onBack())
    bus.on('MIC_LEVEL', (e) => this.onMicLevel(e))
    bus.on('MOUTH_MOVING', (e) => this.onMouth(e))
    bus.on('OTHERS_CANT_HEAR', (e) => this.onOthersCantHear(e))
    bus.on('GESTURE_NOD', () => this.gestureSeen('nod'))
    bus.on('GESTURE_SHAKE', () => this.gestureSeen('shake'))
    bus.on('GESTURE_BROW_RAISE', () => this.gestureSeen('eyebrow raise'))
    bus.on('USER_CLICK', (e) => this.onUserClick(e))
    // ---- added by B (Sat evening). C: move these into the executor during the split. ----
    bus.on('WAITING_FOR_YOU', (e) => void this.onWaiting(e))
    bus.on('TOPIC_MENTIONED', (e) => void this.onTopic(e))
    bus.on('INSTRUCTION_LIKE_SPEECH', (e) => this.onInstructionLike(e))
    bus.on('MIC_QUALITY', (e) => this.onMicQuality(e))
    bus.on('STT_USAGE', (e) => this.onSttUsage(e))
  }

  // ---------- senses ----------

  private onAny(e: TapEvent): void {
    this.counters.events++
    if (e.type !== 'MIC_LEVEL' && e.type !== 'TRANSCRIPT_PARTIAL' && e.type !== 'STT_USAGE') this.log('event', `${e.type}${e.data?.text ? `: "${e.data.text}"` : ''}`)
    this.pushCounters()
  }

  private onTranscript(e: TapEvent): void {
    if (e.source !== 'call_audio') return
    // Speaker labels (Deepgram diarization) let the summary say who asked: "Speaker 2: so Thibaud, OK with Friday?"
    // Labels only once 2+ voices were heard: with one voice "Speaker 1 is discussing…" just adds noise.
    if (e.data?.speaker) this.speakers.add(String(e.data.speaker))
    const who = e.data?.speaker && this.speakers.size >= 2 ? `${String(e.data.speaker)}: ` : ''
    this.transcript.push({ ts: e.ts, text: who + String(e.data?.text ?? '') })
    const cutoff = now() - 30 * 60 // keep 30 min
    this.transcript = this.transcript.filter((l) => l.ts >= cutoff)
    if (this.pendingAddress) this.flushAddress()
  }

  private textSince(ts: number): string {
    return this.transcript
      .filter((l) => l.ts >= ts)
      .map((l) => l.text)
      .join('\n')
  }

  /**
   * P0-1 / P0-2 / P0-3: name said → knock NOW (may come from a partial transcript),
   * then when the sentence ends (or after 4 s): recap, or "while you were away" if the user was away.
   */
  private async onName(e: TapEvent): Promise<void> {
    if (this.pendingAddress) return // same sentence
    this.pendingAddress = { e, timer: setTimeout(() => this.flushAddress(), 4000) }
    await this.haptic(HAPTIC.addressed)
    if (typeof e.data?.latency_s === 'number')
      this.log('decision', `knock ${e.data.latency_s} s after ${e.data.latency_ref === 'name_word' ? 'your name was said' : 'the sentence started'}`)
    // Dev text box / mock send final lines: the transcript is already there.
    if (!e.data?.partial) this.flushAddress()
  }

  private flushAddress(): void {
    const p = this.pendingAddress
    if (!p) return
    clearTimeout(p.timer)
    this.pendingAddress = null
    if (this.awayFrom !== null && now() - this.awayFrom >= AWAY_MIN_S) void this.awaySummary('name')
    else void this.recap(p.e)
  }

  private async recap(e: TapEvent): Promise<void> {
    const text = this.textSince(e.ts - RECAP_WINDOW_S) || String(e.data?.text ?? '')
    const s = await this.summarise(text)
    this.ui({ type: 'SHOW_RECAP', id: this.cardId(), transcript: text, summary: s.summary, question: s.question })
    this.log('action', 'show_recap')
  }

  private onAway(e: TapEvent): void {
    if (this.awayFrom === null) this.awayFrom = e.ts
  }

  private async onBack(): Promise<void> {
    if (this.awayFrom === null) return
    if (now() - this.awayFrom >= AWAY_MIN_S && this.textSince(this.awayFrom)) await this.awaySummary('looked_back')
    this.awayFrom = null
  }

  /** P0-3: synthesis of everything said from the moment the user turned away until now. */
  private async awaySummary(trigger: 'name' | 'looked_back'): Promise<void> {
    const from = this.awayFrom ?? now()
    const until = now()
    const text = this.textSince(from)
    const s = await this.summarise(text)
    this.ui({
      type: 'SHOW_AWAY_SUMMARY',
      id: this.cardId(),
      away_from: from,
      until,
      trigger,
      summary: s.summary,
      question_to_you: s.question,
      transcript: text
    })
    this.log('action', `show_away_summary (${Math.round(until - from)} s away, trigger: ${trigger})`)
    this.awayFrom = null
  }

  /** P0-4: mouth moving + mic silent for ≥ 2 s. */
  private onMicLevel(e: TapEvent): void {
    const rms = Number(e.data?.rms ?? 0)
    this.lastMicLevelAt = e.ts
    if (rms > MIC_SILENT_RMS) this.lastMicLoud = e.ts
    this.checkMicSilent()
  }

  private onMouth(e: TapEvent): void {
    this.mouthActive = Boolean(e.data?.active)
    this.checkMicSilent()
  }

  private checkMicSilent(): void {
    const t = now()
    if (t - this.lastMicLevelAt > 1.5) return // mic not monitored ("Start mic" not clicked): we know nothing
    if (!this.mouthActive || t - this.lastMicLoud < MIC_SILENT_AFTER_S || t - this.lastMicAlert < MIC_ALERT_COOLDOWN_S) return
    this.lastMicAlert = t
    this.log('decision', 'mouth moving but mic sends nothing → MIC_SILENT_WHILE_SPEAKING')
    void this.haptic(HAPTIC.problem)
    this.ui({ type: 'SHOW_FIX', id: this.cardId(), problem: 'Your mic sends nothing', fix_label: 'Switch to laptop mic', action_id: 'switch_input_device' })
  }

  /** P1-2: others say they can't hear you. */
  private onOthersCantHear(e: TapEvent): void {
    void this.haptic(HAPTIC.problem)
    this.ui({ type: 'SHOW_FIX', id: this.cardId(), problem: `Someone said: "${e.data?.text}"`, fix_label: 'Switch to laptop mic', action_id: 'switch_input_device' })
  }

  private gestureSeen(name: string): void {
    void this.haptic(HAPTIC.gestureSeen)
    this.log('decision', `gesture recognised: ${name}`)
    // TODO(C, P1-1): map nod → "Yes" / shake → "No" / eyebrow → raise hand via execute()
  }

  // ---------- added by B (Sat evening) ----------

  /** A question to you, then silence: they're waiting for your answer → "knock knock" + nudge card. */
  private async onWaiting(e: TapEvent): Promise<void> {
    this.log('decision', `${e.data?.silent_s ?? '?'} s of silence after a question to you → nudge`)
    this.ui({ type: 'SHOW_NUDGE', id: this.cardId(), text: "They're waiting for your answer", question: String(e.data?.question ?? '') })
    await this.haptic(HAPTIC.waiting)
    await new Promise((r) => setTimeout(r, 250))
    await this.haptic(HAPTIC.waiting)
  }

  private async onTopic(e: TapEvent): Promise<void> {
    this.log('decision', `topic "${e.data?.topic}" mentioned → soft heads-up`)
    await this.haptic(HAPTIC.topic)
  }

  /** PRD S-1: speech never triggers actions. We only log that we noticed (demo beat: injection attempt). */
  private onInstructionLike(e: TapEvent): void {
    this.counters.blocked++
    this.log('blocked', `instruction-like speech ignored (speech can't trigger actions): "${e.data?.text}"`)
    this.pushCounters()
  }

  /** B measures, C decides. For now: log it. TODO(C): offer the laptop mic when level stays bad. */
  private onMicQuality(e: TapEvent): void {
    const level = String(e.data?.level ?? '')
    if (level === 'ok') this.log('decision', 'mic quality back to ok')
    else this.log('decision', `mic quality: ${level.replace('_', ' ')} (speech ${e.data?.speech_rms}, noise ${e.data?.noise_rms}, clipped ${e.data?.clipped_pct} %)`)
  }

  private sttCostUsd = 0
  /** Speech-to-text cost goes into the same counter as the LLM (AXA: frugality, every cent visible). */
  private onSttUsage(e: TapEvent): void {
    const cost = Number(e.data?.cost_usd ?? 0)
    this.counters.costUsd += cost - this.sttCostUsd
    this.sttCostUsd = cost
    this.pushCounters()
  }

  // ---------- executor (allowlist) ----------

  private onUserClick(e: TapEvent): void {
    const action = String(e.data?.action_id ?? '')
    this.execute(action, (e.data?.args as Record<string, unknown>) ?? {})
  }

  /** Only reachable from USER_* events. */
  execute(action: string, args: Record<string, unknown>): void {
    if (!(ALLOWED_ACTIONS as readonly string[]).includes(action)) {
      this.counters.blocked++
      this.log('blocked', `action "${action}" is not on the allowlist`)
      this.pushCounters()
      return
    }
    const a = action as AllowedAction
    switch (a) {
      case 'switch_input_device':
        // The main window restarts the mic on another device (renderer/src/main.ts → audio.ts).
        this.ui({ type: 'SWITCH_MIC', prefer: 'laptop' })
        this.log('action', 'switch_input_device → laptop mic')
        void this.haptic(HAPTIC.done)
        break
      case 'dismiss_card':
        this.ui({ type: 'DISMISS', id: String(args.id ?? '') })
        break
      default:
        this.log('action', `${a} (not implemented yet)`)
    }
  }

  // ---------- helpers ----------

  private async summarise(text: string) {
    const s = await this.llm.summarise(text, this.userName)
    if (s.usedLlm) {
      this.counters.aiCalls++
      this.counters.costUsd += s.costUsd
      this.log('llm', `summary (${text.length} chars)`, s.costUsd)
      this.pushCounters()
    }
    return s
  }

  private async haptic(w: Waveform): Promise<void> {
    const ok = await this.haptics.fire(w)
    this.log('action', `send_haptic ${w}${ok ? '' : ' (failed → screen flash)'}`)
    if (!ok) this.ui({ type: 'FLASH', reason: w })
  }

  private log(kind: LogEntry['kind'], text: string, costUsd?: number): void {
    this.ui({ type: 'LOG_ENTRY', entry: { ts: now(), kind, text, costUsd } })
  }

  private pushCounters(): void {
    this.ui({ type: 'COUNTERS', ...this.counters })
  }

  private cardId(): string {
    return `card-${++this.cardSeq}`
  }
}
