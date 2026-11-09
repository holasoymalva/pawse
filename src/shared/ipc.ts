import type { DiagnosticsSnapshot } from './diagnostics'
import type { SessionState } from './signal'

/** The only channels the renderer may use. Keep in sync with the preload bridge. */
export const IPC = {
  getState: 'pawse:session:get-state',
  start: 'pawse:session:start',
  stop: 'pawse:session:stop',
  getDiagnostics: 'pawse:diagnostics:get',
  stateChanged: 'pawse:session:state-changed'
} as const

export interface StartRequest {
  /** Must be literally true: the user explicitly consented in the UI. */
  consent: true
}

/** Typed API exposed on `window.pawse` by the preload script. */
export interface PawseApi {
  getState(): Promise<SessionState>
  start(request: StartRequest): Promise<SessionState>
  stop(): Promise<SessionState>
  /** Timing/stability statistics. Null unless this is a development build. */
  getDiagnostics(): Promise<DiagnosticsSnapshot | null>
  /** Subscribe to state pushes. Returns an unsubscribe function. */
  onState(listener: (state: SessionState) => void): () => void
}
