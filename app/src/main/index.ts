/**
 * Electron main process: creates the two windows and wires senses → bus → agent → UI/haptics.
 * OWNER: D (windows), everyone reads it.
 */
import './packaged-setup' // B: installed app → resources folder + %APPDATA%\Tap\.env (must stay first)
import 'dotenv/config'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron'
import type { Source, TapEvent, UiCommand } from '../shared/events'
import { IPC } from '../shared/events'
import { EventBus } from './bus'
import { Haptics } from './haptics'
import { Agent } from './agent/agent'
import { Llm } from './agent/llm'
import { summarizeCall } from './agent/call-summary'
import { DEFAULT_TIMES, Meetings } from './agent/meetings'
import { hapticSettings } from './agent/rules'
import { AudioPipeline, createStt, onSttStatus } from './audio/pipeline'
import { runMock, startRecording } from './mock'
import { findName } from './detectors/text'
import { cleanText, MAX } from './agent/sanitize'
import { WinMic } from './audio/win-mic'
import { RoleState, roleFromConfig } from './agent/permissions'
import { ItStats, parseCallReports, parseTicket, type ItStatsState, type TicketFile } from './agent/it-stats'
import { HAPTIC_PATTERNS, makeEvent } from '../shared/events'
import { SpeakerNames } from './audio/speaker-names'
import { others, startMeetBridge } from './audio/meet-bridge'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
const names = (process.env.TAP_USER_NAMES || 'Thibaud,Thibault,Tibo,Teebo').split(',').map((s) => s.trim())

let mainWin: BrowserWindow | null = null
let overlayWin: BrowserWindow | null = null

function load(win: BrowserWindow, page: 'index' | 'overlay'): void {
  if (isDev) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

const webPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // B (Sun 02:00): Tap must keep working behind Meet. Chromium paused the hidden/covered main window: the camera
  // loop measured 0 frames/s behind another window (no mouth, no away), timers ran at 1/s.
  backgroundThrottling: false
}
// Same reason, for windows Windows reports as covered ("occluded") or in the background.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')

function createWindows(): void {
  mainWin = new BrowserWindow({ width: 1100, height: 800, title: 'Tap', webPreferences })
  load(mainWin, 'index')

  // Overlay: transparent, frameless, always on top, click-through except over cards.
  // Deliberately VISIBLE in screen share and in the taskbar (no content protection) — Tap is not a stealth tool.
  const { workArea } = screen.getPrimaryDisplay()
  overlayWin = new BrowserWindow({
    width: 420,
    height: workArea.height,
    x: workArea.x + workArea.width - 420,
    y: workArea.y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences
  })
  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  overlayWin.setIgnoreMouseEvents(true, { forward: true })
  load(overlayWin, 'overlay')

  mainWin.on('closed', () => {
    mainWin = null
    overlayWin?.close()
  })
}

// B: IT console numbers (Nexthink). Observes what the agent shows; device facts and counts only. Kept across restarts.
let itStats: ItStats | null = null
let autoTicket: ((cardId: string, reason: string, key: string) => void) | null = null
const capture = { camera: false, mic: false, callAudio: false }

function sendUi(cmd: UiCommand): void {
  // The same problem for the 3rd time this week → the card says so and Tap sends IT a ticket by itself (it-stats.ts)
  let escalated: { id: string; reason: string; key: string } | null = null
  if (cmd.type === 'SHOW_FIX' && itStats) {
    const e = itStats.escalate(cmd)
    cmd = e.cmd
    if (e.auto) escalated = { id: cmd.id, ...e.auto }
  }
  itStats?.onUi(cmd)
  // Terminal trace of what the agent does (cards, haptics, decisions). TAP_DEBUG_AUDIO=0 silences it.
  if (process.env.TAP_DEBUG_AUDIO !== '0' && cmd.type !== 'COUNTERS' && cmd.type !== 'CAPTION' && cmd.type !== 'CUE' && cmd.type !== 'IT_STATS') {
    if (cmd.type === 'LOG_ENTRY') {
      if (cmd.entry.kind !== 'event') console.log(`[agent] ${cmd.entry.kind}: ${cmd.entry.text}`)
    } else if (cmd.type === 'SHOW_RECAP') console.log(`[card] RECAP ${cmd.id}: ${cmd.summary}${cmd.question ? ` | QUESTION: ${cmd.question}` : ''}`)
    else if (cmd.type === 'SHOW_AWAY_SUMMARY') console.log(`[card] WHILE YOU WERE AWAY ${cmd.id} (${Math.round(cmd.until - cmd.away_from)} s, ${cmd.trigger}): ${cmd.summary}${cmd.question_to_you ? ` | QUESTION: ${cmd.question_to_you}` : ''}`)
    else if (cmd.type === 'SHOW_FIX') console.log(`[card] FIX: ${cmd.problem} → ${cmd.fix_label}`)
    else if (cmd.type === 'CALL_SUMMARY') console.log(`[card] MEETING SUMMARY (${cmd.final ? 'meeting ended' : 'so far'}, ${cmd.from}, ${cmd.source}, ${cmd.minutes} min): ${cmd.points.length} points, ${cmd.questions_to_you.length} questions to you, ${cmd.your_tasks.length} tasks, ${cmd.decisions.length} decisions`)
    else if (cmd.type === 'SHOW_NUDGE') console.log(`[card] NUDGE: ${cmd.text}${cmd.question ? ` | ${cmd.question}` : ''}`)
    else if (cmd.type === 'SHOW_NOTICE') console.log(`[card] NOTICE: ${cmd.text}`)
    else if (cmd.type === 'ROLE') console.log(`[ui] ROLE ${cmd.role} (IT view ${cmd.sees_it_view ? 'shown' : 'hidden'}, ${cmd.confidential ? 'confidential' : 'not confidential'})`)
    else console.log(`[ui] ${cmd.type}`)
  }
  for (const w of [mainWin, overlayWin]) if (w && !w.isDestroyed()) w.webContents.send(IPC.ui, cmd)
  if (escalated) {
    const e = escalated
    setTimeout(() => autoTicket?.(e.id, e.reason, e.key), 0) // after the card is on screen
  }
}

app.whenReady().then(() => {
  // Call audio: getDisplayMedia() in the renderer gets the whole system output as loopback (Windows).
  // Same ~10-line pattern as the Electron docs. Fallback: electron-audio-loopback, or the Python sidecar.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' })
    })
  })

  const bus = new EventBus()
  // IT console: counts in userData/it-stats.json; tickets and call reports read from the simulated helpdesk.
  const dataDir = app.getPath('userData')
  const statsFile = join(dataDir, 'it-stats.json')
  let savedStats: ItStatsState | null = null
  try {
    if (existsSync(statsFile)) savedStats = JSON.parse(readFileSync(statsFile, 'utf8')) as ItStatsState
  } catch {
    savedStats = null
  }
  itStats = new ItStats(savedStats)
  const itSnapshot = () => {
    const ticketDir = join(dataDir, 'it-tickets')
    const tickets = existsSync(ticketDir)
      ? readdirSync(ticketDir).filter((f) => f.endsWith('.json')).map((f) => parseTicket(readFileSync(join(ticketDir, f), 'utf8'))).filter((t): t is TicketFile => t !== null)
      : []
    const logFile = join(dataDir, 'it-log', 'calls.jsonl')
    const reports = existsSync(logFile) ? parseCallReports(readFileSync(logFile, 'utf8')) : []
    return itStats!.snapshot(tickets, reports)
  }
  let itTimer: ReturnType<typeof setTimeout> | undefined
  const pushItStats = () => {
    clearTimeout(itTimer)
    itTimer = setTimeout(() => {
      try {
        writeFileSync(statsFile, JSON.stringify(itStats!.state))
        if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.ui, { type: 'IT_STATS', stats: itSnapshot() } satisfies UiCommand)
      } catch (e) {
        console.warn('[it] could not update the IT console:', e instanceof Error ? e.message : e)
      }
    }, 500)
  }
  itStats.onChange = pushItStats
  bus.on('USER_CLICK', (e: TapEvent) => itStats?.onEvent(e))
  const haptics = new Haptics(undefined, (reason) => console.warn('[haptics]', reason))
  const llm = new Llm()
  // B: Windows-level mic (state for the mic doctor, and the fixes a card names). Only a click runs a fix.
  const winMic = new WinMic()
  // The user's role comes from config only (company SSO in real life); missing/invalid → intern.
  // The UI may switch it only in dev builds (USER_SET_ROLE is ignored when packaged).
  const roles = new RoleState(roleFromConfig(process.env.TAP_USER_ROLE))
  const agent = new Agent(bus, sendUi, haptics, llm, names[0], {
    mic: winMic.available ? winMic : null,
    roles,
    allowRoleSwitch: !app.isPackaged,
    // Simulated helpdesk: tickets land as JSON in the app's data folder (outside the repo). No real IT system.
    tickets: {
      // Sync on purpose: one small file on a click. (fs/promises stalled late in a long mock run here.)
      send: async (t) => {
        const dir = join(app.getPath('userData'), 'it-tickets')
        mkdirSync(dir, { recursive: true })
        const file = join(dir, `${t.id}.json`)
        writeFileSync(file, JSON.stringify(t, null, 2))
        return { ok: true, where: file }
      }
    },
    // Simulated IT log: one JSON line per ended call (device facts only).
    itLog: {
      add: async (r) => {
        const dir = join(app.getPath('userData'), 'it-log')
        mkdirSync(dir, { recursive: true })
        const file = join(dir, 'calls.jsonl')
        appendFileSync(file, `${JSON.stringify(r)}\n`)
        return { ok: true, where: file }
      }
    }
  })
  autoTicket = agent.autoTicket
  // Settings → "Sound with each vibration": the overlay plays the sound when the vibration is actually sent.
  haptics.onFire = (waveform) => sendUi({ type: 'CUE', waveform })
  // Dev only: TAP_RECORD=1 records every event to demo/recordings/ (gitignored) for replay with TAP_MOCK_FILE.
  // B's recorder writes the call audio of the same session there too (audio/recorder.ts).
  // Never for confidential roles (executive, CEO): their meetings are not recorded.
  if (process.env.TAP_RECORD === '1' && !app.isPackaged) {
    if (roles.flags.confidential) console.log('[record] not recording: confidential role')
    else startRecording(bus, join(app.getAppPath(), '..', 'demo', 'recordings'))
  }
  // Speech engine status → activity panel. Lines from startup are replayed once the window has loaded.
  const sttStatus: string[] = []
  onSttStatus((text) => {
    console.log(`[stt] ${text}`)
    sttStatus.push(text)
    sendUi({ type: 'LOG_ENTRY', entry: { ts: Date.now() / 1000, kind: 'decision', text } })
  })
  const audio = new AudioPipeline(bus, names, createStt(process.env.TAP_STT || 'none'))
  // B: real names for Speaker 1, 2… from the Google Meet extension (extension/meet-names), on this laptop only
  const speakerNames = new SpeakerNames()
  audio.speakerNames = speakerNames
  const meetLog = (text: string): void => sendUi({ type: 'LOG_ENTRY', entry: { ts: Date.now() / 1000, kind: 'decision', text } })
  let meetWasConnected = false
  startMeetBridge((u) => {
    const changed = speakerNames.update(others(u))
    if (!meetWasConnected) meetLog(`Meet names: extension connected (meeting ${u.meeting || '?'})`)
    meetWasConnected = true
    if (changed) {
      const n = speakerNames.participants.length
      meetLog(`Meet names: ${n} other ${n === 1 ? 'person' : 'people'} in the call${n ? ` (${speakerNames.participants.join(', ')})` : ''}`)
    }
  }, meetLog)
  setInterval(() => {
    if (meetWasConnected && !speakerNames.connected) {
      meetWasConnected = false
      meetLog('Meet names: extension stopped sending (tab closed?) → back to Speaker 1, 2…')
    }
  }, 3000)
  // Live captions (accessibility): what the others say, shown in the overlay as they speak. Display only, no decision,
  // so it goes straight to the UI. The user's name is highlighted. D renders CAPTION in overlay.ts.
  for (const type of ['TRANSCRIPT_PARTIAL', 'TRANSCRIPT_FINAL'] as const) {
    bus.on(type, (e) => {
      if (e.source !== 'call_audio') return
      // Captions skip the agents, so they are cleaned here (sanitize.ts rule: all incoming text is cleaned).
      const text = cleanText(e.data?.text, MAX.transcriptChunk)
      const speaker = cleanText(e.data?.speaker, MAX.speakerName) || undefined
      sendUi({ type: 'CAPTION', text, final: type === 'TRANSCRIPT_FINAL', speaker, highlight: findName(text, names)?.word })
    })
  }
  // ---------- Meeting summaries (B, agent/meetings.ts + agent/call-summary.ts) ----------
  // Meet's "Leave call" is invisible to Tap, so meetings are split by the audio: goodbye + 15 s of silence ends one
  // (final summary), 2 min of silence gives a summary so far, speech after 5 min starts a new meeting. The
  // "Summarize" buttons (main window panel, overlay pill) summarize the current meeting at any time.
  // Summaries are saved on this laptop (userData/meeting-summaries.json) and shown again after a restart.
  const settings = { autoSummary: true }
  const summaryFile = join(app.getPath('userData'), 'meeting-summaries.json')
  const MAX_SAVED = 30
  const saved: Extract<UiCommand, { type: 'CALL_SUMMARY' }>[] = (() => {
    try {
      const list = JSON.parse(readFileSync(summaryFile, 'utf8')) as unknown
      return Array.isArray(list) ? (list.filter((x) => x && typeof x === 'object' && x.type === 'CALL_SUMMARY' && typeof x.id === 'string') as typeof saved) : []
    } catch {
      return []
    }
  })()
  const save = (cmd: Extract<UiCommand, { type: 'CALL_SUMMARY' }>): void => {
    const i = saved.findIndex((x) => x.id === cmd.id)
    if (i >= 0) saved.splice(i, 1)
    saved.push(cmd)
    while (saved.length > MAX_SAVED) saved.shift()
    try {
      mkdirSync(dirname(summaryFile), { recursive: true })
      writeFileSync(summaryFile, JSON.stringify(saved))
    } catch (err) {
      console.warn('[summary] could not save:', (err as Error).message)
    }
  }
  const meetings = new Meetings(async (call, final, from) => {
    if (!call.lines.length) {
      sendUi({ type: 'LOG_ENTRY', entry: { ts: Date.now() / 1000, kind: 'decision', text: 'Meeting summary: nothing was said in the call yet' } })
      const t = Date.now() / 1000
      sendUi({ type: 'CALL_SUMMARY', id: `${call.id}-empty`, started_at: t, ended_at: t, final: false, from, points: [], questions_to_you: [], your_tasks: [], decisions: [], source: 'template', minutes: 0, lines: 0 })
      return
    }
    const r = await summarizeCall(call, llm, names, { local: roles.flags.confidential })
    call.markSummarized()
    if (r.costUsd > 0) agent.recordAiCall(r.costUsd)
    const why = final ? 'meeting ended' : from === 'auto' ? 'call quiet for a while' : 'you asked'
    const how = r.source === 'cloud' ? 'AI' : `without AI (${r.fallback})`
    sendUi({ type: 'LOG_ENTRY', entry: { ts: Date.now() / 1000, kind: r.source === 'cloud' ? 'llm' : 'decision', text: `Meeting summary (${why}): ${r.minutes} min, ${r.points.length} talking points, ${r.questionsToYou.length} questions to you, ${r.yourTasks.length} tasks, ${r.decisions.length} decisions · ${how}`, ...(r.costUsd ? { costUsd: r.costUsd } : {}) } })
    const cmd: Extract<UiCommand, { type: 'CALL_SUMMARY' }> = { type: 'CALL_SUMMARY', id: call.id, started_at: call.startedAt, ended_at: call.endedAt, final, from, points: r.points, questions_to_you: r.questionsToYou, your_tasks: r.yourTasks, decisions: r.decisions, source: r.source, minutes: r.minutes, lines: r.lines }
    save(cmd)
    sendUi(cmd)
  }, {
    byeQuietS: Number(process.env.TAP_SUMMARY_AFTER_BYE_S ?? DEFAULT_TIMES.byeQuietS),
    quietS: Number(process.env.TAP_SUMMARY_AFTER_S ?? DEFAULT_TIMES.quietS),
    newMeetingGapS: Number(process.env.TAP_NEW_MEETING_AFTER_S ?? DEFAULT_TIMES.newMeetingGapS)
  })
  bus.on('TRANSCRIPT_FINAL', (e) => {
    if (e.source !== 'call_audio') return
    meetings.onLine(cleanText(e.data?.text, MAX.transcriptChunk), e.ts, cleanText(e.data?.speaker, MAX.speakerName) || undefined)
  })
  app.on('before-quit', () => {
    audio.stop() // closes recordings cleanly
    winMic.stop()
    meetings.stop()
  })
  // The Windows default mic, on every change → MIC_STATE (the agent's mic doctor uses it).
  winMic.watch((m) => {
    console.log(`[mic] default: ${m.kind} "${m.name}"${m.muted ? ' MUTED' : ''}, volume ${Math.round(m.volume * 100)} %${m.otherKind ? `, other mic: ${m.otherKind}` : ''}`)
    bus.publish(makeEvent('MIC_STATE', 'mic', { name: m.name, kind: m.kind, muted: m.muted, volume: m.volume, ...(m.otherKind ? { other_kind: m.otherKind } : {}) }))
  })

  ipcMain.on(IPC.event, (_e, ev: TapEvent) => {
    // Settings page (main window): the two settings the main process needs. The others stay in the UI.
    if (ev.type === 'SETTINGS' && ev.source === 'ui') {
      const extra = ev.data?.optional_haptics === true
      const auto = ev.data?.auto_summary !== false
      if (extra !== hapticSettings.optional || auto !== settings.autoSummary) console.log(`[settings] extra vibrations ${extra ? 'on' : 'off'} · summary when the call goes quiet ${auto ? 'on' : 'off'}`)
      hapticSettings.optional = extra
      settings.autoSummary = auto
      meetings.autoSummary = auto
      return
    }
    // Check-up Start/Stop → the overlay pill shows what Tap captures (the event also goes on to the monitor)
    if (ev.type === 'CAPTURE_STATE' && ev.source === 'ui') {
      const feed = ev.data?.feed
      if (feed === 'camera' || feed === 'mic' || feed === 'callAudio') capture[feed] = ev.data?.on === true
      sendUi({ type: 'CAPTURE', camera: capture.camera, mic: capture.mic, call_audio: capture.callAudio })
    }
    if (ev.type === 'IT_STATS_REQUEST' && ev.source === 'ui') {
      pushItStats()
      return
    }
    if (ev.type === 'CALL_SUMMARY_REQUEST' && ev.source === 'ui') {
      void meetings.request(ev.data?.from === 'overlay' ? 'overlay' : 'main')
      return
    }
    if (ev.type === 'OPEN_SUMMARY' && ev.source === 'ui') {
      if (mainWin && !mainWin.isDestroyed()) {
        if (mainWin.isMinimized()) mainWin.restore()
        mainWin.show()
        mainWin.focus()
        mainWin.webContents.send(IPC.ui, { type: 'OPEN_SUMMARY' } satisfies UiCommand)
      }
      return
    }
    // Check-up "Try the vibrations": the user learns the 4 signals. Fires only a known pattern, decides nothing.
    if (ev.type === 'HAPTIC_TEST' && ev.source === 'ui') {
      const key = String(ev.data?.pattern ?? '')
      const p = Object.hasOwn(HAPTIC_PATTERNS, key) ? HAPTIC_PATTERNS[key as keyof typeof HAPTIC_PATTERNS] : null
      if (!p) return
      void Promise.all(p.waveforms.map((w) => haptics.fire(w))).then((oks) => {
        const ok = oks.every(Boolean)
        console.log(`[haptic test] ${p.label}: ${p.waveforms.join(' + ')}${ok ? '' : ' (FAILED: is HapticWeb running?)'}`)
        sendUi({ type: 'LOG_ENTRY', entry: { ts: Date.now() / 1000, kind: ok ? 'action' : 'error', text: `Vibration test "${p.label}": ${p.waveforms.join(' + ')}${ok ? '' : ' failed (is HapticWeb running?)'}` } })
      })
      return
    }
    // Dev text box: typed "speech" goes through the same pipeline as real STT output.
    if (ev.type === 'TRANSCRIPT_FINAL' && ev.source === 'call_audio' && ev.data?.dev) {
      audio.onText('call_audio', String(ev.data.text ?? ''), true)
      return
    }
    bus.publish(ev)
  })
  ipcMain.on(IPC.audio, (_e, msg: { source: Source; pcm: ArrayBuffer }) => {
    audio.pushPcm(msg.source, new Int16Array(msg.pcm))
  })
  ipcMain.on(IPC.overlayMouse, (_e, interactive: boolean) => {
    overlayWin?.setIgnoreMouseEvents(!interactive, { forward: true })
  })

  createWindows()
  mainWin?.webContents.once('did-finish-load', () => {
    for (const text of sttStatus) sendUi({ type: 'LOG_ENTRY', entry: { ts: Date.now() / 1000, kind: 'decision', text } })
    agent.announceRole() // the UI learns the role once it can listen (shows or hides the IT view)
  })
  // Saved meeting summaries → the main window's Meeting Summary panel, oldest first (the panel puts the newest on top).
  mainWin?.webContents.on('did-finish-load', () => {
    for (const cmd of saved) mainWin?.webContents.send(IPC.ui, { ...cmd, from: 'restored' } satisfies UiCommand)
  })

  // Dev test: `npm run dev -- --autostart-call` clicks "Start call audio" by itself (for B's capture test).
  if (process.argv.includes('--autostart-call')) {
    mainWin?.webContents.once('did-finish-load', () => {
      void mainWin?.webContents.executeJavaScript("document.getElementById('btn-call').click()", true)
    })
  }
  // Dev test of the whole loop without a webcam: `npm run dev:e2e` also clicks the "Look away" fake button.
  if (process.argv.includes('--autostart-away')) {
    mainWin?.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void mainWin?.webContents.executeJavaScript(
          "[...document.querySelectorAll('#fake-buttons button')].find((b) => b.textContent === 'Look away')?.click()",
          true
        )
      }, 3000)
    })
  }

  if (process.argv.includes('--mock')) {
    const root = join(app.getAppPath(), '..')
    const file = resolve(root, process.env.TAP_MOCK_FILE || join('demo', 'mock-events.json'))
    mainWin?.webContents.once('did-finish-load', () => runMock(file, bus, audio, () => llm.stallNextCall()))
  }
})

app.on('window-all-closed', () => app.quit())
