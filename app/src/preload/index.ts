/** The only bridge between the UI windows and the main process. Exposed as window.tap */
import { contextBridge, ipcRenderer } from 'electron'
import type { Source, TapEvent, UiCommand } from '../shared/events'

// Inlined (not imported) so the sandboxed preload stays a single file.
const IPC = { event: 'tap:event', ui: 'tap:ui', audio: 'tap:audio', overlayMouse: 'tap:overlay-mouse' }

const api = {
  emit: (e: TapEvent): void => ipcRenderer.send(IPC.event, e),
  onUi: (cb: (cmd: UiCommand) => void): void => {
    ipcRenderer.on(IPC.ui, (_e, cmd: UiCommand) => cb(cmd))
  },
  sendAudio: (source: Source, pcm: ArrayBuffer): void => ipcRenderer.send(IPC.audio, { source, pcm }),
  setOverlayInteractive: (interactive: boolean): void => ipcRenderer.send(IPC.overlayMouse, interactive)
}

export type TapApi = typeof api
contextBridge.exposeInMainWorld('tap', api)
