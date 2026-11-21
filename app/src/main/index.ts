/**
 * Electron main process: creates the two windows and wires senses → bus → agent → UI/haptics.
 * OWNER: D (windows), everyone reads it.
 */
import 'dotenv/config'
import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron'
import type { Source, TapEvent, UiCommand } from '../shared/events'
import { IPC } from '../shared/events'
import { EventBus } from './bus'
import { Haptics } from './haptics'
import { Agent } from './agent/agent'
import { Llm } from './agent/llm'
import { AudioPipeline, createStt } from './audio/pipeline'
import { runMock } from './mock'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
const names = (process.env.TAP_USER_NAMES || 'Thibaud,Thibault,Tibo').split(',').map((s) => s.trim())

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
  new Agent(bus, sendUi, haptics, new Llm(), names[0])
  const audio = new AudioPipeline(bus, names, createStt(process.env.TAP_STT || 'none'))

  ipcMain.on(IPC.event, (_e, ev: TapEvent) => {
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

  if (process.argv.includes('--mock')) {
    const file = join(app.getAppPath(), '..', 'demo', 'mock-events.json')
    mainWin?.webContents.once('did-finish-load', () => runMock(file, bus, audio))
  }
})

app.on('window-all-closed', () => app.quit())
