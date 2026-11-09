import { EMPTY_SIGNAL, type SessionState } from '@shared/signal'

/**
 * DEVELOPMENT-ONLY: lets the renderer open in a plain browser (no Electron) for
 * visual work. Inert: it never starts a session, never reads the camera, and
 * performs no network access.
 */
const idle: SessionState = {
  phase: 'idle',
  availability: { kind: 'ready' },
  sdkVersion: 'browser-preview',
  processingStatus: 'idle',
  validation: null,
  signal: EMPTY_SIGNAL,
  error: null,
  notice: null,
  recoveryAttempt: 0
}

window.pawse = {
  getState: async () => idle,
  start: async () => idle,
  stop: async () => idle,
  getDiagnostics: async () => null,
  onState: () => () => {}
}
