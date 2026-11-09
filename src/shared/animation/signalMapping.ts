import { PLAUSIBLE_RANGE, type SignalKind } from '../signal'

/**
 * Pure mapping from measured rates to animation timing.
 *
 * The animation follows the *rate* of the measured signal. It does not claim to
 * be phase-synchronised with individual breaths or heartbeats: the SDK delivers
 * a rate estimate, not breath/beat onsets.
 */

/** Decorative rate used only when there is no measurement. Never presented as a reading. */
export const AMBIENT_BREATH_BPM = 12

/** Returns the rate if it is finite and plausible for the signal kind, otherwise null. */
export function sanitizeRate(kind: SignalKind, bpm: number | null | undefined): number | null {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return null
  const { min, max } = PLAUSIBLE_RANGE[kind]
  return bpm >= min && bpm <= max ? bpm : null
}

/** One full breathing cycle lasts 60 / breaths-per-minute seconds. */
export function breathPeriodSeconds(breathsPerMinute: number): number {
  return 60 / breathsPerMinute
}

export function heartPeriodSeconds(beatsPerMinute: number): number {
  return 60 / beatsPerMinute
}

export function bpmToHz(bpm: number): number {
  return bpm / 60
}

/** Smooth 0 → 1 → 0 curve over one cycle (phase in cycles; 0 = exhaled, 0.5 = fully inhaled). */
export function breathCurve(phase: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase)
}

function wrappedDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 1) + 1) % 1)
  return Math.min(d, 1 - d)
}

function bump(phase: number, centre: number, width: number): number {
  const x = wrappedDistance(phase, centre) / width
  return Math.exp(-x * x)
}

/** "Lub-dub" envelope in 0..1 over one beat cycle (phase in cycles). */
export function heartbeatEnvelope(phase: number): number {
  return Math.min(1, bump(phase, 0, 0.06) + 0.6 * bump(phase, 0.28, 0.05))
}

/** Mulberry32: tiny seeded PRNG so ambient animation is deterministic. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
