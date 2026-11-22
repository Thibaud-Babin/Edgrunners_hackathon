/**
 * OWNER: B. Local receiver for the Google Meet extension (extension/meet-names): who is in the call and who is
 * speaking. Listens on 127.0.0.1 only. Accepts only our extension: the browser sets the Origin header itself
 * (a web page cannot fake it), and our extension has a fixed id (the public "key" in its manifest).
 * Nothing is sent back; nothing is saved. Names are cleaned in speaker-names.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import type { MeetPerson } from './speaker-names.ts'

export const MEET_PORT = Number(process.env.TAP_MEET_PORT) || 47811
export const MEET_EXTENSION_ID = 'gakbaekmaofiakidfecnepknjjgbjike'
const MAX_BODY = 32 * 1024

export const MeetUpdate = z
  .object({
    v: z.literal(1),
    meeting: z.string().max(64),
    people: z
      .array(z.object({ id: z.string().max(200), name: z.string().max(200), speaking: z.boolean(), self: z.boolean() }).strict())
      .max(100)
  })
  .strict()
export type MeetUpdate = z.infer<typeof MeetUpdate>

/** Pure check of one request (tested). */
export function acceptMeet(origin: string | undefined, contentType: string | undefined, body: string, extensionId = MEET_EXTENSION_ID): { ok: true; update: MeetUpdate } | { ok: false; status: number; why: string } {
  if (origin !== `chrome-extension://${extensionId}`) return { ok: false, status: 403, why: 'not the Tap Meet extension' }
  if (!contentType?.startsWith('application/json')) return { ok: false, status: 415, why: 'JSON only' }
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return { ok: false, status: 400, why: 'bad JSON' }
  }
  const r = MeetUpdate.safeParse(json)
  return r.success ? { ok: true, update: r.data } : { ok: false, status: 400, why: 'not a Meet update' }
}

/** The other people (not you) for the matcher. */
export function others(u: MeetUpdate): MeetPerson[] {
  return u.people.filter((p) => !p.self).map(({ id, name, speaking }) => ({ id, name, speaking }))
}

export function startMeetBridge(onUpdate: (u: MeetUpdate) => void, log: (text: string) => void): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin
    if (req.method === 'OPTIONS') {
      // Preflight: only our extension gets the CORS answer
      if (origin === `chrome-extension://${MEET_EXTENSION_ID}`) {
        res.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type' })
      } else res.writeHead(403)
      return res.end()
    }
    if (req.method !== 'POST' || req.url !== '/meet') return res.writeHead(404).end()
    let body = ''
    let tooBig = false
    req.on('data', (c: Buffer) => {
      body += c
      if (body.length > MAX_BODY) {
        tooBig = true
        req.destroy()
      }
    })
    req.on('end', () => {
      if (tooBig) return
      const r = acceptMeet(origin, req.headers['content-type'], body)
      if (!r.ok) {
        res.writeHead(r.status).end(r.why)
        return
      }
      onUpdate(r.update)
      res.writeHead(204, { 'Access-Control-Allow-Origin': origin! }).end()
    })
  })
  server.on('error', (e) => log(`Meet names: could not listen on 127.0.0.1:${MEET_PORT} (${(e as Error).message})`))
  server.listen(MEET_PORT, '127.0.0.1')
  return server
}
