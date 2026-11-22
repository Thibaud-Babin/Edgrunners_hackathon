/**
 * OWNER: B. "Is the user still in that Google Meet call?" from the Meet extension (extension/meet-names).
 * A clean end-of-meeting signal, better than guessing from silence (meetings.ts keeps the audio rules as a fallback
 * for Zoom / Teams / no extension):
 *   - the meeting code changes (meet.google.com/abc-defg-hij → another one) → the old meeting ended
 *   - in a call (tiles seen), then no tiles for LEFT_S → you left ("You left the meeting" screen)
 *   - in a call, then the extension sends nothing for GONE_S → the Meet tab was closed
 * Pure: the caller passes the time, so it is tested without waiting.
 */
export const LEFT_S = 8
export const GONE_S = 20

export type MeetEnd = { meeting: string; why: 'another meeting' | 'you left the call' | 'the Meet tab was closed' }

export class MeetPresence {
  private meeting: string | null = null // the call the user is in (tiles seen)
  private lastSeen = 0 // last update from the extension
  private emptySince: number | null = null

  /** An update from the extension. Returns the meeting that just ended, if any. */
  update(meeting: string, people: number, t: number): MeetEnd | null {
    this.lastSeen = t
    let ended: MeetEnd | null = null
    if (this.meeting && meeting && meeting !== this.meeting) {
      ended = { meeting: this.meeting, why: 'another meeting' }
      this.meeting = null
    }
    if (people > 0) {
      this.emptySince = null
      if (meeting) this.meeting = meeting
      return ended
    }
    if (this.meeting) {
      this.emptySince ??= t
      if (t - this.emptySince >= LEFT_S) {
        ended = { meeting: this.meeting, why: 'you left the call' }
        this.meeting = null
        this.emptySince = null
      }
    }
    return ended
  }

  /** Every few seconds: the extension went quiet while in a call → the tab was closed. */
  tick(t: number): MeetEnd | null {
    if (!this.meeting || t - this.lastSeen < GONE_S) return null
    const ended: MeetEnd = { meeting: this.meeting, why: 'the Meet tab was closed' }
    this.meeting = null
    this.emptySince = null
    return ended
  }

  get current(): string | null {
    return this.meeting
  }
}
