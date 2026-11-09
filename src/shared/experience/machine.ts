import { freshnessOf, type SessionPhase, type SessionState } from '../signal'

/**
 * "Breathe Together": a 60-second experience driven only by *elapsed valid live
 * measurement time*. It never looks at how the user breathes (no scoring, no
 * target rate), only at whether a live, stable breathing reading is present.
 *
 * Pure and clock-injected so it is deterministic and unit-testable.
 */

export type Stage = 'meet' | 'connecting' | 'breathing' | 'paused' | 'peace'
export type EndReason = 'cancelled' | 'error' | 'ended' | null

export const EXPERIENCE_MS = 60_000

export interface ExperienceConfig {
  /** Valid signal must hold this long before the timed session starts. */
  enterMs: number
  /** Signal must be missing this long before the timer is paused. */
  lossGraceMs: number
  /**
   * A fresh breathing reading that is not (yet) `stable` is a different situation from a
   * lost signal: the SDK's stability flag flickers on real data, so tolerate a longer
   * stretch before pausing. No time is credited meanwhile.
   */
  unsteadyGraceMs: number
  /** Valid signal must hold this long before a paused session resumes. */
  recoverMs: number
  /** Largest elapsed time credited by one tick (sleep / throttled timers are not counted). */
  maxStepMs: number
  /** Total valid measurement time to reach the final stage. */
  durationMs: number
}

export const DEFAULT_CONFIG: ExperienceConfig = {
  enterMs: 1500,
  lossGraceMs: 1500,
  unsteadyGraceMs: 5000,
  recoverMs: 1000,
  maxStepMs: 1000,
  durationMs: EXPERIENCE_MS
}

export interface ExperienceState {
  stage: Stage
  /** Accumulated valid live-measurement time. */
  validMs: number
  lastTickMs: number | null
  validSinceMs: number | null
  invalidSinceMs: number | null
  /** The session was seen starting/running; later idle/stopping means it ended. */
  sawActive: boolean
  /** Ignore a still-running session until it has been seen idle (after cancel/complete/error). */
  awaitIdle: boolean
  endReason: EndReason
}

export interface TickInput {
  nowMs: number
  phase: SessionPhase
  /** Is a live, fresh, stable breathing reading present right now? */
  valid: boolean
  /** Invalid only because the breathing reading is fresh but not stable (not a lost signal). */
  unsteady?: boolean
  /** Dev-simulation only: multiplies credited time. Always 1 for real sessions. */
  timeScale?: number
  /** Adopt an already-running real session (e.g. renderer reload). False for simulation. */
  adopt?: boolean
}

export const initialExperience = (): ExperienceState => ({
  stage: 'meet',
  validMs: 0,
  lastTickMs: null,
  validSinceMs: null,
  invalidSinceMs: null,
  sawActive: false,
  awaitIdle: false,
  endReason: null
})

/** Valid = the session is running and a fresh, stable breathing reading exists. */
export function isLiveBreathing(
  session: Pick<SessionState, 'phase' | 'signal'>,
  nowMs: number
): boolean {
  const b = session.signal.breathing
  return session.phase === 'running' && b !== null && b.stable && freshnessOf(b, nowMs) === 'fresh'
}

/** A fresh breathing reading exists but the SDK has not flagged it `stable`. */
export function isUnsteadyBreathing(
  session: Pick<SessionState, 'phase' | 'signal'>,
  nowMs: number
): boolean {
  const b = session.signal.breathing
  return session.phase === 'running' && b !== null && !b.stable && freshnessOf(b, nowMs) === 'fresh'
}

export const progressOf = (s: ExperienceState, cfg = DEFAULT_CONFIG): number =>
  Math.min(1, s.validMs / cfg.durationMs)

export const remainingMs = (s: ExperienceState, cfg = DEFAULT_CONFIG): number =>
  Math.max(0, cfg.durationMs - s.validMs)

const isActive = (s: Stage): boolean => s === 'connecting' || s === 'breathing' || s === 'paused'

/** The user pressed "Wake up PAWSE". */
export function begin(s: ExperienceState, nowMs: number): ExperienceState {
  if (s.stage !== 'meet') return s
  return { ...initialExperience(), stage: 'connecting', lastTickMs: nowMs, awaitIdle: false }
}

/** Stop at any moment. Progress is discarded. */
export function cancel(s: ExperienceState): ExperienceState {
  if (!isActive(s.stage)) return s
  return { ...initialExperience(), awaitIdle: true, endReason: 'cancelled' }
}

/** Back to the welcome stage ("Start another session"). */
export function reset(s: ExperienceState): ExperienceState {
  return { ...initialExperience(), awaitIdle: s.awaitIdle }
}

export function tick(
  s: ExperienceState,
  input: TickInput,
  cfg: ExperienceConfig = DEFAULT_CONFIG
): ExperienceState {
  const { nowMs, phase, valid } = input
  const sessionActive = phase === 'starting' || phase === 'running'

  // Not in an active stage: only watch for an externally running real session to adopt.
  if (!isActive(s.stage)) {
    if (s.awaitIdle && !sessionActive) return { ...s, awaitIdle: false }
    if (s.stage === 'meet' && input.adopt && sessionActive && !s.awaitIdle) {
      return { ...initialExperience(), stage: 'connecting', lastTickMs: nowMs, sawActive: true }
    }
    return s
  }

  const sawActive = s.sawActive || sessionActive
  // The session failed or ended underneath us.
  if (phase === 'error') {
    return { ...initialExperience(), awaitIdle: true, endReason: 'error' }
  }
  if (sawActive && (phase === 'idle' || phase === 'stopping')) {
    return { ...initialExperience(), awaitIdle: phase === 'stopping', endReason: 'ended' }
  }

  const stepMs = s.lastTickMs === null ? 0 : Math.min(Math.max(nowMs - s.lastTickMs, 0), cfg.maxStepMs)
  const next: ExperienceState = { ...s, sawActive, lastTickMs: nowMs }

  switch (s.stage) {
    case 'connecting': {
      if (!valid) return { ...next, validSinceMs: null }
      const since = s.validSinceMs ?? nowMs
      if (nowMs - since >= cfg.enterMs) {
        return { ...next, stage: 'breathing', validMs: 0, validSinceMs: null, invalidSinceMs: null }
      }
      return { ...next, validSinceMs: since }
    }
    case 'breathing': {
      if (valid) {
        const validMs = Math.min(cfg.durationMs, s.validMs + stepMs * (input.timeScale ?? 1))
        if (validMs >= cfg.durationMs) {
          return { ...next, stage: 'peace', validMs: cfg.durationMs, invalidSinceMs: null, validSinceMs: null, awaitIdle: true }
        }
        return { ...next, validMs, invalidSinceMs: null }
      }
      // No valid signal: no time is credited; pause after a short grace period.
      const since = s.invalidSinceMs ?? nowMs
      const grace = input.unsteady ? cfg.unsteadyGraceMs : cfg.lossGraceMs
      if (nowMs - since >= grace) {
        return { ...next, stage: 'paused', invalidSinceMs: null, validSinceMs: null }
      }
      return { ...next, invalidSinceMs: since }
    }
    case 'paused': {
      if (!valid) return { ...next, validSinceMs: null }
      const since = s.validSinceMs ?? nowMs
      if (nowMs - since >= cfg.recoverMs) {
        return { ...next, stage: 'breathing', validSinceMs: null, invalidSinceMs: null }
      }
      return { ...next, validSinceMs: since }
    }
    default:
      return s
  }
}
