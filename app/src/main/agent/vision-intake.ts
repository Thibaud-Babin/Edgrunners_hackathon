/**
 * OWNER: C (A builds the vision code). Agent 2 intake: turns A's webcam events into validated envelopes.
 *   Passive signals (away, back, mouth…) → `VisionSignal`, provenance `vision`: may only notify (T0).
 *   Deliberate gestures (nod, shake, brow raise, tilt) → `UserInput`, provenance `user`.
 * Only enums, booleans and numbers get through: any free text A sends is dropped here.
 */
import type { EventType, TapEvent } from '../../shared/events.ts'
import type { AgentBus, EventBus } from '../bus.ts'
import type { Reporter } from './agent.ts'
import { RawTapEvent, type UserInput, type VisionSignal } from './schemas.ts'

const SIGNALS: Partial<Record<EventType, VisionSignal['signal']>> = {
  USER_AWAY: 'away',
  USER_BACK: 'back',
  MOUTH_MOVING: 'mouth',
  CAMERA_FROZEN: 'camera_frozen',
  FACE_OUT_OF_FRAME: 'face_out_of_frame',
  LOW_LIGHT: 'low_light'
}

const GESTURES: Partial<Record<EventType, UserInput['input']>> = {
  GESTURE_NOD: 'nod',
  GESTURE_SHAKE: 'shake',
  GESTURE_BROW_RAISE: 'brow_raise',
  GESTURE_TILT_LEFT: 'tilt_left',
  GESTURE_TILT_RIGHT: 'tilt_right'
}

const REASONS: readonly string[] = ['turned_away', 'no_face'] satisfies NonNullable<VisionSignal['reason']>[]

export function startVisionIntake(events: EventBus, bus: AgentBus, report: Reporter): void {
  for (const type of Object.keys(SIGNALS) as EventType[]) events.on(type, (e) => onSignal(e, SIGNALS[type]!))
  for (const type of Object.keys(GESTURES) as EventType[]) events.on(type, (e) => onGesture(e, GESTURES[type]!))

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
    bus.publish('vision', 'vision', 'vision', {
      signal,
      ...(signal === 'mouth' ? { active: raw.data?.active === true } : {}),
      ...(typeof reason === 'string' && REASONS.includes(reason) ? { reason: reason as VisionSignal['reason'] } : {}),
      ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {})
    })
  }

  function onGesture(e: TapEvent, input: UserInput['input']): void {
    if (parse(e)) bus.publish('vision', 'user', 'user', { input })
  }
}
