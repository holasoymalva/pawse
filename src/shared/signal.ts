/**
 * Normalized signal domain for PAWSE.
 *
 * Only fields the SmartSpectra SDK actually provides are modelled. `confidence`
 * (percent, 0-100) and `stable` come straight from the SDK's
 * MeasurementWithConfidence message; PAWSE never derives its own confidence.
 */

/** A single SDK measurement, normalized. */
export interface Reading {
  /** BPM for pulse, breaths per minute for breathing. */
  value: number
  /** SDK capture time, ms since Unix epoch (SDK reports microseconds). */
  measuredAtMs: number
  /** Local time the main process received it, ms since Unix epoch. */
  receivedAtMs: number
  /** Confidence percentage (0-100) reported by the SDK. */
  confidence: number
  /** SDK stability flag (breathing: confidence >= 45, pulse: >= 40, per docs). */
  stable: boolean
}

export interface SignalSnapshot {
  pulse: Reading | null
  breathing: Reading | null
}

export const EMPTY_SIGNAL: SignalSnapshot = { pulse: null, breathing: null }

/** none: never received; fresh: recent; stale: no update for STALE_AFTER_MS. */
export type Freshness = 'none' | 'fresh' | 'stale'

/** App policy (not an SDK value): a reading older than this is shown as stale. */
export const STALE_AFTER_MS = 10_000

/** App policy plausibility bounds; readings outside them are discarded as invalid. */
export const PLAUSIBLE_RANGE = {
  pulse: { min: 30, max: 220 },
  breathing: { min: 4, max: 60 }
} as const

export type SignalKind = keyof typeof PLAUSIBLE_RANGE

export function freshnessOf(reading: Reading | null, nowMs: number): Freshness {
  if (!reading) return 'none'
  return nowMs - reading.receivedAtMs > STALE_AFTER_MS ? 'stale' : 'fresh'
}

export type ProcessingStatusName =
  | 'uninitialized'
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

/** Camera / measurement guidance coming from the SDK's validation stream. */
export interface ValidationMessage {
  code: number
  name: string
  /** Human-readable hint supplied by the SDK (falls back to a local description). */
  hint: string
  /** true for kOk. */
  ok: boolean
  atMs: number
}

export interface SessionError {
  code: number | null
  name: string
  message: string
  retryable: boolean
}

export type SessionPhase = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

/** A transient, non-fatal SDK problem the session is riding out. */
export interface SessionNotice {
  code: number | null
  name: string
  message: string
  atMs: number
}

export type Availability =
  | { kind: 'ready' }
  | { kind: 'missing-key' }
  | { kind: 'unsupported-platform'; detail: string }
  | { kind: 'sdk-load-failed'; detail: string }

export interface SessionState {
  phase: SessionPhase
  availability: Availability
  sdkVersion: string | null
  processingStatus: ProcessingStatusName
  validation: ValidationMessage | null
  signal: SignalSnapshot
  error: SessionError | null
  /** Non-fatal SDK warning (e.g. a retryable error). Cleared when readings resume. */
  notice: SessionNotice | null
  /** 0 normally; 1..n while the service is trying to recover the SDK pipeline. */
  recoveryAttempt: number
}
