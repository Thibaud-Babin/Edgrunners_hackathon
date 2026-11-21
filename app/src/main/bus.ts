import type { EventType, TapEvent } from '../shared/events'

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
