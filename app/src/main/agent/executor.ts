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
}

/** Where tickets go: a simulated helpdesk (index.ts writes JSON files). Returns where it was stored. */
export interface TicketPort {
  send(ticket: ItTicket): Promise<{ ok: boolean; where: string }>
}

export interface ExecutorPorts {
  tickets?: TicketPort
  diagnostics?: () => Diagnostics
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
 * "click" actions run only from the user's own click (provenance `user`): your own devices and data at any rank,
 * sharing outside the call only for executives and the CEO. Missing role → intern (least privilege).
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
  /** Recap card id → its summary (never the transcript): what "Share with team" may send. */
  private shareable = new Map<string, string>()
  /** The last minutes card: what "Send to attendees" may send. */
  private minutes: { id: string; decisions: string[]; actionItems: string[] } | null = null
  private pendingMinutes = new Map<string, (m: PayloadOf<'minutes'> | null) => void>()

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
    events.on('CALL_ENDED', (e) => void this.onCallEnded(e))
    bus.on('vision', (e) => this.handle(e))
    bus.on('detector', (e) => this.handle(e))
    bus.on('user', (e) => this.handle(e))
    bus.on('mic', (e) => this.handle(e)) // the clock for the rules' mic-quality timer
    // A transcript line only marks the end of a sentence: it never reaches the rules and never triggers anything.
    bus.on('transcript', () => {
      this.lastLineAt = now()
      for (const w of this.lineWaiters.splice(0)) w()
    })
    bus.on('summary', (e) => {
      const done = this.pending.get(e.payload.requestId)
      this.pending.delete(e.payload.requestId)
      done?.(e.payload)
    })
    bus.on('minutes', (e) => {
      const done = this.pendingMinutes.get(e.payload.requestId)
      this.pendingMinutes.delete(e.payload.requestId)
      done?.(e.payload)
    })
  }

  /** D's "End call" button. Retention by role: confidential roles keep nothing that was said. */
  private async onCallEnded(e: TapEvent): Promise<void> {
    const raw = RawTapEvent.safeParse(e)
    if (!raw.success || raw.data.source !== 'ui') return this.report.invalid('CALL_ENDED with a bad shape or source')
    // Minutes first (executive, CEO: the roles that may send them), while what was said is still here.
    if (permission(this.roles.role, 'send_action_items') !== 'deny')
      await this.run([{ action: 'show_minutes', why: 'you ended the call' }], 'user', now())
    const wipe = this.roles.flags.wipeAtCallEnd
    if (wipe) this.shareable.clear()
    this.bus.publish('executor', 'system', 'call.end', { wipe })
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

  private handle(env: Envelope<unknown>): void {
    const decidedAt = now()
    const d = decide(this.state, env, decidedAt)
    this.state = d.state
    for (const l of d.log) this.report.log(l.kind, l.text)
    for (const b of d.blocked) this.report.blocked(b, 'allowlist')
    void this.run(d.actions, env.provenance, decidedAt)
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
        else if (a.trigger === 'looked_back') await sleep(STT_GRACE_MS) // the last words before "back" are still in the STT
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
          id: this.keepShareable(r.summary.text),
          share: true,
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
        this.ui({ type: 'SHOW_RECAP', id: this.keepShareable(r.summary.text), share: true, transcript: r.transcript, summary: r.summary.text, question: r.summary.question })
        this.report.log('action', `Your name was said → recap card shown (${r.summary.source} summary${r.summary.question ? ', with the question to you' : ''})`)
        return true
      }
      case 'show_nudge':
        this.ui({ type: 'SHOW_NUDGE', id: this.cardId(), text: "They're waiting for your answer", ...(a.question ? { question: a.question } : {}) })
        this.report.log('action', `A question to you, then silence → nudge shown ("They're waiting for your answer")`)
        return true
      case 'show_fix':
        this.ui({
          type: 'SHOW_FIX',
          id: this.cardId(),
          problem: a.problem,
          fix_label: a.fixLabel,
          action_id: a.fixAction,
          ...(a.altLabel && a.altAction ? { alt_label: a.altLabel, alt_action_id: a.altAction } : {}),
          ...(a.itTicket ? { it_ticket: true } : {})
        })
        this.report.log('action', `${capitalise(a.why)} → fix card shown ("${a.fixLabel}"; nothing changes until you click)`)
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
        if (r.ok && a.fix === 'switch') this.ui({ type: 'SWITCH_MIC', prefer: a.mic }) // Tap's own capture follows
        return r.ok
      }
      case 'dismiss_card':
        this.ui({ type: 'DISMISS', id: a.cardId })
        return true
      case 'open_it_ticket':
        return this.sendTicket()
      case 'share_recap': {
        // The gate already checked the role (T3: executive, CEO) and that this is the user's own click.
        const summary = this.shareable.get(a.cardId)
        if (!summary) {
          this.report.log('decision', 'You clicked "Share with team" → nothing shared (that recap is no longer kept)')
          return false
        }
        this.ui({ type: 'SHOW_NOTICE', id: this.cardId(), text: 'Recap shared with #team (simulated)' })
        this.report.log('action', `You clicked "Share with team" → recap summary shared with #team (simulated; ${summary.length} chars, summary only, never the transcript)`)
        return true
      }
      case 'show_minutes': {
        const m = await this.requestMinutes()
        if (!m) return false
        if (!m.decisions.length && !m.actionItems.length) {
          this.report.log('decision', 'Call ended → no minutes card (no decision or action item was heard)')
          return true
        }
        const id = this.cardId()
        this.minutes = { id, decisions: m.decisions, actionItems: m.actionItems }
        this.ui({ type: 'SHOW_MINUTES', id, decisions: m.decisions, action_items: m.actionItems, can_send: true })
        this.report.log('action', `Call ended → minutes card: ${m.decisions.length} decisions, ${m.actionItems.length} action items (made on this laptop, nothing sent until you click)`)
        return true
      }
      case 'send_action_items': {
        // The gate already checked the role (T3) and that this is the user's own click.
        const m = this.minutes
        if (!m || m.id !== a.cardId) {
          this.report.log('decision', 'You clicked "Send to attendees" → nothing sent (those minutes are no longer kept)')
          return false
        }
        this.minutes = null
        this.ui({ type: 'SHOW_NOTICE', id: this.cardId(), text: 'Decisions and action items sent to the attendees (simulated)' })
        this.report.log('action', `You clicked "Send to attendees" → ${m.decisions.length} decisions and ${m.actionItems.length} action items sent (simulated; the minutes only, never the transcript)`)
        return true
      }
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
  private async sendTicket(): Promise<boolean> {
    const flags = this.roles.flags
    const m = this.state.mic
    const ticket: ItTicket = {
      id: `T-${String(++this.ticketSeq).padStart(4, '0')}`,
      createdAt: new Date(now() * 1000).toISOString(),
      priority: flags.ticketPriority,
      requesterRole: flags.label,
      diagnostics: this.ports.diagnostics?.() ?? null,
      mic: m ? { kind: m.kind, muted: m.muted, volume: m.volume, ...(m.otherKind ? { otherKind: m.otherKind } : {}) } : null
    }
    const sent = this.ports.tickets
      ? await this.ports.tickets.send(ticket).catch((e: unknown) => ({ ok: false, where: e instanceof Error ? e.message : 'write failed' }))
      : { ok: true, where: 'log only' }
    if (!sent.ok) {
      this.report.log('error', `You clicked "Send diagnostics to IT" → ticket ${ticket.id} could not be saved (${sent.where})`)
      return false
    }
    const queue = ticket.priority === 'priority' ? 'priority: executive support' : 'normal queue'
    this.ui({ type: 'SHOW_NOTICE', id: this.cardId(), text: `Ticket ${ticket.id} sent to IT (${queue}, simulated helpdesk)` })
    this.report.log('action', `You clicked "Send diagnostics to IT" → ticket ${ticket.id} sent (${queue}; device facts only, no speech; ${sent.where})`)
    return true
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

  /** Ask the Audio agent for the call's minutes over the bus. */
  private requestMinutes(): Promise<PayloadOf<'minutes'> | null> {
    const requestId = `min-${++this.reqSeq}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pendingMinutes.delete(requestId)) return
        this.report.log('error', 'No minutes arrived in time → card skipped')
        resolve(null)
      }, SUMMARY_WAIT_MS)
      this.pendingMinutes.set(requestId, (m) => {
        clearTimeout(timer)
        resolve(m)
      })
      if (!this.bus.publish('executor', 'system', 'minutes.request', { requestId })) {
        this.pendingMinutes.delete(requestId)
        clearTimeout(timer)
        resolve(null)
      }
    })
  }

  private cardId(): string {
    return `card-${++this.cardSeq}`
  }

  /** A new recap card id; its summary is kept for "Share with team" (last 20 cards only). */
  private keepShareable(summary: string): string {
    const id = this.cardId()
    this.shareable.set(id, summary)
    if (this.shareable.size > 20) this.shareable.delete(this.shareable.keys().next().value as string)
    return id
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
