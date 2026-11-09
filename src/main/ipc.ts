import { IPC, type StartRequest } from '../shared/ipc'
import type { DiagnosticsSnapshot } from '../shared/diagnostics'
import type { SessionState } from '../shared/signal'

/** Narrow views so the handlers can be unit-tested without Electron. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

export interface SessionApi {
  getState(): SessionState
  start(): Promise<SessionState>
  stop(): Promise<SessionState>
  getDiagnostics(): DiagnosticsSnapshot | null
}

/** The only IPC surface the renderer can reach. */
export function registerIpc(ipc: IpcMainLike, service: SessionApi): void {
  ipc.handle(IPC.getState, () => service.getState())
  ipc.handle(IPC.start, (_event, request) => {
    // Measurement only ever begins after explicit consent from the UI.
    const consent =
      typeof request === 'object' && request !== null && (request as Partial<StartRequest>).consent === true
    if (!consent) throw new Error('Consent is required to start a session.')
    return service.start()
  })
  ipc.handle(IPC.stop, () => service.stop())
  ipc.handle(IPC.getDiagnostics, () => service.getDiagnostics())
}
