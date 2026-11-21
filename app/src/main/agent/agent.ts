/**
 * OWNER: C. Wires Tap's four agents together (doc §1). Thin on purpose: the logic lives in the agents.
 *   1. Audio agent (audio-agent.ts): transcript → Summary. The only LLM caller.
 *   2. Vision intake (vision-intake.ts): A's webcam events → VisionSignal / gestures.
 *   3. Executor (rules.ts → executor.ts): decides and acts, through the gate.
 *   4. Monitor (monitor.ts): self-check, heartbeats, breakers, spam guard, counters, the judges' log.
 * They talk only through the AgentBus, in validated envelopes.
 */
import type { LogEntry, UiCommand } from '../../shared/events.ts'
import { AgentBus, type EventBus } from '../bus.ts'
import type { Haptics } from '../haptics.ts'
import { AudioAgent } from './audio-agent.ts'
import { Executor } from './executor.ts'
import type { Llm } from './llm.ts'
import type { Role } from './permissions.ts'
import { Monitor } from './monitor.ts'
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

export class Agent {
  constructor(events: EventBus, ui: (cmd: UiCommand) => void, haptics: Haptics, llm: Llm, userName: string, role: Role) {
    const bus = new AgentBus()
    const monitor = new Monitor(events, bus, ui)
    const report = monitor.reporter
    bus.onInvalid = report.invalid
    new AudioAgent(events, bus, llm, userName, report)
    startVisionIntake(events, bus, report)
    const executor = new Executor(events, bus, ui, haptics, report, role)
    monitor.start({ llm, executor, haptics, role })
  }
}
