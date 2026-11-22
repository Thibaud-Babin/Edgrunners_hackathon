/**
 * OWNER: C (A builds the vision code). Agent 2 intake: turns A's webcam events into validated envelopes.
 *   Attention (away / back) and camera health (frozen, face out of frame, low light, mouth) → `VisionSignal`,
 *   provenance `vision`: may only notify the user (T0).
 * Only enums, booleans and numbers get through: any free text A sends is dropped here.
 */
import type { EventType, TapEvent } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import { RawTapEvent, type VisionSignal } from './schemas.ts'

const SIGNALS: Partial<Record<EventType, VisionSignal['signal']>> = {
  USER_AWAY: 'away',
  USER_BACK: 'back',
  MOUTH_MOVING: 'mouth',
  CAMERA_FROZEN: 'camera_frozen',
  FACE_OUT_OF_FRAME: 'face_out_of_frame',
  LOW_LIGHT: 'low_light'
}

const REASONS: readonly string[] = ['turned_away', 'no_face'] satisfies NonNullable<VisionSignal['reason']>[]

export function startVisionIntake(events: EventBus, bus: AgentBus, report: Reporter): void {
  for (const type of Object.keys(SIGNALS) as EventType[]) events.on(type, (e) => onSignal(e, SIGNALS[type]!))

  function parse(e: TapEvent): RawTapEvent | null {
    const raw = RawTapEvent.safeParse(e)
    if (!raw.success || raw.data.source !== 'webcam') {
      report.invalid(`${String((e as { type?: unknown })?.type)} event with a bad shape or not from the webcam`)
      return null
    }
    return raw.data
  }

  function onSignal(e: TapEvent, signal: VisionSignal['signal']): void {
    const raw = parse(e)
    if (!raw) return
    const reason = raw.data?.reason
    const since = raw.data?.since
    bus.publish('vision', 'vision', 'vision', {
      signal,
      ...(signal === 'mouth' ? { active: raw.data?.active === true } : {}),
      ...(typeof reason === 'string' && REASONS.includes(reason) ? { reason: reason as VisionSignal['reason'] } : {}),
      // Gaze reports when the user first left, before its 3 s hold. Never accept a future timestamp.
      ...(signal === 'away' && typeof since === 'number' && Number.isFinite(since) && since >= 0 && since <= raw.ts ? { since } : {}),
      ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {})
    })
  }
}
