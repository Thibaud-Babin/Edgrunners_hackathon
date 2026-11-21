/**
 * OWNER: D. The always-on-top overlay: a status pill plus cards over the meeting window.
 * The window ignores the mouse except while the cursor is over a card, so clicks reach Zoom/Teams underneath.
 * Renderer only: it draws UiCommands and reports the user's clicks as USER_CLICK events.
 */
import type { AllowedAction, UiCommand } from '../../shared/events'
import { makeEvent } from '../../shared/events'
import { el, fmtDuration, toPoints } from './ui/dom'
import { initTheme } from './ui/theme'

initTheme()

const cards = document.getElementById('cards')!
const flash = document.getElementById('flash')!
const pill = document.getElementById('pill')!
const pillStatus = document.getElementById('pill-status')!
const pillMeta = document.getElementById('pill-meta')!

const REPLY_MS = 3000

function click(action_id: AllowedAction, args: Record<string, unknown> = {}): void {
  window.tap.emit(makeEvent('USER_CLICK', 'ui', { action_id, args }))
}

function removeCard(id: string): void {
  const card = document.getElementById(id)
  if (!card) return
  card.classList.add('out')
  setTimeout(() => card.remove(), 200)
  window.tap.setOverlayInteractive(false)
}

/** User pressed ✕ / Got it: tell the agent (it logs it and sends DISMISS back), and hide right away. */
function userDismiss(id: string): void {
  click('dismiss_card', { id })
  removeCard(id)
}

interface CardOpts {
  id: string
  kind: 'hero' | 'recap' | 'fix' | 'reply'
  icon: string
  title: string
  sub?: string
  body: HTMLElement[]
  actions?: HTMLElement[]
  closable?: boolean
}

function addCard(o: CardOpts): HTMLElement {
  document.getElementById(o.id)?.remove()
  const card = el('div', `card ${o.kind}`)
  card.id = o.id
  const head = el('div', 'card-head')
  const titles = el('div')
  titles.append(el('div', 'card-title', o.title), ...(o.sub ? [el('div', 'card-sub', o.sub)] : []))
  head.append(el('span', 'ico', o.icon), titles)
  card.append(head, ...o.body)
  if (o.actions?.length) {
    const row = el('div', 'card-actions')
    row.append(...o.actions)
    card.append(row)
  }
  if (o.closable !== false) {
    const x = el('button', 'close', '✕')
    x.title = 'Dismiss'
    x.onclick = () => userDismiss(o.id)
    card.append(x)
  }
  card.onmouseenter = () => window.tap.setOverlayInteractive(true)
  card.onmouseleave = () => window.tap.setOverlayInteractive(false)
  cards.prepend(card)
  return card
}

function button(label: string, cls: string, fn: () => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label)
  b.onclick = fn
  return b
}

function question(label: string, text: string): HTMLElement[] {
  return [el('div', 'q-label', label), el('div', 'question', text)]
}

function points(summary: string, skip?: string): HTMLElement {
  const ul = el('ul', 'points')
  for (const p of toPoints(summary)) if (!skip || p.trim() !== skip.trim()) ul.append(el('li', '', p))
  return ul
}

function transcript(label: string, text: string, highlight?: string): HTMLElement {
  const d = el('details')
  const box = el('div', 'transcript')
  for (const line of text.split('\n').filter((l) => l.trim())) {
    box.append(el('div', highlight && line.includes(highlight.slice(0, 20)) ? 'q' : '', line))
  }
  d.append(el('summary', '', label), box)
  return d
}

// ---------- status pill (display only; derived from the agent's log) ----------
let awaySince: number | null = null
let awayTimer: ReturnType<typeof setInterval> | undefined
let knockTimer: ReturnType<typeof setTimeout> | undefined

function setAway(on: boolean): void {
  awaySince = on ? (awaySince ?? Date.now()) : null
  pill.classList.toggle('away', on)
  clearInterval(awayTimer)
  if (!on) {
    pillStatus.textContent = 'listening'
    pillStatus.className = ''
    return
  }
  pillStatus.className = 'away-timer'
  const tick = (): void => {
    pillStatus.textContent = `away · catching up ${fmtDuration((Date.now() - (awaySince ?? Date.now())) / 1000)}`
  }
  tick()
  awayTimer = setInterval(tick, 500)
}

function knock(label: string): void {
  document.getElementById('pill-knock')!.textContent = `🖱 ${label}`
  pill.classList.remove('knocking')
  void pill.offsetWidth
  pill.classList.add('knocking')
  clearTimeout(knockTimer)
  knockTimer = setTimeout(() => pill.classList.remove('knocking'), 2000)
}

// ---------- commands ----------
window.tap.onUi((cmd: UiCommand) => {
  switch (cmd.type) {
    case 'SHOW_AWAY_SUMMARY': {
      setAway(false)
      const q = cmd.question_to_you
      addCard({
        id: cmd.id,
        kind: 'hero',
        icon: cmd.trigger === 'name' ? '🔔' : '👋',
        title: cmd.trigger === 'name' ? 'You were called while away' : 'While you were away',
        sub: `${fmtDuration(cmd.until - cmd.away_from)} caught up`,
        body: [...(q ? question('Question to you', q) : []), points(cmd.summary, q), transcript('Full transcript', cmd.transcript, q)],
        actions: [button('Got it', 'primary', () => userDismiss(cmd.id)), el('span', 'hint', q ? 'nod = yes · shake = no' : '')]
      })
      break
    }
    case 'SHOW_RECAP':
      addCard({
        id: cmd.id,
        kind: 'recap',
        icon: '🔔',
        title: 'You were addressed',
        sub: 'last 10 seconds',
        body: [...(cmd.question ? question('Question', cmd.question) : []), points(cmd.summary, cmd.question), transcript('Last 10 seconds', cmd.transcript, cmd.question)],
        actions: cmd.question ? [el('span', 'hint', 'nod = yes · shake = no')] : []
      })
      break
    case 'SHOW_FIX':
      addCard({
        id: cmd.id,
        kind: 'fix',
        icon: '⚠️',
        title: 'Problem detected',
        body: [el('div', 'problem', cmd.problem)],
        actions: [
          button(cmd.fix_label, 'primary', () => {
            click(cmd.action_id)
            removeCard(cmd.id)
          }),
          button('Not now', 'ghost', () => userDismiss(cmd.id))
        ]
      })
      break
    case 'SHOW_REPLY': {
      const id = `reply-${Date.now()}`
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      check.setAttribute('viewBox', '0 0 24 24')
      check.setAttribute('class', 'check-anim')
      check.innerHTML = '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
      const card = addCard({ id, kind: 'reply', icon: '', title: 'You answered', body: [el('div', 'reply-text', cmd.text)], closable: false })
      card.querySelector('.ico')!.append(check)
      const bar = el('div', 'timer')
      bar.style.animationDuration = `${REPLY_MS}ms`
      card.append(bar)
      setTimeout(() => removeCard(id), REPLY_MS)
      break
    }
    case 'DISMISS':
      removeCard(cmd.id)
      break
    case 'FLASH':
      flash.classList.remove('on')
      void flash.offsetWidth // restart the animation
      flash.classList.add('on')
      break
    case 'LOG_ENTRY': {
      const t = cmd.entry.text
      if (cmd.entry.kind === 'event' && t.startsWith('USER_AWAY')) setAway(true)
      if (cmd.entry.kind === 'event' && t.startsWith('USER_BACK')) setAway(false)
      const h = /^send_haptic (\S+)/.exec(t)
      if (cmd.entry.kind === 'action' && h) knock(h[1].split('_')[0])
      break
    }
    case 'COUNTERS':
      pillMeta.textContent = `AI ${cmd.aiCalls} · $${cmd.costUsd.toFixed(4)}`
      break
  }
})
