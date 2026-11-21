/**
 * OWNER: C. Agent 3, the Executor: rules → gate → act. No LLM.
 * It is the only agent that changes anything the user sees, hears or feels.
 * Gate (in order): schema/allowlist → provenance. Speech and AI output can never trigger an action.
 */
import type { TapEvent, UiCommand, Waveform } from '../../shared/events.ts'
import { now } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import { ACTION_TIER } from './permissions.ts'
import { decide, initialState, type RulesState } from './rules.ts'
import { ActionRequest, type Envelope, type PayloadOf, type Provenance, RawTapEvent } from './schemas.ts'
import { cleanText } from './sanitize.ts'

/** What the executor needs from haptics.ts (an interface, so tests can fake it). */
export interface HapticsPort {
  fire(w: Waveform): Promise<boolean>
}

type SummaryResult = PayloadOf<'summary'>
type Gate = { ok: true; req: ActionRequest } | { ok: false; reason: string }

const SUMMARY_WAIT_MS = 5000 // the LLM itself gives up after 3 s; this only guards against a lost reply

/**
 * Pure gate: may an action requested by an input of this provenance run?
 *   transcript, llm      → never.
 *   detector, vision, system → T0 (notify the user) only.
 *   user                 → any tier (roles are checked after this, in step 3).
 */
export function gate(req: unknown, provenance: Provenance): Gate {
  const parsed = ActionRequest.safeParse(req)
  if (!parsed.success) return { ok: false, reason: 'not a valid, allowlisted action' }
  const tier = ACTION_TIER[parsed.data.action]
  if (provenance === 'transcript' || provenance === 'llm') return { ok: false, reason: "speech and AI output can't trigger actions" }
  if (provenance !== 'user' && tier > 0) return { ok: false, reason: `T${tier} needs your own click or gesture` }
  return { ok: true, req: parsed.data }
}

export class Executor {
  private state: RulesState = initialState(now())
  private cardSeq = 0
  private reqSeq = 0
  private pending = new Map<string, (r: SummaryResult | null) => void>()
  private bus: AgentBus
  private ui: (cmd: UiCommand) => void
  private haptics: HapticsPort
  private report: Reporter

  constructor(events: EventBus, bus: AgentBus, ui: (cmd: UiCommand) => void, haptics: HapticsPort, report: Reporter) {
    this.bus = bus
    this.ui = ui
    this.haptics = haptics
    this.report = report
    events.on('USER_CLICK', (e) => this.onClick(e))
    bus.on('detector', (e) => this.handle(e))
    bus.on('vision', (e) => this.handle(e))
    bus.on('mic', (e) => this.handle(e))
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
    for (const b of d.blocked) this.report.blocked(b)
    void this.run(d.actions, env.provenance)
  }

  /** Actions from one decision run in order (e.g. the knock finishes before the recap starts). */
  private async run(actions: unknown[], provenance: Provenance): Promise<void> {
    for (const a of actions) {
      const g = gate(a, provenance)
      if (!g.ok) {
        const name = (a as { action?: unknown })?.action
        this.report.blocked(`${typeof name === 'string' ? name : 'action'} blocked (${g.reason})`)
        continue
      }
      await this.perform(g.req)
    }
  }

  private async perform(a: ActionRequest): Promise<void> {
    switch (a.action) {
      case 'send_haptic': {
        const ok = await this.haptics.fire(a.waveform)
        this.report.log('action', `send_haptic ${a.waveform}${ok ? '' : ' (failed → screen flash)'}`)
        if (!ok) this.ui({ type: 'FLASH', reason: a.waveform })
        return
      }
      case 'show_fix':
        this.ui({ type: 'SHOW_FIX', id: this.cardId(), problem: a.problem, fix_label: a.fixLabel, action_id: a.fixAction })
        return
      case 'switch_input_device':
        // The main window restarts the mic on another device (renderer/src/main.ts → audio.ts).
        this.ui({ type: 'SWITCH_MIC', prefer: a.prefer })
        this.report.log('action', `switch_input_device → ${a.prefer} mic`)
        return
      case 'dismiss_card':
        this.ui({ type: 'DISMISS', id: a.cardId })
        return
      case 'show_recap': {
        await sleep(a.afterMs)
        const r = await this.summary('recap', a.fromTs, a.fallbackText)
        if (!r) return
        this.ui({ type: 'SHOW_RECAP', id: this.cardId(), transcript: r.transcript, summary: r.summary.text, question: r.summary.question })
        this.report.log('action', 'show_recap')
        return
      }
      case 'show_away_summary': {
        const until = now()
        const r = await this.summary('away', a.fromTs, '')
        if (!r || (a.skipIfSilent && !r.transcript)) return
        this.ui({
          type: 'SHOW_AWAY_SUMMARY',
          id: this.cardId(),
          away_from: a.fromTs,
          until,
          trigger: a.trigger,
          summary: r.summary.text,
          question_to_you: r.summary.question,
          transcript: r.transcript
        })
        this.report.log('action', `show_away_summary (${Math.round(until - a.fromTs)} s away, trigger: ${a.trigger})`)
        return
      }
      case 'post_chat_reply':
        this.report.log('action', `post_chat_reply "${a.text}" (not implemented yet)`)
        return
    }
  }

  /** Ask the Audio agent for a summary over the bus and wait for the matching reply. */
  private summary(kind: 'recap' | 'away', fromTs: number, fallbackText: string): Promise<SummaryResult | null> {
    const requestId = `sum-${++this.reqSeq}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        this.report.log('error', `No ${kind} summary arrived in time → card skipped`)
        resolve(null)
      }, SUMMARY_WAIT_MS)
      this.pending.set(requestId, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      if (!this.bus.publish('executor', 'system', 'summary.request', { requestId, kind, fromTs, fallbackText })) {
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
