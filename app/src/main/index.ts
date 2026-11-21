/**
 * Electron main process: creates the two windows and wires senses → bus → agent → UI/haptics.
 * OWNER: D (windows), everyone reads it.
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron'
import type { Source, TapEvent, UiCommand } from '../shared/events'
import { IPC } from '../shared/events'
import { EventBus } from './bus'
import { Haptics } from './haptics'
import { Agent } from './agent/agent'
import { Llm } from './agent/llm'
import { AudioPipeline, createStt, onSttStatus } from './audio/pipeline'
import { runMock, startRecording } from './mock'
import { findName } from './detectors/text'
import { cleanText, MAX } from './agent/sanitize'
import { WinMic } from './audio/win-mic'
import { RoleState, roleFromConfig } from './agent/permissions'
import { HAPTIC_PATTERNS, makeEvent } from '../shared/events'

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
  sandbox: true
}

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

function sendUi(cmd: UiCommand): void {
  // Terminal trace of what the agent does (cards, haptics, decisions). TAP_DEBUG_AUDIO=0 silences it.
  if (process.env.TAP_DEBUG_AUDIO !== '0' && cmd.type !== 'COUNTERS' && cmd.type !== 'CAPTION') {
    if (cmd.type === 'LOG_ENTRY') {
      if (cmd.entry.kind !== 'event') console.log(`[agent] ${cmd.entry.kind}: ${cmd.entry.text}`)
    } else if (cmd.type === 'SHOW_RECAP') console.log(`[card] RECAP ${cmd.id}: ${cmd.summary}${cmd.question ? ` | QUESTION: ${cmd.question}` : ''}`)
    else if (cmd.type === 'SHOW_AWAY_SUMMARY') console.log(`[card] WHILE YOU WERE AWAY ${cmd.id} (${Math.round(cmd.until - cmd.away_from)} s, ${cmd.trigger}): ${cmd.summary}${cmd.question_to_you ? ` | QUESTION: ${cmd.question_to_you}` : ''}`)
    else if (cmd.type === 'SHOW_FIX') console.log(`[card] FIX: ${cmd.problem} → ${cmd.fix_label}`)
    else if (cmd.type === 'SHOW_NUDGE') console.log(`[card] NUDGE: ${cmd.text}${cmd.question ? ` | ${cmd.question}` : ''}`)
    else if (cmd.type === 'SHOW_NOTICE') console.log(`[card] NOTICE: ${cmd.text}`)
    else if (cmd.type === 'ROLE') console.log(`[ui] ROLE ${cmd.role} (IT view ${cmd.sees_it_view ? 'shown' : 'hidden'}, ${cmd.confidential ? 'confidential' : 'not confidential'})`)
    else console.log(`[ui] ${cmd.type}`)
  }
  for (const w of [mainWin, overlayWin]) if (w && !w.isDestroyed()) w.webContents.send(IPC.ui, cmd)
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
    }
  })
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
  app.on('before-quit', () => {
    audio.stop() // closes recordings cleanly
    winMic.stop()
  })
  // The Windows default mic, on every change → MIC_STATE (the agent's mic doctor uses it).
  winMic.watch((m) => {
    console.log(`[mic] default: ${m.kind} "${m.name}"${m.muted ? ' MUTED' : ''}, volume ${Math.round(m.volume * 100)} %${m.otherKind ? `, other mic: ${m.otherKind}` : ''}`)
    bus.publish(makeEvent('MIC_STATE', 'mic', { name: m.name, kind: m.kind, muted: m.muted, volume: m.volume, ...(m.otherKind ? { other_kind: m.otherKind } : {}) }))
  })

  ipcMain.on(IPC.event, (_e, ev: TapEvent) => {
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
