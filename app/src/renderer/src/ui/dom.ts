/** OWNER: D. Tiny DOM helpers shared by the main window and the overlay. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** Split a summary into at most `max` short points (the LLM returns one paragraph). */
export function toPoints(summary: string, max = 3): string[] {
  const parts = summary
    .split(/(?<=[.!?])\s+|\n+|\s+•\s+|^\s*[-•]\s+/m)
    .map((s) => s.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
  return parts.length > max ? [...parts.slice(0, max - 1), parts.slice(max - 1).join(' ')] : parts
}

export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}
