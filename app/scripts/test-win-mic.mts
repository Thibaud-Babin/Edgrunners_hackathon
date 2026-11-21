/**
 * OWNER: B. Real Windows test of the mic doctor's fixes, on THIS laptop's default mic:
 *   1. mute it in Windows → fix "unmute" → checked unmuted
 *   2. volume 15 % → fix "volume" → checked ≥ 75 %
 *   3. the watch reports every change (what the agent receives as MIC_STATE)
 * It restores the mic's original mute state and volume at the end. Your mic is muted for ~2 s.
 * Run: cd app && npx tsx scripts/test-win-mic.mts
 */
import { WinMic } from '../src/main/audio/win-mic.ts'

const m = new WinMic()
const ask = (cmd: string): Promise<Record<string, unknown>> => (m as unknown as { ask(c: string): Promise<Record<string, unknown>> }).ask(cmd)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const seen: string[] = []
let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failed++
}

const before = (await m.list()).find((x) => x.default)
if (!before) {
  console.log('No default mic found')
  process.exit(1)
}
console.log(`Default mic: ${before.kind} "${before.name}", muted ${before.muted}, volume ${Math.round(before.volume * 100)} %`)
m.watch((s) => seen.push(`${s.muted ? 'muted' : 'on'} ${Math.round(s.volume * 100)}%`), 400)
await sleep(800)

try {
  await ask(`mute ${before.id}`)
  await sleep(900)
  const r1 = await m.fix('unmute', before.kind)
  console.log(`  fix → ${r1.text}`)
  check(r1.ok && !(await m.list()).find((x) => x.id === before.id)!.muted, 'muted in Windows → "Unmute" fix unmutes it (checked)')

  await ask(`volume ${before.id} 0.15`)
  await sleep(900)
  const r2 = await m.fix('volume', before.kind)
  console.log(`  fix → ${r2.text}`)
  check(r2.ok && (await m.list()).find((x) => x.id === before.id)!.volume >= 0.75, 'volume 15 % → "Raise mic volume" fix sets it to 80 % (checked)')

  await sleep(900)
  check(seen.some((s) => s.startsWith('muted')) && seen.some((s) => s.endsWith('15%')), `the watch saw the changes (${seen.join(' → ')})`)
} finally {
  await ask(`volume ${before.id} ${before.volume}`)
  await ask(before.muted ? `mute ${before.id}` : `unmute ${before.id}`)
  const after = (await m.list()).find((x) => x.id === before.id)!
  console.log(`Restored: muted ${after.muted}, volume ${Math.round(after.volume * 100)} %`)
  m.stop()
}
process.exit(failed ? 1 : 0)
