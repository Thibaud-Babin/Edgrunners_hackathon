/**
 * OWNER: B. When a sentence is finished, from Deepgram's finished pieces (is_final).
 * Deepgram's own "speaker paused" signal (speech_final) can take 30 s in a monologue: until then nothing reached
 * captions, recaps or the summary ("looked back → nothing was said" while someone was talking the whole time).
 * So a sentence also ends at its own punctuation, or once it is long.
 */
export const MAX_SENTENCE_CHARS = 220

export function sentenceDone(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.length >= MAX_SENTENCE_CHARS) return true
  if (/(\.\.\.|…)$/.test(t)) return false // trailing off: the sentence goes on
  return /[.?!]["')\]]?$/.test(t)
}
