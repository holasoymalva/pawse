import { describe, expect, it } from 'vitest'
import { STALE_AFTER_MS, type Reading, type SessionPhase } from '../signal'
import { deriveCatState } from './catState'

const NOW = 1_700_000_000_000
const reading = (over: Partial<Reading> = {}): Reading => ({
  value: 14,
  measuredAtMs: NOW,
  receivedAtMs: NOW,
  confidence: 80,
  stable: true,
  ...over
})
const session = (phase: SessionPhase, breathing: Reading | null = null, pulse: Reading | null = null) => ({
  phase,
  signal: { breathing, pulse }
})

describe('deriveCatState', () => {
  it('idle when no session or while stopping', () => {
    expect(deriveCatState(session('idle'), NOW)).toBe('idle')
    expect(deriveCatState(session('stopping', reading()), NOW)).toBe('idle')
  })
  it('searching while starting, or running without any reading', () => {
    expect(deriveCatState(session('starting'), NOW)).toBe('searching')
    expect(deriveCatState(session('running'), NOW)).toBe('searching')
  })
  it('settling when fresh readings are not yet stable', () => {
    expect(deriveCatState(session('running', reading({ stable: false })), NOW)).toBe('settling')
    expect(
      deriveCatState(session('running', reading({ stable: false }), reading({ stable: false })), NOW)
    ).toBe('settling')
  })
  it('connected when at least one fresh reading is stable', () => {
    expect(deriveCatState(session('running', reading()), NOW + 1000)).toBe('connected')
    expect(deriveCatState(session('running', reading({ stable: false }), reading()), NOW)).toBe('connected')
  })
  it('stale when readings exist but none is fresh', () => {
    expect(deriveCatState(session('running', reading()), NOW + STALE_AFTER_MS + 1)).toBe('stale')
  })
  it('a stale stable reading does not make a fresh unstable one "connected"', () => {
    const old = reading({ receivedAtMs: NOW - STALE_AFTER_MS - 5 })
    expect(deriveCatState(session('running', reading({ stable: false }), old), NOW)).toBe('settling')
  })
  it('error whenever the session errored, regardless of readings', () => {
    expect(deriveCatState(session('error', reading()), NOW)).toBe('error')
  })
  it('walks the expected lifecycle', () => {
    const seq: [ReturnType<typeof session>, number][] = [
      [session('idle'), NOW],
      [session('starting'), NOW],
      [session('running'), NOW],
      [session('running', reading({ stable: false })), NOW],
      [session('running', reading()), NOW],
      [session('running', reading()), NOW + STALE_AFTER_MS + 1],
      [session('running', reading({ receivedAtMs: NOW + STALE_AFTER_MS + 2 })), NOW + STALE_AFTER_MS + 3],
      [session('stopping'), NOW],
      [session('idle'), NOW]
    ]
    expect(seq.map(([s, t]) => deriveCatState(s, t))).toEqual([
      'idle', 'searching', 'searching', 'settling', 'connected', 'stale', 'connected', 'idle', 'idle'
    ])
  })
})
