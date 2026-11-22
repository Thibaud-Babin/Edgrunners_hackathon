/**
 * OWNER: C. Wires Tap's four agents together (doc §1). Thin on purpose: the logic lives in the agents.
 *   1. Audio agent (audio-agent.ts): transcript → Summary. The only LLM caller.
 *   2. Vision intake (vision-intake.ts): A's webcam events → VisionSignal / gestures.
 *   3. Executor (rules.ts → executor.ts): decides and acts, through the gate.
 *   4. Monitor (monitor.ts): self-check, heartbeats, breakers, spam guard, counters, the judges' log.
 * They talk only through the AgentBus, in validated envelopes. The user's role (permissions.ts) is config,
 * shared through RoleState: set from TAP_USER_ROLE at start, and by the dev-only switch when allowed.
 */
import type { LogEntry, TapEvent, UiCommand } from '../../shared/events.ts'
import { AgentBus, type EventBus } from '../bus.ts'
import type { Haptics } from '../haptics.ts'
import { AudioAgent } from './audio-agent.ts'
import { Executor, type ExecutorPorts, type MicPort, type TicketPort } from './executor.ts'
import type { Llm } from './llm.ts'
import { Monitor } from './monitor.ts'
import { RoleState, ROLES, type UserRole } from './permissions.ts'
import { RawTapEvent } from './schemas.ts'
import { startVisionIntake } from './vision-intake.ts'

export type BlockCategory = 'invalid' | 'allowlist' | 'provenance' | 'permission' | 'paused'

/** How agents write the judges' log and the counters (implemented by the Monitor). */
export interface Reporter {
  log(kind: LogEntry['kind'], text: string, costUsd?: number): void
  /** A request was refused. */
  blocked(text: string, category: BlockCategory): void
  /** A message failed validation and was dropped. */
  invalid(reason: string): void
}

export interface AgentOptions {
  mic?: MicPort | null
  /** The user's role, from config. Default: intern (least privilege). */
  roles?: RoleState
  /** Accept USER_SET_ROLE from the UI. Only true in dev builds: a production UI must never change the role. */
  allowRoleSwitch?: boolean
  /** Where IT tickets go (simulated helpdesk). Without it, tickets are only logged. */
  tickets?: TicketPort
  /** The IT log for end-of-call device reports (simulated). */
  itLog?: ExecutorPorts['itLog']
}

export class Agent {
  private ui: (cmd: UiCommand) => void
  private roles: RoleState
  /** The judges' log, and the AI cost counter, for work done outside the four agents (B: end-of-call summary). */
  readonly report: Reporter
  readonly recordAiCall: (costUsd: number) => void
  /** B: automatic IT ticket for a card (index.ts: a problem's 3rd time this week). Goes through the executor's gate. */
  readonly autoTicket: (cardId: string, reason: string, key: string) => void
  /** B: "Reset IT data": ticket numbers and the once-a-day memory start again. */
  readonly resetTickets: () => void

  constructor(events: EventBus, ui: (cmd: UiCommand) => void, haptics: Haptics, llm: Llm, userName: string, opts: AgentOptions = {}) {
    this.ui = ui
    this.roles = opts.roles ?? new RoleState()
    const bus = new AgentBus()
    const monitor = new Monitor(events, bus, ui)
    const report = monitor.reporter
    this.report = report
    this.recordAiCall = (usd) => monitor.recordAiCall(usd)
    bus.onInvalid = report.invalid
    new AudioAgent(events, bus, llm, userName, report, this.roles)
    startVisionIntake(events, bus, report)
    const executor = new Executor(events, bus, ui, haptics, report, opts.mic ?? null, this.roles, {
      ...(opts.tickets ? { tickets: opts.tickets } : {}),
      ...(opts.itLog ? { itLog: opts.itLog } : {}),
      diagnostics: () => monitor.diagnostics(),
      resetCall: () => monitor.resetCall()
    })
    monitor.start({ llm, executor, haptics })
    this.autoTicket = (cardId, reason, key) => executor.scheduleAutoTicket(cardId, reason, key)
    this.resetTickets = () => executor.resetTickets()

    report.log('decision', `Role: ${this.roles.flags.label} (from config) → ${roleSummary(this.roles.role)}`)
    this.roles.onChange((role) => {
      report.log('decision', `Role switched to ${this.roles.flags.label} (dev only) → ${roleSummary(role)}`)
      this.announceRole()
    })
    events.on('USER_SET_ROLE', (e: TapEvent) => {
      const raw = RawTapEvent.safeParse(e)
      const role = raw.success ? raw.data.data?.role : undefined
      if (!opts.allowRoleSwitch) return report.blocked('Role switch from the UI ignored (only allowed in dev builds)', 'permission')
      if (!raw.success || raw.data.source !== 'ui' || typeof role !== 'string' || !(ROLES as readonly string[]).includes(role))
        return report.invalid('USER_SET_ROLE with a bad shape, source or role')
      this.roles.set(role as UserRole)
    })
  }

  /** Tell the UI the role and what it shows (D hides the IT view when sees_it_view is false). */
  announceRole(): void {
    const f = this.roles.flags
    this.ui({ type: 'ROLE', role: this.roles.role, sees_it_view: f.seesItView, confidential: f.confidential })
  }
}

function roleSummary(role: UserRole): string {
  switch (role) {
    case 'intern':
      return 'cards and own-device fixes; IT view hidden; normal IT queue'
    case 'senior':
      return 'cards, own-device fixes, IT view; normal IT queue'
    default:
      return 'cards, own-device fixes, IT view; confidential meetings (no cloud AI, no recording); priority IT support'
  }
}
