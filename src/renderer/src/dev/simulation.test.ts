import { describe, expect, it } from 'vitest'
import { deriveCatState } from '@shared/animation/catState'
import { STALE_AFTER_MS } from '@shared/signal'
import { buildSimState, SCENARIOS, updatesOverTime, type ScenarioId } from './simulation'

const START = 1_700_000_000_000
const at = (id: ScenarioId, seconds: number) => buildSimState(id, { nowMs: START + seconds * 1000, startMs: START })

describe('simulation scenarios (dev only)', () => {
  it('every scenario builds a valid state', () => {
    for (const s of SCENARIOS) {
      const st = at(s.id, 5)
      expect(st.availability.kind).toBe('ready')
      expect(st.sdkVersion).toBe('simulation')
    }
  })

  it('maps scenarios to the intended cat states', () => {
    const state = (id: ScenarioId, s = 5) => deriveCatState(at(id, s), START + s * 1000)
    expect(state('calm')).toBe('connected')
    expect(state('slow')).toBe('connected')
    expect(state('fast')).toBe('connected')
    expect(state('settling')).toBe('settling')
    expect(state('searching')).toBe('searching')
    expect(state('resting')).toBe('idle')
    expect(state('error')).toBe('error')
  })

  it('"lost" goes stale by itself once readings stop updating', () => {
    const first = at('lost', 0)
    expect(deriveCatState(first, START + 1000)).toBe('connected')
    expect(deriveCatState(first, START + STALE_AFTER_MS + 1000)).toBe('stale')
  })

  it('readings stay in the plausible, scenario-appropriate range while wandering', () => {
    for (let s = 0; s < 120; s += 3) {
      const calm = at('calm', s).signal
      expect(calm.breathing!.value).toBeGreaterThan(10)
      expect(calm.breathing!.value).toBeLessThan(14)
      const fast = at('fast', s).signal
      expect(fast.breathing!.value).toBeGreaterThan(20)
      expect(fast.pulse!.value).toBeGreaterThan(90)
    }
  })

  it('only live scenarios keep updating', () => {
    expect(updatesOverTime('calm')).toBe(true)
    expect(updatesOverTime('lost')).toBe(false)
    expect(updatesOverTime('error')).toBe(false)
  })

  it('the error scenario is clearly marked as simulated', () => {
    const st = at('error', 1)
    expect(st.error?.name).toBe('Simulated')
    expect(st.error?.message).toMatch(/simulated/i)
  })
})
