/**
 * OWNER: B. The IT console's numbers (Nexthink track), from what Tap already does. Read-only observer:
 * it watches the UI commands the agent sends (cards, log lines, counters) and the user's clicks. It never
 * changes a decision, and it stores device facts and counts only: no transcript, no names, no summaries.
 *
 * - Problems: each fix card is one problem. Type from the card; "caught before anyone noticed" vs "a coworker
 *   reported it" from the agent's reason; time lost = card shown → fix clicked and checked.
 * - Fixes: per fix button, how often clicked and how often Windows confirmed it ("(checked)").
 * - Agent trust: actions, blocked requests with their reason, misfires (fix cards dismissed with "Not now"),
 *   "muted on purpose" (alert not needed), AI calls and cost.
 * - Tickets and call reports: read from the simulated helpdesk files by index.ts, flagged when a problem repeats.
 */
import type { CallReportFile, ItSnapshot, TapEvent, TicketFile, UiCommand } from '../../shared/events.ts'

export type { CallReportFile, ItSnapshot, TicketFile }

export interface ProblemRec {
  at: number
  type: string
  reported: boolean | null // null = not known yet
  fixedAt: number | null
  /** Ticket sent for it (id), if any */
  ticket?: string
  /** The user clicked "I'm muted on purpose": not a problem (not counted, never escalated) */
  onPurpose?: boolean
}

export interface ItStatsState {
  since: number
  problems: ProblemRec[]
  fixes: Record<string, { used: number; checked: number; failed: number }>
  misfires: number
  notNeeded: number
  actions: number
  blocked: { at: number; text: string }[]
  blockedCount: number
  aiCalls: number
  costUsd: number
  /** Why each ticket was sent (ticket id → reason), shown to IT */
  ticketReasons?: Record<string, string>
}

const WEEK_S = 7 * 24 * 3600
/** The same problem this many times in a week → the card also offers IT (a device problem, not a slip). */
export const REPEAT_FOR_TICKET = 3

const MAX_BLOCKED = 20
const MAX_PROBLEMS = 500

export function emptyState(now: number): ItStatsState {
  return { since: now, problems: [], fixes: {}, misfires: 0, notNeeded: 0, actions: 0, blocked: [], blockedCount: 0, aiCalls: 0, costUsd: 0 }
}

/** Problem type from the fix card (its button names the fix; the text names the rest). */
export function problemType(problem: string, fixLabel: string): string {
  const p = problem.toLowerCase()
  if (/^unmute/i.test(fixLabel)) return 'Mic muted in Windows'
  if (/^raise mic volume/i.test(fixLabel)) return 'Mic volume too low'
  if (p.includes('muted in meet')) return 'Muted in the call app (Meet)'
  if (/^switch to/i.test(fixLabel) || p.includes('sends no sound') || p.includes('silent')) return 'Mic sends no sound'
  if (p.includes('quality') || p.includes('move closer') || p.includes('too quiet') || p.includes('noisy')) return 'Poor mic quality'
  if (p.includes('camera')) return 'Camera problem'
  return 'Other device problem'
}

export class ItStats {
  state: ItStatsState
  onChange: (() => void) | null = null
  private fixCards = new Map<string, number>() // card id → index in problems
  private lastFixLabel = ''
  private cardText = new Map<string, string>() // card id → its text (for the ticket's reason)
  private now: () => number

  constructor(state: ItStatsState | null, now: () => number = () => Date.now() / 1000) {
    this.now = now
    this.state = state ?? emptyState(now())
  }

  /** Everything the agent sends to the UI passes here first (index.ts sendUi). */
  onUi(cmd: UiCommand): void {
    const s = this.state
    const t = this.now()
    switch (cmd.type) {
      case 'SHOW_FIX': {
        // The follow-up card of a failed fix is the same problem, not a new one
        if (cmd.problem.startsWith("Tap couldn't fix it")) {
          if (s.problems.length) this.fixCards.set(cmd.id, s.problems.length - 1)
          this.cardText.set(cmd.id, cmd.problem)
          break
        }
        this.cardText.set(cmd.id, cmd.problem)
        s.problems.push({ at: t, type: problemType(cmd.problem, cmd.fix_label), reported: null, fixedAt: null })
        if (s.problems.length > MAX_PROBLEMS) s.problems.splice(0, s.problems.length - MAX_PROBLEMS)
        this.fixCards.set(cmd.id, s.problems.length - 1)
        break
      }
      case 'LOG_ENTRY': {
        const { kind, text } = cmd.entry
        if (kind === 'action') s.actions++
        // Refusals: the gate's blocks, and spoken instructions ignored (prompt injection by voice). The spoken words
        // are never stored, only a fixed line.
        const refused = kind === 'blocked' ? text : kind === 'decision' && text.startsWith('Instruction-like speech ignored') ? 'Spoken instruction in the call ignored: speech can never trigger an action' : null
        if (refused) {
          s.blockedCount++
          s.blocked.push({ at: t, text: refused })
          if (s.blocked.length > MAX_BLOCKED) s.blocked.shift()
        }
        const shown = /^(.*) → fix card shown \("(.*?)";/.exec(text)
        if (kind === 'action' && shown) {
          const last = s.problems[s.problems.length - 1]
          if (last && last.reported === null) last.reported = /others cannot hear you/i.test(shown[1]!)
        }
        // Mic fix result, written by the executor from Windows' answer
        const fix = /^You clicked the fix → (.*)$/.exec(text)
        if (fix) {
          const label = this.lastFixLabel || 'Mic fix'
          const f = (s.fixes[label] ??= { used: 0, checked: 0, failed: 0 })
          f.used++
          if (kind === 'action' && /\(checked\)|switched to/.test(fix[1]!)) f.checked++
          if (kind === 'error') f.failed++
          if (kind === 'action') {
            const open = [...s.problems].reverse().find((p) => p.fixedAt === null)
            if (open) open.fixedAt = t
          }
        }
        if (kind === 'decision' && /^Mic problem fixed (after a coworker reported it|before anyone noticed)/.test(text)) {
          const open = [...s.problems].reverse().find((p) => p.reported === null || p.fixedAt === null)
          if (open && open.reported === null) open.reported = text.includes('coworker')
        }
        break
      }
      case 'IT_SENT': {
        if (cmd.what !== 'ticket' || !cmd.ok || !cmd.ref) return
        const idx = cmd.card_id ? this.fixCards.get(cmd.card_id) : undefined
        if (idx !== undefined && s.problems[idx]) s.problems[idx]!.ticket = cmd.ref
        ;(s.ticketReasons ??= {})[cmd.ref] = ticketReason(cmd.card_id ? (this.cardText.get(cmd.card_id) ?? '') : '')
        break
      }
      case 'COUNTERS':
        s.aiCalls = cmd.aiCalls
        s.costUsd = cmd.costUsd
        break
      default:
        return
    }
    this.onChange?.()
  }

  /**
   * Before a fix card is shown (index.ts): the same problem for the 3rd time this week → also offer IT, and say why.
   * Returns the card to show (unchanged otherwise).
   */
  escalate(cmd: Extract<UiCommand, { type: 'SHOW_FIX' }>): Extract<UiCommand, { type: 'SHOW_FIX' }> {
    if (cmd.it_ticket || cmd.problem.startsWith("Tap couldn't fix it")) return cmd
    const type = problemType(cmd.problem, cmd.fix_label)
    const t = this.now()
    const n = this.state.problems.filter((p) => !p.onPurpose && p.type === type && t - p.at < WEEK_S).length + 1
    if (n < REPEAT_FOR_TICKET) return cmd
    return { ...cmd, it_ticket: true, problem: `${cmd.problem} · ${ordinal(n)} time this week: this may be a device problem.` }
  }

  /** The user's clicks on the cards (TapEvent USER_CLICK from the overlay). */
  onEvent(ev: TapEvent): void {
    if (ev.type !== 'USER_CLICK' || ev.source !== 'ui') return
    const action = ev.data?.action_id
    const args = (ev.data?.args ?? {}) as { id?: unknown }
    if (action === 'dismiss_card' && typeof args.id === 'string' && this.fixCards.has(args.id)) this.state.misfires++
    else if (action === 'snooze_mic_alerts') {
      this.state.notNeeded++
      const idx = [...this.fixCards.values()].pop()
      const p = idx !== undefined ? this.state.problems[idx] : undefined
      if (p && p.fixedAt === null) p.onPurpose = true
    }
    else if (action === 'fix_mic' || action === 'switch_input_device') {
      // Remember which button it was: the result line follows
      const idx = [...this.fixCards.values()].pop()
      this.lastFixLabel = idx !== undefined ? fixLabelFor(this.state.problems[idx]?.type) : 'Mic fix'
      if (action === 'switch_input_device') this.lastFixLabel = 'Switch mic'
    } else return
    this.onChange?.()
  }

  snapshot(tickets: TicketFile[], reports: CallReportFile[]): ItSnapshot {
    const s = this.state
    const problems = s.problems.filter((p) => !p.onPurpose)
    const fixed = problems.filter((p) => p.fixedAt !== null)
    const durations = fixed.map((p) => p.fixedAt! - p.at).sort((a, b) => a - b)
    const solved = problems.filter((p) => p.fixedAt !== null && !p.ticket).length
    const reasons = s.ticketReasons ?? {}
    const types = new Map<string, number>()
    for (const p of problems) types.set(p.type, (types.get(p.type) ?? 0) + 1)
    return {
      since: new Date(s.since * 1000).toISOString(),
      tiles: {
        caught: problems.length,
        beforeNoticed: problems.filter((p) => p.reported === false).length,
        reported: problems.filter((p) => p.reported === true).length,
        fixed: fixed.length,
        secondsLost: Math.round(durations.reduce((a, b) => a + b, 0)),
        medianFixS: durations.length ? Math.round(durations[Math.floor(durations.length / 2)]!) : null,
        solvedWithoutTicket: solved
      },
      byType: [...types].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      fixes: Object.entries(s.fixes).map(([label, f]) => ({ label, ...f })),
      agent: {
        actions: s.actions,
        blockedCount: s.blockedCount,
        blocked: s.blocked.slice().reverse().map((b) => ({ at: new Date(b.at * 1000).toISOString(), text: b.text })),
        misfires: s.misfires,
        notNeeded: s.notNeeded,
        aiCalls: s.aiCalls,
        costUsd: s.costUsd
      },
      tickets: tickets.map((k) => ({ ...k, reason: reasons[k.id] ?? 'sent by the user' })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      reports: reports.slice().sort((a, b) => b.endedAt.localeCompare(a.endedAt)),
      recurring: recurring(reports)
    }
  }
}

/** Why a ticket was sent, from the card it was sent from. Shown to IT next to the ticket. */
export function ticketReason(cardText: string): string {
  const rep = /(\d+)(st|nd|rd|th) time this week/.exec(cardText)
  if (rep) return `same problem ${rep[1]} times this week`
  if (cardText.startsWith("Tap couldn't fix it")) return 'the one-click fix failed'
  if (/still .* after switching/i.test(cardText)) return 'still bad after switching mics'
  if (/sends no sound\. Check its cable/i.test(cardText)) return 'no other mic to switch to'
  return 'sent by the user'
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

function fixLabelFor(type: string | undefined): string {
  if (type === 'Mic muted in Windows') return 'Unmute mic'
  if (type === 'Mic volume too low') return 'Raise mic volume'
  if (type === 'Mic sends no sound') return 'Switch mic'
  return 'Mic fix'
}

const PROBLEM_NAME: Record<string, string> = {
  cant_hear: 'Coworkers could not hear the user',
  video_reported: 'Coworkers said the video froze',
  camera_frozen: 'Camera image froze',
  face_out: 'Face out of frame',
  low_light: 'Room too dark for the camera',
  mic_silent: 'Mic sent no sound while talking'
}
const PROBLEM_HINT: Record<string, string> = {
  cant_hear: 'Audio keeps failing in calls: check the default mic, its driver, or the headset.',
  video_reported: 'Video keeps freezing: check the network and the camera driver.',
  camera_frozen: 'Camera keeps freezing: often a USB / driver problem or another app holding it.',
  face_out: 'Camera badly placed: suggest a better position or a stand.',
  low_light: 'Room too dark: a desk light or the camera exposure setting would help.',
  mic_silent: 'Mic keeps going silent: check the headset, its cable or Bluetooth, or the audio driver.'
}
const nameOf = (key: string): string => PROBLEM_NAME[key] ?? (key.startsWith('mic_') ? `Mic quality: ${key.slice(4).replace(/_/g, ' ')}` : key.replace(/_/g, ' '))
const hintOf = (key: string): string => PROBLEM_HINT[key] ?? (key.startsWith('mic_') ? 'Mic quality keeps degrading: a better headset, or closer to the mic.' : 'Repeats across calls: worth a look by IT.')

/** A problem in at least 2 of the last 5 call reports → flag it for IT, with a first hint. */
export function recurring(reports: CallReportFile[]): ItSnapshot['recurring'] {
  const last = reports.slice().sort((a, b) => b.endedAt.localeCompare(a.endedAt)).slice(0, 5)
  const n = new Map<string, number>()
  for (const r of last) for (const p of new Set(r.problems)) n.set(p, (n.get(p) ?? 0) + 1)
  return [...n]
    .filter(([, c]) => c >= 2)
    .map(([key, calls]) => ({ problem: nameOf(key), calls, of: last.length, hint: hintOf(key) }))
    .sort((a, b) => b.calls - a.calls)
}

/** Parse the simulated helpdesk files (index.ts reads them). Bad lines are skipped. */
export function parseTicket(json: string): TicketFile | null {
  try {
    const t = JSON.parse(json) as { id?: string; createdAt?: string; priority?: string; requesterRole?: string }
    if (typeof t.id !== 'string') return null
    return { id: t.id, createdAt: t.createdAt ?? '', priority: t.priority ?? 'normal', requesterRole: t.requesterRole ?? '', json }
  } catch {
    return null
  }
}
export function parseCallReports(jsonl: string): CallReportFile[] {
  const out: CallReportFile[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as { id?: string; endedAt?: string; priority?: string; diagnostics?: { problems?: { key: string }[]; fixesApplied?: string[] } | null }
      if (typeof r.id !== 'string') continue
      out.push({
        id: r.id,
        endedAt: r.endedAt ?? '',
        priority: r.priority ?? 'log',
        problems: (r.diagnostics?.problems ?? []).map((p) => p.key),
        fixes: r.diagnostics?.fixesApplied?.length ?? 0,
        json: JSON.stringify(r, null, 2)
      })
    } catch {
      /* skip a bad line */
    }
  }
  return out
}
