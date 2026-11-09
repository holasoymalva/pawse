import type { CatState } from '../animation/catState'
import { freshnessOf, type SessionError, type SessionState } from '../signal'

/** Friendly, informative status line for the "connecting" stage. Reflects real state only. */
export function connectionMessage(
  session: Pick<SessionState, 'phase' | 'signal' | 'validation' | 'recoveryAttempt'>,
  catState: CatState
): string {
  if (session.recoveryAttempt > 0) return `Reconnecting to SmartSpectra… (attempt ${session.recoveryAttempt})`
  if (session.phase === 'starting' || session.phase === 'idle') return 'Waking up the camera…'
  if (session.validation && !session.validation.ok) return session.validation.hint
  const { breathing, pulse } = session.signal
  if (!breathing && !pulse) return 'Looking for you. Sit comfortably and face the camera.'
  if (!breathing) return 'I can see your pulse. Waiting for your breathing…'
  if (catState === 'settling' || !breathing.stable) return 'Almost there. Keep breathing naturally.'
  return 'Got you. Hold on just a moment…'
}

export interface PauseMessage {
  title: string
  lede: string
  /** Short label for the state pill while paused (never "Connected" while the timer is paused). */
  pill: string
}

/**
 * Why the timer is paused, from the real signal. A lost signal and an unsteady breathing
 * reading are different situations and must not be described as the same thing.
 */
export function pauseMessage(
  session: Pick<SessionState, 'phase' | 'signal'>,
  nowMs: number
): PauseMessage {
  const b = session.signal.breathing
  if (session.phase === 'running' && b && freshnessOf(b, nowMs) === 'fresh' && !b.stable) {
    return {
      title: 'Breathing is settling',
      lede: 'The timer is paused until your breathing reading steadies. Keep still and breathe naturally.',
      pill: 'Signal unstable'
    }
  }
  return {
    title: 'Lost your signal',
    lede: 'The timer is paused. Face the camera and hold still.',
    pill: 'Signal lost'
  }
}

export interface FriendlyError {
  title: string
  body: string
}

/** Maps SDK/session errors to plain-language guidance. */
export function friendlyError(error: SessionError): FriendlyError {
  const text = `${error.name} ${error.message}`.toLowerCase()
  if (error.name === 'CameraPermission') {
    return { title: "PAWSE can't use the camera", body: error.message }
  }
  if (error.name === 'kCreditExhausted' || /insufficient credits|credit/.test(text)) {
    return {
      title: 'SmartSpectra credits used up',
      body: 'The SmartSpectra account behind this API key has no credits left. Check the plan at physiology.presagetech.com, then try again.'
    }
  }
  if (error.name === 'kAuthenticationFailed') {
    return { title: 'API key problem', body: 'SmartSpectra did not accept the API key. Check SMARTSPECTRA_API_KEY in .env and restart PAWSE.' }
  }
  if (error.name === 'kNetworkError' || error.name === 'kServerError' || error.name === 'RecoveryFailed') {
    return {
      title: "Can't reach SmartSpectra",
      body: "PAWSE couldn't keep a connection to Presage's servers. Check your internet connection and try again in a moment."
    }
  }
  if (error.name === 'kInputUnavailable') {
    return { title: 'Camera unavailable', body: 'The camera could not be opened. Close other apps that use it, then try again.' }
  }
  return { title: error.name, body: error.message }
}
