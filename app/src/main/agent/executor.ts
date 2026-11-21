/**
 * OWNER: C. Agent 3, the Executor: rules → gate → act. No LLM.
 * It is the only agent that changes anything the user sees, hears or feels.
 * Gate (in order): schema/allowlist → provenance. Speech and AI output can never trigger an action.
 */
import type { TapEvent, UiCommand, Waveform } from '../../shared/events.ts'
import { now } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import { decide, initialState, type RulesState } from './rules.ts'
import { ActionRequest, type Envelope, type PayloadOf, type Provenance, RawTapEvent } from './schemas.ts'
import { cleanText } from './sanitize.ts'

/** What the executor needs from haptics.ts (an interface, so tests can fake it). */
export interface HapticsPort {
  fire(w: Waveform): Promise<boolean>
}

type SummaryResult = PayloadOf<'summary'>
export type Verdict = { verdict: 'run'; req: ActionRequest } | { verdict: 'block'; reason: string; category: 'allowlist' | 'provenance' }

const SUMMARY_WAIT_MS = 5000 // the LLM itself gives up after 3 s; this only guards against a lost reply
// shortcut: slices by when B published each line, plus this grace for the STT delay; switch to B's start/end
// timestamps when that contract change lands (docs/team/C-agent-haptics.md §6).
export const STT_GRACE_MS = 1500

/**
 * Which inputs may start an action. Policy as data, in one place, deterministic: never decided by an LLM.
 * Every action today only notifies the user (T0). An action that changes the user's devices or speaks for them
 * would need a `user` trigger and a role check added here.
 */
export const MAY_TRIGGER: Record<Provenance, boolean> = {
  user: true,
  vision: true,
  detector: true,
  system: true,
  transcript: false, // speech is quoted data, never a command
  llm: false // AI output is display-only
}

/** Pure gate: (1) schema + allowlist, (2) provenance. */
export function gate(req: unknown, provenance: Provenance): Verdict {
  const parsed = ActionRequest.safeParse(req)
  if (!parsed.success) return { verdict: 'block', reason: 'not a valid, allowlisted action', category: 'allowlist' }
  if (!MAY_TRIGGER[provenance]) return { verdict: 'block', reason: "speech and AI output can't trigger actions", category: 'provenance' }
  return { verdict: 'run', req: parsed.data }
}

export class Executor {
  private state: RulesState = initialState()
  private cardSeq = 0
  private reqSeq = 0
  private pending = new Map<string, (r: SummaryResult | null) => void>()
  private bus: AgentBus
  private ui: (cmd: UiCommand) => void
  private haptics: HapticsPort
  private report: Reporter
  private pausedUntil = 0
  private hapticsDisabled = false

  constructor(events: EventBus, bus: AgentBus, ui: (cmd: UiCommand) => void, haptics: HapticsPort, report: Reporter) {
    this.bus = bus
    this.ui = ui
    this.haptics = haptics
    this.report = report
    events.on('USER_CLICK', (e) => this.onClick(e))
    bus.on('vision', (e) => this.handle(e))
    bus.on('user', (e) => this.handle(e))
    bus.on('summary', (e) => {
      const done = this.pending.get(e.payload.requestId)
      this.pending.delete(e.payload.requestId)
      done?.(e.payload)
    })
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
    const d = decide(this.state, env, now())
    this.state = d.state
    for (const l of d.log) this.report.log(l.kind, l.text)
    for (const b of d.blocked) this.report.blocked(b, 'allowlist')
    void this.run(d.actions, env.provenance)
  }

  /** Actions from one decision run in order. */
  private async run(actions: unknown[], provenance: Provenance): Promise<void> {
    for (const a of actions) {
      const g = gate(a, provenance)
      if (g.verdict === 'block') {
        const name = (a as { action?: unknown })?.action
        this.report.blocked(`${typeof name === 'string' ? name : 'action'} blocked (${g.reason})`, g.category)
      } else if (provenance !== 'user' && now() < this.pausedUntil) {
        // Spam guard pauses automation only. The user's own click always goes through.
        this.report.blocked(`${g.req.action} skipped (executor paused by the spam guard)`, 'paused')
      } else {
        await this.perform(g.req)
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

  private async perform(a: ActionRequest): Promise<void> {
    let ok = true
    try {
      ok = await this.act(a)
    } finally {
      this.bus.publish('executor', 'system', 'action.result', { action: a.action, ok })
    }
  }

  /** Does the action; returns false if it failed (only haptics can fail today). */
  private async act(a: ActionRequest): Promise<boolean> {
    switch (a.action) {
      case 'show_away_summary': {
        await sleep(STT_GRACE_MS) // the last words before "back" are still in the STT
        const r = await this.summary(a.fromTs, now())
        if (!r) return true
        const seconds = Math.round(a.untilTs - a.fromTs)
        if (!r.transcript) {
          this.report.log('decision', `Looked back after ${seconds} s away → no recap (nothing was said)`)
          return true
        }
        this.ui({
          type: 'SHOW_AWAY_SUMMARY',
          id: this.cardId(),
          away_from: a.fromTs,
          until: a.untilTs,
          trigger: 'looked_back',
          summary: r.summary.text,
          question_to_you: r.summary.question,
          transcript: r.transcript
        })
        this.report.log('action', `Looked back after ${seconds} s away → recap of those ${seconds} s shown (${r.summary.source} summary)`)
        return true
      }
      case 'dismiss_card':
        this.ui({ type: 'DISMISS', id: a.cardId })
        return true
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
      if (!this.bus.publish('executor', 'system', 'summary.request', { requestId, kind: 'away', fromTs, untilTs })) {
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
