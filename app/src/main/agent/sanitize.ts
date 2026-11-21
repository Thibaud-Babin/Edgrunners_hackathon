/**
 * OWNER: C. Cleans every piece of text that enters the agents (doc §2, rule 2).
 * Sanitising reduces noise; it is NOT the security boundary. Structure is: schemas, provenance, permissions.
 */

/** Length caps, in UTF-16 code units (the same unit zod's `.max()` counts). */
export const MAX = {
  transcriptChunk: 4000,
  speakerName: 60
} as const

// C0 + DEL + C1 control characters, except \n (U+000A), which we keep.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g
const ZERO_WIDTH = /[​-‍⁠﻿]/g
const BIDI = /[‪-‮⁦-⁩]/g

/**
 * NFKC-normalise, strip control / zero-width / bidi characters, collapse whitespace, cap the length.
 * Anything that is not a string becomes ''.
 */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== 'string') return ''
  const s = input
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(BIDI, '')
    .replace(/\r\n?|\t/g, (m) => (m === '\t' ? ' ' : '\n'))
    .replace(CONTROL, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return cap(s, max)
}

/** Cut to `max` code units without leaving half a surrogate pair at the end. */
function cap(s: string, max: number): string {
  if (s.length <= max) return s
  let out = s.slice(0, max)
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
  return out
}

/** Escape `<` and `>` so quoted text can never close (or open) the prompt's `<transcript>` tag. */
export function escapeTags(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Flags instruction-like speech so the log can say it was ignored (doc §2, rule 9).
 * FOR LOG MESSAGES ONLY: no decision may depend on this list. Speech can never trigger an action anyway.
 */
const INSTRUCTION_LIKE = [
  /\bignore\b.{0,30}\b(instructions?|rules|prompt|previous)\b/i,
  /\b(system prompt|you are now|new instructions|developer mode)\b/i,
  /\btap\b[\s,:]+(please\s+)?(reply|send|say|answer|post|unmute|mute|share|switch|click|raise|type|call)\b/i
]

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_LIKE.some((re) => re.test(text))
}
