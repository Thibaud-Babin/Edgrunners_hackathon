/**
 * OWNER: B. Splits the call audio into meetings and decides when to summarize (end-of-call summary).
 *
 *   - Goodbye ("bye", "thanks everyone", "see you"…) as the last thing said, then BYE_QUIET_S (15 s) of silence → the meeting is over:
 *     final summary, and the next speech starts a NEW meeting (fresh transcript).
 *   - No goodbye, but QUIET_S (120 s) of silence → a summary "so far"; the meeting stays open (a long pause is not
 *     always the end).
 *   - Speech again after NEW_MEETING_GAP_S (5 min) of silence → the previous meeting is closed first (summarized if
 *     it has unsummarized speech), then a new one starts.
 *   - "Summarize" buttons (main window panel, overlay pill) → summary of the current meeting so far.
 * Tap cannot see Meet's "Leave call" button (another app): with the Meet extension, end() is called when you leave
 * or open another meeting (meet-presence.ts); these audio rules are the fallback (Zoom, Teams, no extension).
 * With Settings → "Summary when the call goes quiet" off, nothing is summarized by itself; meetings still split.
 */
import { CallTranscript } from './call-summary.ts'

export type SummaryFrom = 'auto' | 'main' | 'overlay'

export interface MeetingTimes {
  byeQuietS: number
  quietS: number
  newMeetingGapS: number
}

export const DEFAULT_TIMES: MeetingTimes = { byeQuietS: 15, quietS: 120, newMeetingGapS: 300 }
/** The automatic summary needs a real conversation, not two stray words. */
const MIN_LINES_AUTO = 3

export class Meetings {
  private call = new CallTranscript()
  private timer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<void> = Promise.resolve()
  autoSummary = true
  private run: (call: CallTranscript, final: boolean, from: SummaryFrom) => Promise<void>
  private times: MeetingTimes

  constructor(run: (call: CallTranscript, final: boolean, from: SummaryFrom) => Promise<void>, times: MeetingTimes = DEFAULT_TIMES) {
    this.run = run
    this.times = times
  }

  get current(): CallTranscript {
    return this.call
  }

  /** A final line of call speech. */
  onLine(text: string, ts: number, speaker?: string): void {
    if (!text.trim()) return
    if (this.call.lines.length && ts - this.call.endedAt > this.times.newMeetingGapS) this.close('auto')
    this.call.add(text, ts, speaker)
    this.arm()
  }

  /**
   * B: a clean signal that the meeting is over (Google Meet: another meeting, you left, tab closed; meet-presence.ts):
   * final summary now, and the next speech starts a fresh meeting. Returns false when there was nothing to end.
   */
  end(): boolean {
    if (!this.call.lines.length) return false
    this.close('auto')
    return true
  }

  /** A "Summarize" button: the current meeting so far. It keeps going. */
  request(from: 'main' | 'overlay'): Promise<void> {
    return this.enqueue(this.call, false, from)
  }

  /** Wait until every queued summary is done (tests, quitting). */
  idle(): Promise<void> {
    return this.queue
  }

  stop(): void {
    clearTimeout(this.timer)
  }

  private arm(): void {
    clearTimeout(this.timer)
    const c = this.call
    // The goodbye must be the LAST thing said: "Bye Marie!" followed by more talk is someone leaving, not the end.
    const bye = c.goodbyeAt > 0 && c.goodbyeAt === c.endedAt
    const wait = bye ? this.times.byeQuietS : this.times.quietS
    if (wait <= 0) return
    this.timer = setTimeout(() => {
      if (!this.autoSummary || c !== this.call || c.lines.length < MIN_LINES_AUTO) return
      if (bye) this.close('auto')
      else if (c.newLines > 0) void this.enqueue(c, false, 'auto')
    }, wait * 1000)
  }

  /** The meeting is over: summarize what was not summarized yet, and start a fresh one. */
  private close(from: SummaryFrom): void {
    clearTimeout(this.timer)
    const old = this.call
    this.call = new CallTranscript()
    if (this.autoSummary && old.newLines > 0 && old.lines.length >= MIN_LINES_AUTO) void this.enqueue(old, true, from)
  }

  private enqueue(call: CallTranscript, final: boolean, from: SummaryFrom): Promise<void> {
    this.queue = this.queue.then(() => this.run(call, final, from)).catch((err) => console.warn('[summary]', err))
    return this.queue
  }
}
