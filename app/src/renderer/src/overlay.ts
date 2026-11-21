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

const REPLY_MS = 3000
const MAX_TOASTS = 3
const DEDUPE_MS = 8000

type ToastKind = 'hero' | 'recap' | 'fix' | 'nudge' | 'reply'

function click(action_id: AllowedAction, args: Record<string, unknown> = {}): void {
  window.tap.emit(makeEvent('USER_CLICK', 'ui', { action_id, args }))
}

function removeToast(id: string): void {
  clearTimeout(toastTimers.get(id))
  toastTimers.delete(id)
  const queuedIndex = toastQueue.findIndex((item) => item.id === id)
  if (queuedIndex >= 0) {
    toastQueue.splice(queuedIndex, 1)
    return
  }
  const toast = document.getElementById(id)
  if (!toast) return
  toast.classList.add('out')
  setTimeout(() => {
    toast.remove()
    visibleToastIds.delete(id)
    visibleToasts.delete(id)
    showNextToast()
  }, 250)
  window.tap.setOverlayInteractive(false)
}

/** User pressed ✕ / Got it / Not now: tell the agent (it logs it and sends DISMISS back), and hide right away. */
function userDismiss(id: string): void {
  click('dismiss_card', { id })
  removeToast(id)
}

interface ToastOpts {
  id: string
  kind: ToastKind
  icon: string | SVGSVGElement
  title: string
  body: HTMLElement[]
  actions?: HTMLElement[]
  closable?: boolean
  autoDismissMs?: number
}

const priorities: Record<ToastKind, number> = { fix: 3, hero: 2, recap: 2, nudge: 1, reply: 0 }
const toastQueue: ToastOpts[] = []
const visibleToastIds = new Set<string>()
const visibleToasts = new Map<string, ToastOpts>()
const recentToasts = new Map<string, number>()
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

function toastSignature(o: ToastOpts): string {
  const detail = o.body.map((node) => node.textContent?.trim()).filter(Boolean).join('|')
  return `${o.kind}:${o.title.trim()}:${detail}`.toLocaleLowerCase()
}

function showNextToast(): void {
  if (visibleToastIds.size >= MAX_TOASTS || toastQueue.length === 0) return
  toastQueue.sort((a, b) => priorities[b.kind] - priorities[a.kind])
  renderToast(toastQueue.shift()!)
}

function addToast(o: ToastOpts): HTMLElement | null {
  const now = Date.now()
  const signature = toastSignature(o)
  for (const [key, timestamp] of recentToasts) if (now - timestamp >= DEDUPE_MS) recentToasts.delete(key)
  if (now - (recentToasts.get(signature) ?? 0) < DEDUPE_MS) return null
  recentToasts.set(signature, now)

  removeToast(o.id)
  if (visibleToastIds.size >= MAX_TOASTS) {
    const lowest = [...visibleToasts.values()].sort((a, b) => priorities[a.kind] - priorities[b.kind])[0]
    if (lowest && priorities[o.kind] > priorities[lowest.kind]) {
      toastQueue.push(lowest, o)
      removeToast(lowest.id)
      toastQueue.sort((a, b) => priorities[b.kind] - priorities[a.kind])
      return null
    }
    toastQueue.push(o)
    toastQueue.sort((a, b) => priorities[b.kind] - priorities[a.kind])
    return null
  }
  return renderToast(o)
}

function renderToast(o: ToastOpts): HTMLElement {

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
  visibleToastIds.add(o.id)
  visibleToasts.set(o.id, o)
  if (o.autoDismissMs) toastTimers.set(o.id, setTimeout(() => removeToast(o.id), o.autoDismissMs))
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

// ---------- live captions: last 3 lines; a partial line is replaced until it becomes final ----------
const captions = document.getElementById('captions')!
const CAPTIONS_KEY = 'tap:captions-enabled'
const MAX_CAPTIONS = 3
let partialLine: HTMLElement | null = null
let captionsVisible = true

function readCaptionsEnabled(): boolean {
  try {
    return localStorage.getItem(CAPTIONS_KEY) !== 'false'
  } catch {
    return true
  }
}

function syncCaptionPreference(): void {
  const enabled = readCaptionsEnabled()
  if (enabled === captionsVisible) return
  captionsVisible = enabled
  captions.toggleAttribute('hidden', !enabled)
  if (!enabled) {
    captions.replaceChildren()
    partialLine = null
  }
}

captionsVisible = readCaptionsEnabled()
captions.toggleAttribute('hidden', !captionsVisible)
window.addEventListener('storage', (event) => {
  if (event.key === CAPTIONS_KEY) syncCaptionPreference()
})
setInterval(syncCaptionPreference, 250)

function caption(text: string, final: boolean, speaker?: string, highlight?: string): void {
  if (!captionsVisible) return
  const line = partialLine ?? el('div', 'caption-line')
  line.replaceChildren()
  line.className = final ? 'caption-line' : 'caption-line partial'
  if (speaker) line.append(el('span', 'caption-speaker', `${speaker}: `))
  // textContent only (transcript is untrusted); highlight the name with <mark>
  const i = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1
  if (highlight && i >= 0) {
    line.append(document.createTextNode(text.slice(0, i)), el('mark', '', text.slice(i, i + highlight.length)), document.createTextNode(text.slice(i + highlight.length)))
  } else line.append(document.createTextNode(text))
  if (!partialLine) captions.append(line)
  partialLine = final ? null : line
  while (captions.children.length > MAX_CAPTIONS) captions.firstElementChild?.remove()
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
          // Optional second button from the agent (e.g. "I'm muted on purpose"), else "Not now".
          cmd.alt_label && cmd.alt_action_id
            ? button(cmd.alt_label, 'ghost', () => {
                click(cmd.alt_action_id!)
                removeToast(cmd.id)
              })
            : button('Not now', 'ghost', () => userDismiss(cmd.id))
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
        actions: [button('Got it', 'primary', () => userDismiss(cmd.id))],
        autoDismissMs: 12000
      })
      break
    case 'SHOW_REPLY': {
      const id = `reply-${Date.now()}`
      const bar = el('div', 'timer')
      bar.style.animationDuration = `${REPLY_MS}ms`
      addToast({ id, kind: 'reply', icon: checkIcon(), title: 'You answered', body: [el('div', 'reply-text', cmd.text), bar], closable: false, autoDismissMs: REPLY_MS })
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
      caption(cmd.text, cmd.final, cmd.speaker, cmd.highlight)
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
