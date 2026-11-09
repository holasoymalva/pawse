import type { Reading, SessionState } from '@shared/signal'

/**
 * DEVELOPMENT-ONLY visual simulation. These states are built in the renderer, are
 * never sent to the SDK or main process, never touch real credits, and the UI
 * labels everything derived from them as simulated.
 */

export type ScenarioId = 'calm' | 'slow' | 'fast' | 'settling' | 'searching' | 'lost' | 'resting' | 'error'

export interface Scenario {
  id: ScenarioId
  label: string
}

export const SCENARIOS: readonly Scenario[] = [
  { id: 'calm', label: 'Calm · 12 br/min, 64 bpm' },
  { id: 'slow', label: 'Slow · 7 br/min, 55 bpm' },
  { id: 'fast', label: 'Fast · 24 br/min, 98 bpm' },
  { id: 'settling', label: 'Settling · unstable readings' },
  { id: 'searching', label: 'Searching · no readings yet' },
  { id: 'lost', label: 'Signal lost · readings stop' },
  { id: 'resting', label: 'Resting · no session' },
  { id: 'error', label: 'Error state' }
]

export interface SimContext {
  nowMs: number
  /** When this scenario started (used by "lost" so readings go stale). */
  startMs: number
}

const BASE: SessionState = {
  phase: 'running',
  availability: { kind: 'ready' },
  sdkVersion: 'simulation',
  processingStatus: 'running',
  validation: null,
  signal: { pulse: null, breathing: null },
  error: null,
  notice: null,
  recoveryAttempt: 0
}

function wander(base: number, spread: number, t: number): number {
  return base + spread * (0.7 * Math.sin(t / 6.3) + 0.3 * Math.sin(t / 2.4 + 1.1))
}

function reading(value: number, at: number, stable: boolean): Reading {
  return { value, measuredAtMs: at, receivedAtMs: at, confidence: 80, stable }
}

export function buildSimState(id: ScenarioId, ctx: SimContext): SessionState {
  const t = (ctx.nowMs - ctx.startMs) / 1000
  const live = (br: number, bpm: number, stable = true, at = ctx.nowMs): SessionState => ({
    ...BASE,
    signal: {
      breathing: reading(wander(br, br * 0.08, t), at, stable),
      pulse: reading(wander(bpm, 3, t * 1.3), at, stable)
    }
  })
  switch (id) {
    case 'calm':
      return live(12, 64)
    case 'slow':
      return live(7, 55)
    case 'fast':
      return live(24, 98)
    case 'settling':
      return live(15, 72, false)
    case 'searching':
      return { ...BASE }
    case 'lost':
      // Readings keep their original timestamp so they go stale on their own.
      return live(13, 66, true, ctx.startMs)
    case 'resting':
      return { ...BASE, phase: 'idle', processingStatus: 'idle' }
    case 'error':
      return {
        ...BASE,
        phase: 'error',
        processingStatus: 'error',
        error: { code: null, name: 'Simulated', message: 'This is a simulated error for visual testing.', retryable: false }
      }
  }
}

/** Scenarios whose readings should keep updating over time. */
export function updatesOverTime(id: ScenarioId): boolean {
  return id === 'calm' || id === 'slow' || id === 'fast' || id === 'settling'
}
