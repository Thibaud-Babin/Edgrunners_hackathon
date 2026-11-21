import type { EventType, TapEvent } from '../shared/events.ts'
import { now } from '../shared/events.ts'
import type { AgentName, Envelope, Kind, PayloadOf, Provenance } from './agent/schemas.ts'
import { EnvelopeBase, KINDS } from './agent/schemas.ts'

type Handler = (e: TapEvent) => void

/** Tiny in-process event bus. Every event from every producer goes through here. */
export class EventBus {
  private handlers = new Map<EventType | '*', Handler[]>()

  on(type: EventType | '*', h: Handler): void {
    const list = this.handlers.get(type) ?? []
    list.push(h)
    this.handlers.set(type, list)
  }

  publish(e: TapEvent): void {
    for (const h of [...(this.handlers.get(e.type) ?? []), ...(this.handlers.get('*') ?? [])]) {
      try {
        h(e)
      } catch (err) {
        console.error('[bus] handler failed for', e.type, err)
      }
    }
  }
}

// ---------- agent bus ----------
// The four agents hand off ONLY through this bus. Every envelope is validated on publish:
// the envelope shape, the payload schema registered for its kind, and the provenances that kind may carry.

type EnvHandler = (env: Envelope<unknown>) => void

export class AgentBus {
  private handlers = new Map<Kind | '*', EnvHandler[]>()
  private seq = 0
  /** Called with a short reason whenever an envelope is dropped. */
  onInvalid: (reason: string) => void = () => {}

  on<K extends Kind>(kind: K, h: (env: Envelope<PayloadOf<K>>) => void): void
  on(kind: '*', h: (env: Envelope<unknown>) => void): void
  on(kind: Kind | '*', h: (env: Envelope<never>) => void): void {
    const list = this.handlers.get(kind) ?? []
    list.push(h as EnvHandler)
    this.handlers.set(kind, list)
  }

  /** Returns false (and drops the message) if anything about it is invalid. */
  publish<K extends Kind>(from: AgentName, provenance: Provenance, kind: K, payload: PayloadOf<K>): boolean {
    const raw: unknown = { id: `env-${++this.seq}`, ts: now(), from, provenance, kind, payload }
    const env = EnvelopeBase.safeParse(raw)
    if (!env.success) return this.invalid(`bad envelope for "${String(kind)}"`)
    const spec = KINDS[env.data.kind as Kind] as (typeof KINDS)[Kind] | undefined
    if (!spec) return this.invalid(`unknown kind "${env.data.kind}"`)
    if (!(spec.provenance as readonly Provenance[]).includes(env.data.provenance))
      return this.invalid(`"${env.data.kind}" cannot carry provenance "${env.data.provenance}"`)
    const body = spec.schema.safeParse(env.data.payload)
    if (!body.success) return this.invalid(`bad "${env.data.kind}" payload`)
    // Handlers get the parsed copy, never the publisher's object.
    const clean: Envelope<unknown> = { ...env.data, payload: body.data }
    for (const h of [...(this.handlers.get(env.data.kind as Kind) ?? []), ...(this.handlers.get('*') ?? [])]) {
      try {
        h(clean)
      } catch (err) {
        console.error('[agent-bus] handler failed for', env.data.kind, err)
      }
    }
    return true
  }

  private invalid(reason: string): false {
    this.onInvalid(reason)
    return false
  }
}
