/**
 * OWNER: D. The always-on-top overlay: a status pill plus Windows-style toast notifications over the meeting window.
 * The window ignores the mouse except while the cursor is over a toast, so clicks reach Zoom/Teams underneath.
 * Renderer only: it draws UiCommands and reports the user's clicks as USER_CLICK events.
 */
import type { AllowedAction, UiCommand } from '../../shared/events'
import { makeEvent } from '../../shared/events'
import { el, toPoints } from './ui/dom'
import { initTheme } from './ui/theme'
import { playCue, soundOn } from './ui/sound'

initTheme()

const toasts = document.getElementById('toasts')!
const flash = document.getElementById('flash')!
const pill = document.getElementById('pill')!
const pillStatus = document.getElementById('pill-status')!
const pillMeta = document.getElementById('pill-meta')!
// B: what Tap captures right now (Check-up Start/Stop). An off feed is shown crossed out.
let capture = { camera: false, mic: false, call_audio: false }
let pillAi = ''
function drawPillMeta(): void {
  const icon = (on: boolean, glyph: string, name: string): HTMLElement => {
    const s = el('span', on ? 'cap on' : 'cap off', glyph)
    s.title = `${name} ${on ? 'on' : 'off'}`
    return s
  }
  // The AI cost stays in the main window and the IT console: the pill is too narrow for it next to its buttons.
  pillMeta.replaceChildren(icon(capture.camera, '📷', 'Camera'), icon(capture.mic, '🎙', 'Mic'), icon(capture.call_audio, '🔊', 'Call audio'))
  pillMeta.title = pillAi
}
drawPillMeta()

const REPLY_MS = 3000
const MAX_TOASTS = 3
const DEDUPE_MS = 8000

type ToastKind = 'hero' | 'recap' | 'fix' | 'nudge' | 'reply'

function click(action_id: AllowedAction, args: Record<string, unknown> = {}): void {
  window.tap.emit(makeEvent('USER_CLICK', 'ui', { action_id, args }))
}

// ---------- click-through (B, Sun 03:00) ----------
// The overlay is an invisible strip down the right of the screen. It must take clicks ONLY over a card or the pill
// button; everywhere else clicks go to Meet / Tap's main window. It used to switch on mouseenter/mouseleave, and a
// card closing under the mouse never fired mouseleave: the strip then swallowed every click (summary panel's ✕,
// Meet's buttons). Now the mouse position decides, on every move (the window forwards moves while click-through).
let interactive = false
let mouseX = -1
let mouseY = -1
function refreshInteractive(): void {
  const over = mouseX >= 0 && !!document.elementFromPoint(mouseX, mouseY)?.closest('.toast:not(.out), .pill-btn')
  if (over !== interactive) {
    interactive = over
    document.body.dataset.interactive = String(over) // for tests
    window.tap.setOverlayInteractive(over)
  }
}
document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX
  mouseY = e.clientY
  refreshInteractive()
})
document.addEventListener('mouseleave', () => {
  mouseX = mouseY = -1
  refreshInteractive()
})

function removeToast(id: string): void {
  clearTimeout(toastTimers.get(id))
  toastTimers.delete(id)
  const queuedIndex = toastQueue.findIndex((item) => item.id === id)
  if (queuedIndex >= 0) toastQueue.splice(queuedIndex, 1)
  const toast = document.getElementById(id)
  if (!toast && !visibleToastIds.has(id)) return
  // B (Sun 02:00): the slot is freed NOW. It used to be freed inside the 250 ms fade-out timer, and a card that was
  // also queued was never hidden, so after a few cards the overlay believed 3 were visible forever and showed nothing.
  visibleToastIds.delete(id)
  visibleToasts.delete(id)
  if (toast) {
    toast.removeAttribute('id') // a new card may reuse this id while this one fades out
    toast.classList.add('out')
    setTimeout(() => (toast.remove(), refreshInteractive()), 250)
  }
  showNextToast()
  refreshInteractive() // the card under the mouse may just have gone
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
    // B (Sun 11:00, real call): a card less important than the 3 on screen used to wait in a hidden queue, so the
    // user felt the vibration and saw nothing (e.g. "while you were away" behind 3 mic cards). Now the newest card
    // always shows; the least important, oldest card on screen makes room (Map keeps insertion order; sort is stable).
    const lowest = [...visibleToasts.values()].sort((a, b) => priorities[a.kind] - priorities[b.kind])[0]
    toastQueue.length = 0
    if (lowest) removeToast(lowest.id)
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
  toasts.append(toast) // newest at the bottom, like Windows
  visibleToastIds.add(o.id)
  visibleToasts.set(o.id, o)
  if (o.autoDismissMs) toastTimers.set(o.id, setTimeout(() => removeToast(o.id), o.autoDismissMs))
  return toast
}

function button(label: string, cls: string, fn: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label)
  b.onclick = () => fn(b)
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

const CAPTION_IDLE_MS = 6000
let captionClear: ReturnType<typeof setTimeout> | undefined

function caption(text: string, final: boolean, speaker?: string, highlight?: string): void {
  if (!captionsVisible) return
  clearTimeout(captionClear)
  captionClear = setTimeout(() => {
    captions.replaceChildren()
    partialLine = null
  }, CAPTION_IDLE_MS)
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

// ---------- pill "Summary" button: summarize this meeting without leaving the call (B) ----------
const pillSummary = document.getElementById('pill-summary') as HTMLButtonElement
// B: "End call" → C's call report to the IT log (device facts only; CALL_ENDED must come from a click in the UI).
const pillEnd = document.getElementById('pill-end') as HTMLButtonElement
pillEnd.onclick = () => {
  window.tap.emit(makeEvent('CALL_ENDED', 'ui'))
  pillEnd.textContent = '…'
  pillEnd.disabled = true
}
/**
 * B: the automatic IT ticket, as one line inside its card (no extra card): "in 10 s… [Undo]", then sent / not sent.
 */
function itTicket(cmd: Extract<UiCommand, { type: 'IT_TICKET' }>): void {
  const card = document.getElementById(cmd.card_id)
  if (!card) return // the card was closed: the IT console still lists the ticket
  const note = card.querySelector<HTMLElement>('.it-note') ?? card.appendChild(el('div'))
  note.className = `it-note ${cmd.state}`
  const facts = ' Device facts only, nothing you said.'
  switch (cmd.state) {
    case 'pending': {
      const undo = el('button', 'it-undo', 'Undo')
      undo.onclick = () => {
        click('cancel_it_ticket', { id: cmd.card_id })
        undo.disabled = true
      }
      note.replaceChildren(el('span', '', `Tap will report this to IT in ${cmd.delay_s ?? 10} s: ${cmd.reason}.${facts} `), undo)
      break
    }
    case 'sent':
      note.replaceChildren(el('b', '', `✓ Ticket ${cmd.ref ?? ''} sent to IT${cmd.auto ? ' automatically' : ''}: ${cmd.reason}.`), document.createTextNode(`${facts} IT will contact you if needed.`))
      break
    case 'cancelled':
      note.textContent = 'Not sent to IT.'
      break
    case 'duplicate':
      note.textContent = `Already reported to IT today${cmd.ref ? ` (${cmd.ref})` : ''}: no new ticket.`
      break
    case 'failed':
      note.textContent = "Couldn't send the ticket to IT. If it keeps happening, tell IT yourself."
      break
  }
}

/** "End call" confirms on the button itself, only once main says the report was really saved. */
function itSent(cmd: Extract<UiCommand, { type: 'IT_SENT' }>): void {
  if (cmd.what !== 'call_report') return // tickets: IT_TICKET
  const b = pillEnd
  b.title = cmd.text
  b.textContent = cmd.ok ? '✓ Sent' : '✗ Not saved' // short: the pill is narrow (full text in the tooltip)
  setTimeout(() => {
    b.textContent = '⏹ End'
    b.disabled = false
  }, 3000)
}
pillSummary.onclick = () => {
  pillSummary.disabled = true
  pillSummary.textContent = '📝 Summarizing…'
  window.tap.emit(makeEvent('CALL_SUMMARY_REQUEST', 'ui', { from: 'overlay' }))
  setTimeout(() => {
    pillSummary.disabled = false
    pillSummary.textContent = '📝 Summary'
  }, 25000)
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
        actions: [button('Got it', 'primary', () => userDismiss(cmd.id)), button('Dismiss', 'ghost', () => userDismiss(cmd.id))],
        autoDismissMs: 90000
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
        actions: [button('Got it', 'primary', () => userDismiss(cmd.id)), button('Dismiss', 'ghost', () => userDismiss(cmd.id))],
        autoDismissMs: 90000
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
            : button('Not now', 'ghost', () => userDismiss(cmd.id)),
          // B: no "Send to IT" button: when the user can't fix it, Tap sends the ticket itself (IT_TICKET below)
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
    case 'CAPTURE':
      capture = { camera: cmd.camera, mic: cmd.mic, call_audio: cmd.call_audio }
      drawPillMeta()
      break
    case 'IT_TICKET':
      itTicket(cmd)
      break
    case 'IT_SENT':
      itSent(cmd)
      break
    case 'SHOW_NOTICE':
      // C's notices (e.g. IT ticket sent): they were silently dropped here.
      addToast({ id: cmd.id, kind: 'nudge', icon: 'ℹ', title: cmd.text, body: [], actions: [button('Got it', 'primary', () => removeToast(cmd.id))], autoDismissMs: 10000 })
      break
    case 'CUE':
      // Settings → "Sound with each vibration" (off by default): same signal, in the headphones.
      if (soundOn()) playCue(cmd.waveform)
      break
    case 'CALL_SUMMARY': {
      // The full summary lives in the main window (Meeting Summary). Here: a short "ready" card with the essentials,
      // for the automatic summary and the pill's button. Not when the user is already in the main window's panel.
      if (cmd.from !== 'auto' && cmd.from !== 'overlay') break
      pillSummary.disabled = false
      pillSummary.textContent = '📝 Summary'
      const toastId = `${cmd.id}-${Date.now()}`
      if (!cmd.lines) {
        addToast({ id: toastId, kind: 'nudge', icon: '📝', title: 'Nothing was said in the call yet', body: [el('p', '', 'Start call audio on the Check-up page so Tap can hear the call.')], actions: [button('Got it', 'primary', () => removeToast(toastId))], autoDismissMs: 8000 })
        break
      }
      const ul = el('ul', 'points')
      for (const q of cmd.questions_to_you.slice(0, 2)) ul.append(el('li', '', `Question to you: ${q}`))
      for (const t of cmd.your_tasks.slice(0, 2)) ul.append(el('li', '', `Your task: ${t}`))
      if (!ul.childElementCount) for (const p of cmd.points.slice(0, 3)) ul.append(el('li', '', p))
      addToast({
        id: toastId,
        kind: 'recap',
        icon: '📝',
        title: `${cmd.final ? 'Meeting summary ready' : 'Meeting summary so far'} · ${cmd.points.length} talking points`,
        body: ul.childElementCount ? [ul] : [],
        actions: [
          button('Open summary', 'primary', () => {
            window.tap.emit(makeEvent('OPEN_SUMMARY', 'ui', {}))
            removeToast(toastId)
          }),
          button('Later', 'ghost', () => removeToast(toastId))
        ],
        autoDismissMs: 30000
      })
      break
    }
    case 'COUNTERS':
      pillAi = `AI ${cmd.aiCalls} · $${(cmd.costUsd ?? 0).toFixed(4)}`
      drawPillMeta()
      break
    default:
      break // unknown / future command: ignore, never crash
  }
})
