import {
  PLAUSIBLE_RANGE,
  type ProcessingStatusName,
  type Reading,
  type SignalKind,
  type SignalSnapshot,
  type ValidationMessage
} from '../shared/signal'

/** Names from the official SmartSpectra Node API reference (ValidationCode). */
const VALIDATION_NAMES: Readonly<Record<number, string>> = {
  0: 'kOk',
  1: 'kNoFaceFound',
  2: 'kMultipleFacesFound',
  3: 'kFaceNotCentered',
  4: 'kFaceSizeOutOfRange',
  5: 'kTooDark',
  6: 'kTooBright',
  7: 'kChestNotVisible',
  10: 'kCameraTuning',
  11: 'kFrameRateTooLow',
  12: 'kExcessiveMotion',
  13: 'kFaceTooClose',
  14: 'kFaceTooFar',
  15: 'kFaceTooHigh',
  16: 'kFaceTooLow',
  17: 'kFaceNotForward'
}

/** Fallback copy used only when the SDK supplies an empty hint. */
const VALIDATION_FALLBACK: Readonly<Record<number, string>> = {
  0: 'Looking good.',
  1: 'No face found. Move into view of the camera.',
  2: 'More than one face found. Only one person should be in view.',
  3: 'Center your face in the frame.',
  4: 'Adjust your distance from the camera.',
  5: 'Too dark. Add some light on your face.',
  6: 'Too bright. Reduce direct light or glare.',
  7: 'Your chest is not visible. Sit back a little.',
  10: 'The camera is adjusting. Hold still for a moment.',
  11: 'Camera frame rate is too low.',
  12: 'Too much movement. Try to sit still.',
  13: 'Too close to the camera.',
  14: 'Too far from the camera.',
  15: 'Your face is too high in the frame.',
  16: 'Your face is too low in the frame.',
  17: 'Face the camera directly.'
}

const ERROR_NAMES: Readonly<Record<number, string>> = {
  0: 'kOk',
  1: 'kInvalidState',
  2: 'kAuthenticationFailed',
  3: 'kConfigurationFailed',
  4: 'kCreditExhausted',
  5: 'kNetworkError',
  6: 'kServerError',
  7: 'kInputUnavailable',
  8: 'kProcessingFailed',
  9: 'kFrameConversionFailed',
  10: 'kNonMonotonicTimestamp',
  11: 'kTimestampGap'
}

const STATUS_NAMES: Readonly<Record<number, ProcessingStatusName>> = {
  0: 'uninitialized',
  1: 'idle',
  2: 'starting',
  3: 'running',
  4: 'stopping',
  5: 'error'
}

export function processingStatusName(value: number): ProcessingStatusName {
  return STATUS_NAMES[value] ?? 'error'
}

export function errorCodeName(code: number): string {
  return ERROR_NAMES[code] ?? `code ${code}`
}

export function toValidationMessage(
  code: number,
  hint: string,
  atMs: number
): ValidationMessage {
  const trimmed = hint.trim()
  return {
    code,
    name: VALIDATION_NAMES[code] ?? `code ${code}`,
    hint: trimmed.length > 0 ? trimmed : (VALIDATION_FALLBACK[code] ?? 'Adjust your position.'),
    ok: code === 0,
    atMs
  }
}

/** protobufjs int64 may be a number or a Long-like object. Returns microseconds or null. */
function microsFrom(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value === 'object' && 'toNumber' in value) {
    const fn = (value as { toNumber: unknown }).toNumber
    if (typeof fn === 'function') {
      const n: unknown = fn.call(value)
      return typeof n === 'number' && Number.isFinite(n) ? n : null
    }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Buffer.isBuffer(value)
}

/**
 * Take the latest *valid* sample from a repeated MeasurementWithConfidence field.
 * Samples that are non-finite or outside the plausibility window are skipped.
 */
export function latestReading(
  samples: unknown,
  kind: SignalKind,
  receivedAtMs: number
): Reading | null {
  if (!Array.isArray(samples)) return null
  const { min, max } = PLAUSIBLE_RANGE[kind]
  for (let i = samples.length - 1; i >= 0; i--) {
    const s: unknown = samples[i]
    if (!isRecord(s)) continue
    const value = s.value
    const confidence = s.confidence
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (value < min || value > max) continue
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) continue
    if (typeof s.stable !== 'boolean') continue
    const micros = microsFrom(s.timestamp)
    return {
      value,
      confidence,
      stable: s.stable,
      measuredAtMs: micros === null ? receivedAtMs : Math.round(micros / 1000),
      receivedAtMs
    }
  }
  return null
}

/**
 * Extract pulse and breathing readings from a *decoded* Metrics payload
 * (`breathing.rate[]`, `cardio.pulseRate[]`). Returns null for anything that is
 * not a decoded object (e.g. a raw Buffer), so callers can flag a decode problem.
 */
export function extractSignals(
  decoded: unknown,
  receivedAtMs: number
): Pick<SignalSnapshot, 'pulse' | 'breathing'> | null {
  if (!isRecord(decoded)) return null
  const breathing = isRecord(decoded.breathing) ? decoded.breathing : null
  const cardio = isRecord(decoded.cardio) ? decoded.cardio : null
  return {
    breathing: latestReading(breathing?.rate, 'breathing', receivedAtMs),
    pulse: latestReading(cardio?.pulseRate, 'pulse', receivedAtMs)
  }
}

/** Merge a new extraction into the current snapshot, keeping older readings when absent. */
export function mergeSignals(
  current: SignalSnapshot,
  next: Pick<SignalSnapshot, 'pulse' | 'breathing'>
): SignalSnapshot {
  return {
    pulse: next.pulse ?? current.pulse,
    breathing: next.breathing ?? current.breathing
  }
}
