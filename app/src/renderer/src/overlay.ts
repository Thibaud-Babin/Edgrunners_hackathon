/**
 * OWNER: D. The always-on-top overlay: shows cards over the meeting window.
 * The window ignores the mouse except while the cursor is over a card.
 */
import type { UiCommand } from '../../shared/events'
import { makeEvent } from '../../shared/events'

const cards = document.getElementById('cards')!
const flash = document.getElementById('flash')!
// Live captions strip (bottom of the overlay). Added by B as a plain version; D: restyle freely.
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

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  if (text) e.textContent = text
  return e
}

function addCard(id: string, title: string, body: HTMLElement[], actions: Array<[string, () => void]> = []): void {
  const card = el('div', 'card')
  card.id = id
  card.append(el('div', 'card-title', title), ...body)
  const row = el('div', 'card-actions')
  for (const [label, fn] of [...actions, ['Dismiss', () => dismiss(id)] as [string, () => void]]) {
    const b = el('button', '', label)
    b.onclick = fn
    row.append(b)
  }
  card.append(row)
  // Catch clicks only while the cursor is over a card; otherwise clicks go to Zoom underneath.
  card.onmouseenter = () => window.tap.setOverlayInteractive(true)
  card.onmouseleave = () => window.tap.setOverlayInteractive(false)
  cards.prepend(card)
}

function dismiss(id: string): void {
  document.getElementById(id)?.remove()
  window.tap.setOverlayInteractive(false)
}

function details(label: string, text: string): HTMLElement {
  const d = document.createElement('details')
  d.append(el('summary', '', label), el('pre', 'transcript', text))
  return d
}

window.tap.onUi((cmd: UiCommand) => {
  switch (cmd.type) {
    case 'SHOW_RECAP':
      addCard(cmd.id, 'You were addressed', [
        ...(cmd.question ? [el('div', 'question', cmd.question)] : []),
        el('div', 'summary', cmd.summary),
        details('Last 10 seconds', cmd.transcript)
      ])
      break
    case 'SHOW_AWAY_SUMMARY': {
      const secs = Math.round(cmd.until - cmd.away_from)
      addCard(cmd.id, cmd.trigger === 'name' ? `You were called — while you were away (${secs} s)` : `While you were away (${secs} s)`, [
        ...(cmd.question_to_you ? [el('div', 'question', `Question to you: ${cmd.question_to_you}`)] : []),
        el('div', 'summary', cmd.summary),
        details('Full transcript', cmd.transcript)
      ])
      break
    }
    case 'SHOW_FIX':
      addCard(cmd.id, cmd.problem, [], [
        [
          cmd.fix_label,
          () => {
            window.tap.emit(makeEvent('USER_CLICK', 'ui', { action_id: cmd.action_id }))
            dismiss(cmd.id)
          }
        ]
      ])
      break
    case 'SHOW_NUDGE':
      addCard(cmd.id, cmd.text, cmd.question ? [el('div', 'question', cmd.question)] : [])
      setTimeout(() => dismiss(cmd.id), 12000)
      break
    case 'CAPTION':
      showCaption(cmd.text, cmd.final, cmd.speaker, cmd.highlight)
      break
    case 'DISMISS':
      dismiss(cmd.id)
      break
    case 'FLASH':
      flash.classList.remove('on')
      void flash.offsetWidth // restart the animation
      flash.classList.add('on')
      break
  }
})
