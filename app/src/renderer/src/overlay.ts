/**
 * OWNER: D. The always-on-top overlay: a status pill plus Windows-style toast notifications over the meeting window.
 * The window ignores the mouse except while the cursor is over a toast, so clicks reach Zoom/Teams underneath.
 * Renderer only: it draws UiCommands and reports the user's clicks as USER_CLICK events.
 */
import type { AllowedAction, UiCommand } from '../../shared/events'
import { makeEvent } from '../../shared/events'
import { el, toPoints } from './ui/dom'
import { initTheme } from './ui/theme'

initTheme()

const toasts = document.getElementById('toasts')!
const flash = document.getElementById('flash')!
const pill = document.getElementById('pill')!
const pillStatus = document.getElementById('pill-status')!
const pillMeta = document.getElementById('pill-meta')!

// Live captions strip (bottom of the overlay). Renderer from B's version, restyled.
const captions = document.getElementById('captions')!
const finalLines: HTMLElement[] = []
let partialLine: HTMLElement | null = null

/** One caption line; the user's name (highlight) is wrapped in <mark>. Text only, never innerHTML. */
function captionLine(text: string, speaker?: string, highlight?: string): HTMLElement {
  const line = el('div', 'caption-line')
  if (speaker) line.append(el('span', 'caption-speaker', `${speaker}: `))
  const i = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1
  if (i < 0 || !highlight) line.append(document.createTextNode(text))
  else {
    const mark = document.createElement('mark')
    mark.textContent = text.slice(i, i + highlight.length)
    line.append(document.createTextNode(text.slice(0, i)), mark, document.createTextNode(text.slice(i + highlight.length)))
  }
  return line
}

function showCaption(text: string, final: boolean, speaker?: string, highlight?: string): void {
  const line = captionLine(text, speaker, highlight)
  partialLine?.remove()
  partialLine = null
  if (final) {
    finalLines.push(line)
    captions.append(line)
    while (finalLines.length > 3) finalLines.shift()?.remove() // keep the last 3 sentences
  } else {
    line.classList.add('partial')
    partialLine = line
    captions.append(line)
  }
}

const REPLY_MS = 3000
const MAX_TOASTS = 3

function click(action_id: AllowedAction, args: Record<string, unknown> = {}): void {
  window.tap.emit(makeEvent('USER_CLICK', 'ui', { action_id, args }))
}

function removeToast(id: string): void {
  const toast = document.getElementById(id)
  if (!toast) return
  toast.classList.add('out')
  setTimeout(() => toast.remove(), 250)
  window.tap.setOverlayInteractive(false)
}

/** User pressed ✕ / Got it / Not now: tell the agent (it logs it and sends DISMISS back), and hide right away. */
function userDismiss(id: string): void {
  click('dismiss_card', { id })
  removeToast(id)
}

interface ToastOpts {
  id: string
  kind: 'hero' | 'recap' | 'fix' | 'nudge' | 'reply'
  icon: string | SVGSVGElement
  title: string
  body: HTMLElement[]
  actions?: HTMLElement[]
  closable?: boolean
}

function addToast(o: ToastOpts): HTMLElement {
  document.getElementById(o.id)?.remove()
  while (toasts.children.length >= MAX_TOASTS) {
    const first = toasts.firstElementChild as HTMLElement | null
    if (!first?.id) break
    removeToast(first.id)
  }

  const toast = el('div', `toast ${o.kind}`)
  toast.id = o.id

  const head = el('div', 't-head')
  const app = el('span', 't-app')
  app.append(el('span', 'logo', 'T'), document.createTextNode('Tap · now'))
  const ctrl = el('span', 't-ctrl')
  const dots = el('button', 'dots', '⋯')
  dots.title = 'More'
  ctrl.append(dots)
  if (o.closable !== false) {
    const x = el('button', 'close', '✕')
    x.title = 'Dismiss'
    x.onclick = () => userDismiss(o.id)
    ctrl.append(x)
  }
  head.append(app, ctrl)

  const tile = el('span', 't-tile')
  if (typeof o.icon === 'string') tile.textContent = o.icon
  else tile.append(o.icon)
  const content = el('div', 't-content')
  content.append(el('div', 't-title', o.title), ...o.body)
  const body = el('div', 't-body')
  body.append(tile, content)

  toast.append(head, body)
  if (o.actions?.length) {
    const row = el('div', 't-actions')
    row.append(...o.actions)
    toast.append(row)
  }
  toast.onmouseenter = () => window.tap.setOverlayInteractive(true)
  toast.onmouseleave = () => window.tap.setOverlayInteractive(false)
  toasts.append(toast) // newest at the bottom, like Windows
  return toast
}

function button(label: string, cls: string, fn: () => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label)
  b.onclick = fn
  return b
}

function question(text: string): HTMLElement {
  return el('div', 'question', `“${text}”`)
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

function gestureHint(): HTMLElement {
  return el('div', 'hint', 'nod = yes · shake = no')
}

// ---------- status pill (display only; derived from the agent's log) ----------
let awaySince: number | null = null
let awayTimer: ReturnType<typeof setInterval> | undefined
let knockTimer: ReturnType<typeof setTimeout> | undefined

function setAway(on: boolean): void {
  if (on === (awaySince !== null)) return // already in this state, keep counting
  awaySince = on ? Date.now() : null
  pill.classList.toggle('away', on)
  clearInterval(awayTimer)
  if (!on) {
    pillStatus.textContent = 'Listening'
    pillStatus.className = ''
    return
  }
  pillStatus.className = 'away-timer'
  const tick = (): void => {
    const s = Math.max(0, Math.floor((Date.now() - (awaySince ?? Date.now())) / 1000))
    pillStatus.textContent = `Away · catching up ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  tick()
  awayTimer = setInterval(tick, 250)
}

function knock(label: string): void {
  document.getElementById('pill-knock')!.textContent = `🖱 ${label}`
  pill.classList.remove('knocking')
  void pill.offsetWidth
  pill.classList.add('knocking')
  clearTimeout(knockTimer)
  knockTimer = setTimeout(() => pill.classList.remove('knocking'), 1500)
}

function checkIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'check-anim')
  svg.innerHTML = '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
  return svg
}

// ---------- commands ----------
window.tap.onUi((cmd: UiCommand) => {
  switch (cmd.type) {
    case 'SHOW_AWAY_SUMMARY': {
      setAway(false)
      const q = cmd.question_to_you
      addToast({
        id: cmd.id,
        kind: 'hero',
        icon: cmd.trigger === 'name' ? '🔔' : '👋',
        title: `While you were away · ${Math.round(cmd.until - cmd.away_from)} s`,
        body: [...(q ? [question(q)] : []), ...(cmd.summary ? [points(cmd.summary, q)] : []), ...(cmd.transcript ? [transcript('Full transcript', cmd.transcript, q)] : []), ...(q ? [gestureHint()] : [])],
        actions: [button('Got it', 'primary', () => userDismiss(cmd.id)), button('Dismiss', 'ghost', () => userDismiss(cmd.id))]
      })
      break
    }
    case 'SHOW_RECAP':
      addToast({
        id: cmd.id,
        kind: 'recap',
        icon: '🔔',
        title: 'You were addressed',
        body: [...(cmd.question ? [question(cmd.question)] : []), ...(cmd.summary ? [points(cmd.summary, cmd.question)] : []), ...(cmd.transcript ? [transcript('Last 10 seconds', cmd.transcript, cmd.question)] : []), ...(cmd.question ? [gestureHint()] : [])],
        actions: [button('Got it', 'primary', () => userDismiss(cmd.id)), button('Dismiss', 'ghost', () => userDismiss(cmd.id))]
      })
      break
    case 'SHOW_FIX':
      addToast({
        id: cmd.id,
        kind: 'fix',
        icon: '⚠',
        title: cmd.problem,
        body: [],
        actions: [
          button(cmd.fix_label, 'primary', () => {
            click(cmd.action_id)
            removeToast(cmd.id)
          }),
          button('Not now', 'ghost', () => userDismiss(cmd.id))
        ]
      })
      break
    case 'SHOW_NUDGE':
      addToast({
        id: cmd.id,
        kind: 'nudge',
        icon: '❗',
        title: cmd.text,
        body: cmd.question ? [question(cmd.question)] : [],
        actions: [button('Got it', 'primary', () => userDismiss(cmd.id))]
      })
      setTimeout(() => removeToast(cmd.id), 12000)
      break
    case 'SHOW_REPLY': {
      const id = `reply-${Date.now()}`
      const toast = addToast({ id, kind: 'reply', icon: checkIcon(), title: 'You answered', body: [el('div', 'reply-text', cmd.text)], closable: false })
      const bar = el('div', 'timer')
      bar.style.animationDuration = `${REPLY_MS}ms`
      toast.append(bar)
      setTimeout(() => removeToast(id), REPLY_MS)
      break
    }
    case 'SHOW_REPLIES':
      addToast({
        id: cmd.id,
        kind: 'recap',
        icon: '💬',
        title: 'Quick replies',
        body: cmd.question ? [question(cmd.question)] : [],
        actions: [
          ...cmd.replies.slice(0, 3).map((r) =>
            button(r, 'primary', () => {
              click('speak_reply', { text: r })
              removeToast(cmd.id)
            })
          ),
          button('Dismiss', 'ghost', () => userDismiss(cmd.id))
        ]
      })
      break
    case 'CAPTION':
      showCaption(cmd.text, cmd.final, cmd.speaker, cmd.highlight)
      break
    case 'DISMISS':
      removeToast(cmd.id)
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
      pillMeta.textContent = `📷 🎙 · AI ${cmd.aiCalls} · $${(cmd.costUsd ?? 0).toFixed(4)}`
      break
    default:
      break // unknown / future command: ignore, never crash
  }
})
