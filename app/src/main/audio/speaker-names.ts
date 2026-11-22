/**
 * OWNER: B. Real names for "Speaker 1", "Speaker 2"… from Google Meet (extension/meet-names).
 *
 * The extension tells Tap, a few times a second, who is in the call and whose "speaking" indicator is on.
 * For each finished sentence we look at who Meet showed as speaking during it:
 *  - one person clearly speaking (most of the sentence, well ahead of anyone else) → that name, and one vote
 *    for "Speaker N = that name";
 *  - nobody clear (overlap, indicator lag) → the name Speaker N got from earlier votes (2+ votes, 2/3 agree);
 *  - otherwise "Speaker N", as before.
 * Names are what people typed in Meet: untrusted text, cleaned like speech (sanitize.ts).
 */
import { cleanText, MAX } from '../agent/sanitize.ts'

export interface MeetPerson {
  id: string
  name: string
  speaking: boolean
}

const PAD_MS = 500 // Meet's indicator lags / leads the sound a little
const CLEAR_SHARE = 0.4 // the top speaker covers at least this much of the sentence…
const CLEAR_LEAD = 1.5 // …and 1.5× more than the next one
const MIN_VOTES = 2
const AGREE = 2 / 3
const STALE_MS = 6000 // no update for this long → the extension is gone (tab closed)
const KEEP_MS = 5 * 60_000 // speaking history kept

export class SpeakerNames {
  private open = new Map<string, number>() // name → speaking since (ms)
  private spans: Array<{ name: string; from: number; to: number }> = []
  private votes = new Map<number, Map<string, number>>()
  private people: string[] = []
  private lastUpdate = 0

  private now: () => number
  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** One update from the extension (already validated). Returns true when the list of people changed. */
  update(people: MeetPerson[]): boolean {
    const t = this.now()
    this.lastUpdate = t
    const clean = people.map((p) => ({ name: cleanText(p.name, MAX.speakerName), speaking: p.speaking })).filter((p) => p.name)
    const speaking = new Set(clean.filter((p) => p.speaking).map((p) => p.name))
    for (const [name, from] of this.open) if (!speaking.has(name)) (this.spans.push({ name, from, to: t }), this.open.delete(name))
    for (const name of speaking) if (!this.open.has(name)) this.open.set(name, t)
    this.spans = this.spans.filter((s) => s.to > t - KEEP_MS)
    const names = [...new Set(clean.map((p) => p.name))].sort()
    const changed = names.join('\n') !== this.people.join('\n')
    this.people = names
    return changed
  }

  get connected(): boolean {
    return this.lastUpdate > 0 && this.now() - this.lastUpdate < STALE_MS
  }

  get participants(): readonly string[] {
    return this.connected ? this.people : []
  }

  /**
   * The label for a finished sentence heard from `fromMs` to `toMs` (wall clock), diarized as `speaker` (0, 1…)
   * if the engine gave one. Undefined = no better label than before.
   */
  label(speaker: number | undefined, fromMs: number, toMs: number): string | undefined {
    const fallback = speaker !== undefined ? `Speaker ${speaker + 1}` : undefined
    if (!this.lastUpdate) return fallback
    const t = this.now()
    if (t - this.lastUpdate >= STALE_MS) for (const [name, from] of this.open) (this.spans.push({ name, from, to: this.lastUpdate }), this.open.delete(name))
    const a = fromMs - PAD_MS
    const b = Math.max(toMs, fromMs) + PAD_MS
    const len = b - a
    const overlap = new Map<string, number>()
    const add = (name: string, from: number, to: number): void => {
      const o = Math.min(b, to) - Math.max(a, from)
      if (o > 0) overlap.set(name, (overlap.get(name) ?? 0) + o)
    }
    for (const s of this.spans) add(s.name, s.from, s.to)
    for (const [name, from] of this.open) add(name, from, t)
    const ranked = [...overlap].sort((x, y) => y[1] - x[1])
    const [top, second] = ranked
    const clear = top && top[1] >= CLEAR_SHARE * len && top[1] >= CLEAR_LEAD * (second?.[1] ?? 0) ? top[0] : undefined
    if (clear && speaker !== undefined) {
      const v = this.votes.get(speaker) ?? new Map<string, number>()
      v.set(clear, (v.get(clear) ?? 0) + 1)
      this.votes.set(speaker, v)
    }
    return clear ?? (speaker !== undefined ? this.nameOf(speaker) : undefined) ?? fallback
  }

  /** The name Speaker N got from earlier sentences, once enough of them agree. */
  nameOf(speaker: number): string | undefined {
    const v = this.votes.get(speaker)
    if (!v) return undefined
    let total = 0
    let best: [string, number] | undefined
    for (const e of v) {
      total += e[1]
      if (!best || e[1] > best[1]) best = e
    }
    return best && best[1] >= MIN_VOTES && best[1] >= AGREE * total ? best[0] : undefined
  }
}
