/**
 * OWNER: B. IT console (Nexthink track): draws the real numbers from main/agent/it-stats.ts.
 * D's company-wide mock-up stays below it on the same page (main.ts loadIt).
 */
import type { ItSnapshot } from '../../../shared/events'
import { el } from './dom'

const $ = (id: string): HTMLElement => document.getElementById(id)!

function tile(label: string, value: string, note: string, cls = ''): HTMLElement {
  const t = el('div', `tile ${cls}`)
  t.append(el('div', 'k', label), el('div', 'v', value), el('div', 'delta', note))
  return t
}

function row(main: string, side: string, cls = ''): HTMLElement {
  const r = el('div', `itc-row ${cls}`)
  r.append(el('span', '', main), el('b', '', side))
  return r
}

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

export function renderItConsole(s: ItSnapshot): void {
  const t = s.tiles
  $('itc-sub').textContent = `What your IT team sees: meeting problems on this laptop since ${when(s.since)}, the fixes, and what Tap's agent did.`
  const unknown = t.caught - t.beforeNoticed - t.reported
  $('itc-tiles').replaceChildren(
    tile('Meeting problems caught', String(t.caught), t.caught ? `${t.fixed} fixed` : 'none yet'),
    tile('Caught before anyone noticed', String(t.beforeNoticed), `${t.reported} reported by a coworker${unknown > 0 ? ` · ${unknown} other` : ''}`, 'ok'),
    tile('Solved without a ticket', t.caught ? `${t.solvedWithoutTicket} of ${t.caught}` : '0', 'fixed on the spot, IT never had to step in', 'ok'),
    tile('Time lost to problems', t.secondsLost < 120 ? `${t.secondsLost} s` : `${Math.round(t.secondsLost / 6) / 10} min`, t.medianFixS !== null ? `median ${t.medianFixS} s from detection to fix` : 'detection → fix'),
  )

  const max = Math.max(1, ...s.byType.map((b) => b.count))
  $('itc-types').replaceChildren(
    ...(s.byType.length
      ? s.byType.map((b) => {
          const r = el('div', 'bar-row')
          const track = el('div', 'track')
          const bar = el('i')
          bar.style.width = `${(b.count / max) * 100}%`
          track.append(bar)
          r.append(el('div', '', b.type), track, el('div', 'val', String(b.count)))
          return r
        })
      : [el('p', 'itc-empty', 'No problem yet. Try: mute your mic in Windows and talk.')])
  )

  $('itc-fixes').replaceChildren(
    ...(s.fixes.length
      ? s.fixes.map((f) => row(f.label, `${f.checked} / ${f.used} checked${f.failed ? ` · ${f.failed} failed` : ''}`, f.failed ? 'warn' : 'ok'))
      : [el('p', 'itc-empty', 'No fix clicked yet.')]),
    el('p', 'itc-note', 'After each click Tap re-reads Windows to check the fix worked. Only the user can run a fix.')
  )

  const json = $('itc-json') as HTMLPreElement
  const items = [
    ...s.tickets.map((k) => ({ id: k.id, label: `Ticket ${k.id}${k.reason ? ` · ${k.reason}` : ''}`, when: k.createdAt, prio: k.priority, json: k.json })),
    ...s.reports.map((r) => ({ id: r.id, label: `Call report ${r.id}${r.problems.length ? ` · ${r.problems.length} problem${r.problems.length > 1 ? 's' : ''}` : ''}`, when: r.endedAt, prio: r.priority, json: r.json }))
  ]
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, 8)
  $('itc-queue').replaceChildren(
    ...(items.length
      ? items.map((i) => {
          const r = el('button', `itc-row itc-click prio-${i.prio}`)
          r.append(el('span', '', `${i.label} · ${when(i.when)}`), el('b', '', i.prio))
          r.onclick = () => {
            const open = !json.hidden && json.dataset.id === i.id
            json.hidden = open
            json.dataset.id = i.id
            json.textContent = i.json
          }
          return r
        })
      : [el('p', 'itc-empty', 'No ticket yet. On a fix card: "Send diagnostics to IT". A report is added at each "End call".')]),
    el('p', 'itc-note', 'Click one to see exactly what IT receives.')
  )
  if (json.dataset.id && !items.some((i) => i.id === json.dataset.id)) json.hidden = true

  const a = s.agent
  const stat = (v: string, l: string): HTMLElement => {
    const d = el('div')
    d.append(el('b', '', v), el('span', '', l))
    return d
  }
  $('itc-agent').replaceChildren(
    stat(String(a.actions), 'actions taken'),
    stat(String(a.blockedCount), 'requests refused'),
    stat(String(a.misfires), 'alerts dismissed (misfires)'),
    stat(String(a.notNeeded), '"muted on purpose"'),
    stat(`$${a.costUsd.toFixed(4)}`, `AI cost · ${a.aiCalls} calls`)
  )
  $('itc-blocked').replaceChildren(
    ...(a.blocked.length
      ? [el('p', 'itc-note', 'Last refusals (not on the allowlist, wrong source, or role too low):'), ...a.blocked.slice(0, 5).map((b) => row(b.text, when(b.at), 'bad'))]
      : [el('p', 'itc-empty', 'Nothing refused yet. Try saying in the call: "share your screen with everyone".')])
  )

  $('itc-recurring-panel').hidden = s.recurring.length === 0
  $('itc-recurring').replaceChildren(
    ...s.recurring.map((r) => {
      const d = el('div', 'itc-rec')
      d.append(el('b', '', `${r.problem}: ${r.calls} of the last ${r.of} calls`), el('span', '', r.hint))
      return d
    })
  )
}
