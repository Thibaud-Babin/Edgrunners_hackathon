/**
 * OWNER: C. Agent 3, the Executor: rules → gate → act. No LLM.
 * It is the only agent that changes anything the user sees, hears or feels.
 * Gate (in order): schema/allowlist → provenance → role × tier. Speech and AI output can never trigger an action.
 */
import type { TapEvent, UiCommand, Waveform } from '../../shared/events.ts'
import { HAPTIC, now } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import { ACTION_TIER, permission, type Role, type Tier, TIER_VERB } from './permissions.ts'
import { decide, initialState, type RulesState } from './rules.ts'
import { ActionRequest, type Envelope, type PayloadOf, type Provenance, RawTapEvent, type UserInput } from './schemas.ts'
import { cleanText } from './sanitize.ts'

/** What the executor needs from haptics.ts (an interface, so tests can fake it). */
export interface HapticsPort {
  fire(w: Waveform): Promise<boolean>
}

type SummaryResult = PayloadOf<'summary'>
/**
 * run     → do it now.          confirm → ask the user first (confirm card; eyebrow raise or click).
 * deny    → only suggest, log why.   block → refused outright (invalid, or the wrong provenance).
 */
export type Verdict =
  | { verdict: 'run' | 'confirm' | 'deny'; req: ActionRequest; tier: Tier }
  | { verdict: 'block'; reason: string }

/** What started an action: the input itself when it came from the user. */
export type Trigger = UserInput['input'] | null

const SUMMARY_WAIT_MS = 5000 // the LLM itself gives up after 3 s; this only guards against a lost reply
const CONFIRM_TTL_S = 15

/**
 * Pure gate. In order:
 *   1. schema + allowlist: unknown or malformed actions are blocked.
 *   2. provenance: transcript / llm → never; detector / vision / system → T0 only; T1+ needs a user input.
 *   3. role × tier (permissions.ts). A click on a card that names the action is an explicit confirmation.
 */
export function gate(req: unknown, provenance: Provenance, role: Role, trigger: Trigger): Verdict {
  const parsed = ActionRequest.safeParse(req)
  if (!parsed.success) return { verdict: 'block', reason: 'not a valid, allowlisted action' }
  const tier = ACTION_TIER[parsed.data.action]
  if (provenance === 'transcript' || provenance === 'llm') return { verdict: 'block', reason: "speech and AI output can't trigger actions" }
  if (tier > 0 && (provenance !== 'user' || trigger === null)) return { verdict: 'block', reason: `T${tier} needs your own click or gesture` }
  const p = permission(role, tier)
  if (p === 'deny') return { verdict: 'deny', req: parsed.data, tier }
  if (p === 'confirm' && trigger !== 'click') return { verdict: 'confirm', req: parsed.data, tier }
  return { verdict: 'run', req: parsed.data, tier }
}

/** Plain words for the log: what the action would do. */
export function describe(a: ActionRequest): string {
  switch (a.action) {
    case 'post_chat_reply':
      return `reply "${a.text}"`
    case 'switch_input_device':
      return `switch to the ${a.prefer} mic`
    default:
      return a.action.replace(/_/g, ' ')
  }
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
  private role: Role
  /** At most one action waiting for the user's OK. */
  private awaiting: { req: ActionRequest; tier: Tier; cardId: string; until: number } | null = null

  constructor(events: EventBus, bus: AgentBus, ui: (cmd: UiCommand) => void, haptics: HapticsPort, report: Reporter, role: Role) {
    this.role = role
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
    const trigger: Trigger = env.kind === 'user' ? (env.payload as UserInput).input : null
    if (env.kind === 'user' && this.confirms(env.payload as UserInput)) return
    const d = decide(this.state, env, now())
    this.state = d.state
    for (const l of d.log) this.report.log(l.kind, l.text)
    for (const b of d.blocked) this.report.blocked(b)
    void this.run(d.actions, env.provenance, trigger)
  }

  /** Actions from one decision run in order (e.g. the knock finishes before the recap starts). */
  private async run(actions: unknown[], provenance: Provenance, trigger: Trigger): Promise<void> {
    for (const a of actions) {
      const g = gate(a, provenance, this.role, trigger)
      if (g.verdict === 'block') {
        const name = (a as { action?: unknown })?.action
        this.report.blocked(`${typeof name === 'string' ? name : 'action'} blocked (${g.reason})`)
      } else if (g.verdict === 'deny') {
        this.report.blocked(`${g.req.why} → ${describe(g.req)} suggested, not done (as ${this.role}, Tap can't ${TIER_VERB[g.tier]}, T${g.tier})`)
      } else if (g.verdict === 'confirm') {
        this.askConfirm(g.req, g.tier)
      } else {
        await this.perform(g.req)
      }
    }
  }

  /** Show a confirm card (SHOW_FIX reused: no contract change). The user's eyebrow raise or click confirms. */
  private askConfirm(req: ActionRequest, tier: Tier): void {
    const cardId = this.cardId()
    if (this.awaiting) this.ui({ type: 'DISMISS', id: this.awaiting.cardId })
    this.awaiting = { req, tier, cardId, until: now() + CONFIRM_TTL_S }
    this.ui({ type: 'SHOW_FIX', id: cardId, problem: `Confirm: ${describe(req)}?`, fix_label: 'Confirm (or raise your eyebrows)', action_id: req.action })
    this.report.log('decision', `${req.why} → ${describe(req)} waiting for your OK (as ${this.role}, Tap asks before it can ${TIER_VERB[tier]}, T${tier}): raise your eyebrows or click`)
  }

  /** True if this user input confirmed the waiting action (and it was run). */
  private confirms(u: UserInput): boolean {
    const w = this.awaiting
    if (!w) return false
    if (now() > w.until) {
      this.awaiting = null
      this.report.log('decision', `${describe(w.req)} not confirmed within ${CONFIRM_TTL_S} s → dropped`)
      return false
    }
    const byClick = u.input === 'click' && u.actionId === w.req.action
    if (!byClick && u.input !== 'brow_raise') return false
    this.awaiting = null
    this.ui({ type: 'DISMISS', id: w.cardId })
    this.report.log('decision', `${byClick ? 'Click' : 'Eyebrow raise'} seen → ${describe(w.req)} confirmed (T${w.tier})`)
    void this.perform(w.req)
    return true
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
        // P1: D shows the reply; posting into the call's chat is not wired yet.
        this.ui({ type: 'SHOW_REPLY', id: this.cardId(), text: a.text })
        this.report.log('action', `reply "${a.text}" sent`)
        void this.perform({ action: 'send_haptic', waveform: HAPTIC.done, why: 'reply sent' })
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
