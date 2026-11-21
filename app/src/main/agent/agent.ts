/**
 * OWNER: C. Wires Tap's four agents together (doc §1). Thin on purpose: the logic lives in the agents.
 *   1. Audio agent (audio-agent.ts): transcript → Summary. The only LLM caller.
 *   2. Vision intake (vision-intake.ts): A's webcam events → VisionSignal / gestures.
 *   3. Executor (rules.ts → executor.ts): decides and acts, through the gate.
 *   4. Monitor: added in step 4.
 * They talk only through the AgentBus, in validated envelopes.
 */
import type { LogEntry, TapEvent, UiCommand } from '../../shared/events.ts'
import { now } from '../../shared/events.ts'
import { AgentBus, type EventBus } from '../bus.ts'
import type { Haptics } from '../haptics.ts'
import { AudioAgent } from './audio-agent.ts'
import { Executor } from './executor.ts'
import type { Llm } from './llm.ts'
import { cleanText, MAX } from './sanitize.ts'
import { startVisionIntake } from './vision-intake.ts'

/** How agents write the judges' log and the counters. */
export interface Reporter {
  log(kind: LogEntry['kind'], text: string, costUsd?: number): void
  /** A request was refused (allowlist, provenance, permission). */
  blocked(text: string): void
  /** A message failed validation and was dropped. */
  invalid(reason: string): void
  aiCall(costUsd: number): void
}

export class Agent {
  private counters = { aiCalls: 0, costUsd: 0, events: 0, blocked: 0 }

  constructor(events: EventBus, ui: (cmd: UiCommand) => void, haptics: Haptics, llm: Llm, userName: string) {
    const push = (): void => ui({ type: 'COUNTERS', ...this.counters })
    const log = (kind: LogEntry['kind'], text: string, costUsd?: number): void => ui({ type: 'LOG_ENTRY', entry: { ts: now(), kind, text, costUsd } })
    const report: Reporter = {
      log,
      blocked: (text) => {
        this.counters.blocked++
        log('blocked', text)
        push()
      },
      invalid: (reason) => report.blocked(`invalid message dropped: ${reason}`),
      aiCall: (costUsd) => {
        this.counters.aiCalls++
        this.counters.costUsd += costUsd
        push()
      }
    }

    const bus = new AgentBus()
    bus.onInvalid = report.invalid
    new AudioAgent(events, bus, llm, userName, report)
    startVisionIntake(events, bus, report)
    new Executor(events, bus, ui, haptics, report)

    // Readable event log for judges (Monitor takes this over in step 4).
    events.on('*', (e: TapEvent) => {
      this.counters.events++
      if (e.type !== 'MIC_LEVEL' && e.type !== 'TRANSCRIPT_PARTIAL') {
        const text = cleanText(e.data?.text, MAX.transcriptChunk)
        log('event', `${e.type}${text ? `: "${text}"` : ''}`)
      }
      push()
    })
  }
}
