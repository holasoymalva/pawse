import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PawseApi } from '../shared/ipc'
import type { SessionState } from '../shared/signal'

// Only these narrow, typed methods cross the isolation boundary.
// ipcRenderer itself is never exposed.
const api: PawseApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  start: (request) => ipcRenderer.invoke(IPC.start, request),
  stop: () => ipcRenderer.invoke(IPC.stop),
  onState: (listener) => {
    const handler = (_event: unknown, state: SessionState): void => listener(state)
    ipcRenderer.on(IPC.stateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.stateChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('pawse', api)
