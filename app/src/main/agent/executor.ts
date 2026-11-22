/**
 * OWNER: C. Agent 3, the Executor: rules → gate → act. No LLM.
 * It is the only agent that changes anything the user sees, hears or feels.
 * Gate (in order): schema/allowlist → provenance → user-only actions. Speech and AI output never trigger an action.
 */
import type { TapEvent, UiCommand, Waveform } from '../../shared/events.ts'
import { now } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import type { Diagnostics } from './monitor.ts'
import { ACTION_TIER, denyReason, permission, RoleState, type UserRole } from './permissions.ts'
import { decide, initialState, type RulesState } from './rules.ts'
import { ActionRequest, type Envelope, type PayloadOf, type Provenance, RawTapEvent } from './schemas.ts'
import { cleanText } from './sanitize.ts'
import { ticketReason } from './it-stats.ts'

/** B: an automatic ticket waits this long so the user can undo it, and the same problem is sent once a day at most. */
export const AUTO_TICKET_DELAY_S = 10
export const AUTO_TICKET_DEDUPE_S = 24 * 3600

/** What the executor needs from haptics.ts (an interface, so tests can fake it). */
export interface HapticsPort {
  fire(w: Waveform): Promise<boolean>
}

/**
 * The user's own microphone at the Windows level (B's audio/win-mic.ts), so Meet hears the fix too.
 * `fix` does it AND checks it worked; `text` says what happened, for the log.
 */
export interface MicPort {
  fix(fix: 'unmute' | 'switch' | 'volume', mic: 'laptop' | 'headset'): Promise<{ ok: boolean; text: string }>
}

/** An IT ticket: device facts only. No transcript, no names (not even the mic's device name, which can hold one). */
export interface ItTicket {
  id: string
  createdAt: string
  priority: 'normal' | 'priority'
  requesterRole: string
  diagnostics: Diagnostics | null
  mic: { kind: 'laptop' | 'headset'; muted: boolean; volume: number; otherKind?: 'laptop' | 'headset' } | null
  /** B: why it was sent (e.g. "the one-click fix failed") and whether Tap sent it by itself */
  reason?: string
  automatic?: boolean
}

/** Where tickets go: a simulated helpdesk (index.ts writes JSON files). Returns where it was stored. */
export interface TicketPort {
  send(ticket: ItTicket): Promise<{ ok: boolean; where: string }>
}

/**
 * End of call: the call's device health report for the IT log. Device facts only, like a ticket.
 * Priority: no problem → log only · problems → priority · problems for an executive/CEO → urgent.
 */
export interface CallReport {
  id: string
  endedAt: string
  priority: 'log' | 'priority' | 'urgent'
  requesterRole: string
  diagnostics: Diagnostics | null
  mic: ItTicket['mic']
}

export interface ExecutorPorts {
  tickets?: TicketPort
  /** The IT log (simulated: index.ts appends JSON lines). */
  itLog?: { add(report: CallReport): Promise<{ ok: boolean; where: string }> }
  diagnostics?: () => Diagnostics
  /** Start a new call in the checkup after the report (problems, fixes, duration). */
  resetCall?: () => void
}

type SummaryResult = PayloadOf<'summary'>
export type Verdict =
  | { verdict: 'run'; req: ActionRequest }
  | { verdict: 'block'; reason: string; category: 'allowlist' | 'provenance' | 'permission' }

const SUMMARY_WAIT_MS = 5000 // the LLM itself gives up after 3 s; this only guards against a lost reply
// shortcut: slices by when B published each line, plus this grace for the STT delay; switch to B's start/end
// timestamps when that contract change lands (docs/team/C-agent-haptics.md §6).
export const STT_GRACE_MS = 1500
export const SENTENCE_END_MAX_MS = 4000 // name heard mid-sentence: wait at most this long for the sentence to end

/**
 * Which inputs may start an action. Policy as data, in one place, deterministic: never decided by an LLM.
 */
export const MAY_TRIGGER: Record<Provenance, boolean> = {
  user: true,
  vision: true,
  detector: true,
  system: true,
  transcript: false, // speech is quoted data, never a command
  llm: false // AI output is display-only
}

/**
 * Pure gate: (1) schema + allowlist, (2) provenance, (3) role × tier (permissions.ts).
 * "click" actions run only from the user's own click (provenance `user`), e.g. your own devices and data at any
 * rank. Missing role → intern (least privilege).
 */
export function gate(req: unknown, provenance: Provenance, role: UserRole = 'intern'): Verdict {
  const parsed = ActionRequest.safeParse(req)
  if (!parsed.success) return { verdict: 'block', reason: 'not a valid, allowlisted action', category: 'allowlist' }
  if (!MAY_TRIGGER[provenance]) return { verdict: 'block', reason: "speech and AI output can't trigger actions", category: 'provenance' }
  const p = permission(role, parsed.data.action)
  if (p === 'deny') return { verdict: 'block', reason: denyReason(role, parsed.data.action), category: 'permission' }
  if (p === 'click' && provenance !== 'user') {
    const reason = ACTION_TIER[parsed.data.action] === 1 ? 'only your own click can change your devices' : 'only your own click can do this'
    return { verdict: 'block', reason, category: 'provenance' }
  }
  return { verdict: 'run', req: parsed.data }
}

export class Executor {
  private state: RulesState = initialState()
  private cardSeq = 0
  private reqSeq = 0
  private pending = new Map<string, (r: SummaryResult | null) => void>()
  /** When the last final transcript line arrived, and who waits for the next one (end of a sentence). */
  private lastLineAt = 0
  /** B: when the last partial (unfinished) call sentence arrived: someone is mid-sentence. Time only, no text. */
  private lastPartialAt = 0
  private lineWaiters: (() => void)[] = []
  private bus: AgentBus
  private ui: (cmd: UiCommand) => void
  private haptics: HapticsPort
  private report: Reporter
  private pausedUntil = 0
  private hapticsDisabled = false
  private mic: MicPort | null
  private roles: RoleState
  private ports: ExecutorPorts
  private ticketSeq = 0
  /** B: automatic tickets waiting for their 10 s (card id → timer), and the last one sent per problem (key → when, id) */
  private autoPending = new Map<string, ReturnType<typeof setTimeout>>()
  private autoLast = new Map<string, { at: number; id: string }>()
  private lastTicketId = ''
  private reportSeq = 0

  constructor(
    events: EventBus,
    bus: AgentBus,
    ui: (cmd: UiCommand) => void,
    haptics: HapticsPort,
    report: Reporter,
    mic: MicPort | null = null,
    roles: RoleState = new RoleState(),
    ports: ExecutorPorts = {}
  ) {
    this.mic = mic
    this.roles = roles
    this.ports = ports
    this.bus = bus
    this.ui = ui
    this.haptics = haptics
    this.report = report
    events.on('USER_CLICK', (e) => this.onClick(e))
    events.on('CALL_ENDED', (e) => this.onCallEnded(e))
    bus.on('vision', (e) => this.handle(e))
    bus.on('detector', (e) => this.handle(e))
    bus.on('user', (e) => this.handle(e))
    bus.on('mic', (e) => this.handle(e)) // the clock for the rules' mic-quality timer
    // A transcript line only marks the end of a sentence: it never reaches the rules and never triggers anything.
    events.on('TRANSCRIPT_PARTIAL', (e) => {
      if (e.source === 'call_audio') this.lastPartialAt = now()
    })
    bus.on('transcript', () => {
      this.lastLineAt = now()
      for (const w of this.lineWaiters.splice(0)) w()
    })
    bus.on('summary', (e) => {
      const done = this.pending.get(e.payload.requestId)
      this.pending.delete(e.payload.requestId)
      done?.(e.payload)
    })
  }

  /** D's "End call" button (the user's own click): the call's device health report goes to the IT log. */
  private onCallEnded(e: TapEvent): void {
    const raw = RawTapEvent.safeParse(e)
    if (!raw.success || raw.data.source !== 'ui') return this.report.invalid('CALL_ENDED with a bad shape or source')
    void this.run([{ action: 'send_call_report', why: 'you ended the call' }], 'user', now())
  }

  /** Intake for D's clicks: the user's own deliberate input. */
  private onClick(e: TapEvent): void {
    const raw = RawTapEvent.safeParse(e)
    if (!raw.success || raw.data.source !== 'ui') return this.report.invalid('USER_CLICK with a bad shape or source')
    const args = raw.data.data?.args
    const cardId = args && typeof args === 'object' ? (args as Record<string, unknown>).id : undefined
    this.bus.publish('user', 'user', 'user', {
      input: 'click',
      actionId: cleanText(raw.data.data?.action_id, 64),
      ...(typeof cardId === 'string' ? { cardId: cleanText(cardId, 64) } : {})
    })
  }

  private mouthTimer: ReturnType<typeof setTimeout> | undefined

  private handle(env: Envelope<unknown>): void {
    const decidedAt = now()
    const before = this.state
    const d = decide(this.state, env, decidedAt)
    this.state = d.state
    // B: a card about a problem that is gone closes by itself (✓), so new cards are never stuck behind old ones
    const after = d.state
    if ((before.mic?.muted === true && after.mic?.muted === false) || (before.micBad !== null && after.micBad === null)) this.ui({ type: 'RESOLVED', topic: 'mic' })
    const live = (c: typeof after.camera): boolean => c !== null && !c.frozen && c.face
    if (before.camera !== null && !live(before.camera) && live(after.camera)) this.ui({ type: 'RESOLVED', topic: 'camera' })
    for (const l of d.log) this.report.log(l.kind, l.text)
    for (const b of d.blocked) this.report.blocked(b, 'allowlist')
    void this.run(d.actions, env.provenance, decidedAt)
    // B (Sun 02:00): vision sends MOUTH_MOVING only when it changes, so "talking for 1.5 s while muted" was only
    // re-checked when a mic level arrived. While the mouth keeps moving, re-check every second (the rules' card
    // cooldown prevents duplicates). Muted in Windows is then enough on its own, even without "Start mic".
    const p = env.payload as { signal?: unknown; active?: unknown } | null
    if (env.kind === 'vision' && p?.signal === 'mouth') {
      clearTimeout(this.mouthTimer)
      if (p.active === true) this.mouthTimer = setTimeout(() => {
        if (this.state.mouthSince !== null) this.handle(env)
      }, 1000)
    }
  }

  /** Actions from one decision run in order (e.g. the knock first, then the card). */
  private async run(actions: unknown[], provenance: Provenance, decidedAt: number): Promise<void> {
    for (const a of actions) {
      const g = gate(a, provenance, this.roles.role)
      if (g.verdict === 'block') {
        const name = (a as { action?: unknown })?.action
        this.report.blocked(`${typeof name === 'string' ? name : 'action'} blocked (${g.reason})`, g.category)
      } else if (provenance !== 'user' && now() < this.pausedUntil) {
        // Spam guard pauses automation only. The user's own click always goes through.
        this.report.blocked(`${g.req.action} skipped (executor paused by the spam guard)`, 'paused')
      } else {
        await this.perform(g.req, decidedAt)
      }
    }
  }

  // ---------- safety levers, pulled only by the Monitor ----------

  /** Spam guard: skip automatic (non-user) actions until `untilTs`. */
  pause(untilTs: number): void {
    this.pausedUntil = untilTs
  }

  /** Haptics breaker: stop calling HapticWeb, flash the screen instead. */
  hapticsOff(): void {
    this.hapticsDisabled = true
  }

  private async perform(a: ActionRequest, decidedAt: number): Promise<void> {
    let ok = true
    try {
      ok = await this.act(a, decidedAt)
    } finally {
      this.bus.publish('executor', 'system', 'action.result', { action: a.action, ok })
    }
  }

  /** Does the action; returns false if it failed (only haptics can fail today). */
  private async act(a: ActionRequest, decidedAt: number): Promise<boolean> {
    switch (a.action) {
      case 'show_away_summary': {
        if (a.waitSentenceEnd) await this.sentenceEnd(decidedAt)
        else if (a.trigger === 'looked_back') {
          // B: someone is mid-sentence as you look back → wait for that sentence (it holds what you missed);
          // otherwise just let the last words leave the speech engine.
          const t = now()
          if (this.lastPartialAt > this.lastLineAt && t - this.lastPartialAt < 2) await this.sentenceEnd(t)
          else await sleep(STT_GRACE_MS)
        }
        const r = await this.summary(a.fromTs, now())
        if (!r) return true
        const seconds = Math.round(a.untilTs - a.fromTs)
        const seen = a.trigger === 'name' ? `Your name was said after ${seconds} s away` : `Looked back after ${seconds} s away`
        if (!r.transcript) {
          this.report.log('decision', `${seen} → no recap (nothing was said)`)
          return true
        }
        this.ui({
          type: 'SHOW_AWAY_SUMMARY',
          id: this.cardId(),
          away_from: a.fromTs,
          until: a.untilTs,
          trigger: a.trigger,
          summary: r.summary.text,
          question_to_you: r.summary.question,
          transcript: r.transcript
        })
        this.report.log('action', `${seen} → "while you were away" card with those ${seconds} s (${r.summary.source} summary)`)
        return true
      }
      case 'show_recap': {
        if (a.waitSentenceEnd) await this.sentenceEnd(decidedAt)
        const r = await this.summary(a.fromTs, now())
        if (!r) return true
        if (!r.transcript) {
          this.report.log('decision', 'Your name was said → no recap (no transcript yet)')
          return true
        }
        this.ui({ type: 'SHOW_RECAP', id: this.cardId(), transcript: r.transcript, summary: r.summary.text, question: r.summary.question })
        this.report.log('action', `Your name was said → recap card shown (${r.summary.source} summary${r.summary.question ? ', with the question to you' : ''})`)
        return true
      }
      case 'show_nudge':
        this.ui({ type: 'SHOW_NUDGE', id: this.cardId(), text: "They're waiting for your answer", ...(a.question ? { question: a.question } : {}) })
        this.report.log('action', `A question to you, then silence → nudge shown ("They're waiting for your answer")`)
        return true
      case 'show_fix': {
        const id = this.cardId()
        this.ui({
          type: 'SHOW_FIX',
          id,
          problem: a.problem,
          fix_label: a.fixLabel,
          action_id: a.fixAction,
          ...(a.altLabel && a.altAction ? { alt_label: a.altLabel, alt_action_id: a.altAction } : {}),
          ...(a.itTicket ? { it_ticket: true } : {})
        })
        this.report.log('action', `${capitalise(a.why)} → fix card shown ("${a.fixLabel}"; nothing changes until you click)`)
        // B: nothing the user can click fixes this (still bad after switching, no other mic) → IT, automatically
        if (a.itTicket) {
          const reason = ticketReason(a.problem)
          this.scheduleAutoTicket(id, reason, reason)
        }
        return true
      }
      case 'restart_camera':
        this.ui({ type: 'RESTART_CAMERA' })
        this.report.log('action', 'You clicked the fix → restarting the camera (checking the picture comes back)')
        return true
      case 'switch_input_device':
        // The main window restarts the mic on another device (renderer/src/main.ts → audio.ts).
        this.ui({ type: 'SWITCH_MIC', prefer: a.prefer })
        this.report.log('action', `You clicked the fix → switched to the ${a.prefer} mic`)
        return true
      case 'fix_mic': {
        // Windows-level fix (B's MicPort): unmute / make the working mic the default / raise the volume, then check.
        if (!this.mic) {
          this.report.log('error', 'Mic fix needs Windows mic control, not available here')
          return false
        }
        const r = await this.mic.fix(a.fix, a.mic)
        this.report.log(r.ok ? 'action' : 'error', `You clicked the fix → ${r.text}`)
        // B (Sun 04:00): the fix did not work → say so, and now offer IT (a device problem the user can't fix).
        if (!r.ok) {
          const id = this.cardId()
          this.ui({
            type: 'SHOW_FIX',
            id,
            problem: `Tap couldn't fix it (${r.text}). This may be a device or driver problem.`,
            fix_label: 'OK',
            action_id: 'dismiss_card',
            it_ticket: true
          })
          this.scheduleAutoTicket(id, 'the one-click fix failed', `fix_failed:${a.fix}:${a.mic}`)
        }
        if (r.ok && a.fix === 'switch') this.ui({ type: 'SWITCH_MIC', prefer: a.mic }) // Tap's own capture follows
        return r.ok
      }
      case 'dismiss_card':
        this.ui({ type: 'DISMISS', id: a.cardId })
        return true
      case 'open_it_ticket':
        return this.sendTicket(a.cardId)
      case 'auto_it_ticket':
        return this.sendTicket(a.cardId, a.reason)
      case 'cancel_it_ticket': {
        const timer = this.autoPending.get(a.cardId)
        if (!timer) return true // already sent, or nothing pending
        clearTimeout(timer)
        this.autoPending.delete(a.cardId)
        this.ui({ type: 'IT_TICKET', card_id: a.cardId, state: 'cancelled', reason: '', auto: true })
        this.report.log('action', 'You clicked Undo → the automatic IT ticket was not sent')
        return true
      }
      case 'send_call_report':
        return this.sendCallReport()
      case 'send_haptic': {
        if (this.hapticsDisabled) {
          this.ui({ type: 'FLASH', reason: a.waveform })
          this.report.log('action', `send_haptic ${a.waveform} skipped (haptics breaker open) → screen flash`)
          return true
        }
        const ok = await this.haptics.fire(a.waveform)
        this.report.log('action', `send_haptic ${a.waveform}${ok ? '' : ' (failed → screen flash)'}`)
        if (!ok) this.ui({ type: 'FLASH', reason: a.waveform })
        return ok
      }
    }
  }

  /** The user's click: their own device facts (no speech, no names) to IT, with priority by role (VIP support). */
  /**
   * B: an automatic ticket for a problem the user can't fix. Shown on the card at once ("in 10 s, Undo"), sent after
   * AUTO_TICKET_DELAY_S through the gate as provenance system (Tap's own device check; speech and AI never get here).
   * The same problem (key) goes to IT once a day at most. Also called by index.ts for a problem's 3rd time this week.
   */
  /** B: "Reset IT data": ticket numbers and the once-a-day memory start again. */
  resetTickets(): void {
    this.autoLast.clear()
    this.ticketSeq = 0
  }

  scheduleAutoTicket(cardId: string, reason: string, key: string): void {
    const t = now()
    const last = this.autoLast.get(key)
    if (last && t - last.at < AUTO_TICKET_DEDUPE_S) {
      this.ui({ type: 'IT_TICKET', card_id: cardId, state: 'duplicate', reason, auto: true, ref: last.id })
      this.report.log('decision', `IT ticket not sent again: ${reason} (already reported today, ${last.id})`)
      return
    }
    if (this.autoPending.has(cardId)) return
    this.ui({ type: 'IT_TICKET', card_id: cardId, state: 'pending', reason, auto: true, delay_s: AUTO_TICKET_DELAY_S })
    this.report.log('decision', `Problem the user can't fix (${reason}) → IT ticket in ${AUTO_TICKET_DELAY_S} s unless you click Undo`)
    const timer = setTimeout(() => {
      this.autoPending.delete(cardId)
      this.lastTicketId = ''
      void this.run([{ action: 'auto_it_ticket', cardId, reason, why: `Tap's device check: ${reason}` }], 'system', now()).then(() => {
        if (this.lastTicketId) this.autoLast.set(key, { at: now(), id: this.lastTicketId })
      })
    }, AUTO_TICKET_DELAY_S * 1000)
    this.autoPending.set(cardId, timer)
  }

  private async sendTicket(cardId: string, autoReason?: string): Promise<boolean> {
    const flags = this.roles.flags
    const ticket: ItTicket = {
      id: `T-${String(++this.ticketSeq).padStart(4, '0')}`,
      createdAt: new Date(now() * 1000).toISOString(),
      priority: flags.ticketPriority,
      requesterRole: flags.label,
      diagnostics: this.ports.diagnostics?.() ?? null,
      mic: this.micFacts(),
      reason: autoReason ?? 'sent by the user',
      ...(autoReason !== undefined ? { automatic: true } : {})
    }
    const auto = autoReason !== undefined
    const reason = autoReason ?? 'sent by the user'
    const sent = this.ports.tickets
      ? await this.ports.tickets.send(ticket).catch((e: unknown) => ({ ok: false, where: e instanceof Error ? e.message : 'write failed' }))
      : { ok: true, where: 'log only' }
    if (!sent.ok) {
      this.ui({ type: 'IT_TICKET', card_id: cardId, state: 'failed', reason, auto, ref: ticket.id })
      this.report.log('error', `${auto ? 'Automatic IT ticket' : 'You clicked "Send diagnostics to IT" → ticket'} ${ticket.id} could not be saved (${sent.where})`)
      return false
    }
    const queue = ticket.priority === 'priority' ? 'priority: executive support' : 'normal queue'
    // B: shown inside the card it belongs to; no extra card to read in the middle of a call.
    this.lastTicketId = ticket.id
    this.ui({ type: 'IT_TICKET', card_id: cardId, state: 'sent', reason, auto, ref: ticket.id })
    const who = auto ? `Tap sent IT ticket ${ticket.id} by itself (${reason})` : `You clicked "Send diagnostics to IT" → ticket ${ticket.id} sent`
    this.report.log('action', `${who} (${queue}; device facts only, no speech; ${sent.where})`)
    return true
  }

  private async sendCallReport(): Promise<boolean> {
    const flags = this.roles.flags
    const diagnostics = this.ports.diagnostics?.() ?? null
    const problems = diagnostics?.problems.length ?? 0
    const priority = problems === 0 ? 'log' : flags.ticketPriority === 'priority' ? 'urgent' : 'priority'
    const report: CallReport = {
      id: `R-${String(++this.reportSeq).padStart(4, '0')}`,
      endedAt: new Date(now() * 1000).toISOString(),
      priority,
      requesterRole: flags.label,
      diagnostics,
      mic: this.micFacts()
    }
    const saved = this.ports.itLog
      ? await this.ports.itLog.add(report).catch((e: unknown) => ({ ok: false, where: e instanceof Error ? e.message : 'write failed' }))
      : { ok: true, where: 'log only' }
    this.ports.resetCall?.()
    const fixes = diagnostics?.fixesApplied.length ?? 0
    if (!saved.ok) {
      this.ui({ type: 'IT_SENT', what: 'call_report', ok: false, text: `Call report ${report.id} could not be saved` })
      this.report.log('error', `Call ended → device report ${report.id} could not be saved (${saved.where})`)
      return false
    }
    const level = priority === 'urgent' ? 'urgent: executive support' : priority === 'priority' ? 'priority: device problems' : 'log only: no problem'
    this.ui({ type: 'IT_SENT', what: 'call_report', ok: true, text: `Call report added to the IT log (${level})` })
    this.report.log(
      'action',
      `Call ended → device report ${report.id} added to the IT log (${problems} problems, ${fixes} fixes; ${level}; device facts only, no speech; ${saved.where})`
    )
    return true
  }

  /** The Windows mic state without its name (a device name can hold a person's name). */
  private micFacts(): ItTicket['mic'] {
    const m = this.state.mic
    return m ? { kind: m.kind, muted: m.muted, volume: m.volume, ...(m.otherKind ? { otherKind: m.otherKind } : {}) } : null
  }

  /**
   * The end of the sentence that held the user's name: the next final transcript line after `since`, or
   * SENTENCE_END_MAX_MS. Resolves at once if that line already arrived (e.g. while the knock was being sent).
   */
  private sentenceEnd(since: number): Promise<void> {
    if (this.lastLineAt > since) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(done, SENTENCE_END_MAX_MS)
      this.lineWaiters.push(done)
      function done(): void {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  /** Ask the Audio agent for a summary of [fromTs, untilTs] over the bus and wait for the matching reply. */
  private summary(fromTs: number, untilTs: number): Promise<SummaryResult | null> {
    const requestId = `sum-${++this.reqSeq}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        this.report.log('error', 'No recap summary arrived in time → card skipped')
        resolve(null)
      }, SUMMARY_WAIT_MS)
      this.pending.set(requestId, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      if (!this.bus.publish('executor', 'system', 'summary.request', { requestId, fromTs, untilTs })) {
        this.pending.delete(requestId)
        clearTimeout(timer)
        resolve(null)
      }
    })
  }

  private cardId(): string {
    return `card-${++this.cardSeq}`
  }

}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
