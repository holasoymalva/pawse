import { describe, expect, it } from 'vitest'
import type { CatState } from './catState'
import { CatStateTracker, DEFAULT_HYSTERESIS } from './catStateTracker'

const { promoteMs, demoteMs, staleMs, recoverMs } = DEFAULT_HYSTERESIS

/** Feed (raw, atMs) pairs and return the resulting states. */
function feed(t: CatStateTracker, steps: [CatState, number][]): CatState[] {
  return steps.map(([raw, at]) => t.update(raw, at))
}

describe('CatStateTracker', () => {
  it('applies session-level states immediately', () => {
    const t = new CatStateTracker()
    expect(feed(t, [['searching', 0], ['idle', 1], ['error', 2], ['searching', 3]])).toEqual([
      'searching', 'idle', 'error', 'searching'
    ])
  })

  it('enters the first live state immediately from searching', () => {
    const t = new CatStateTracker(DEFAULT_HYSTERESIS, 'searching')
    expect(t.update('settling', 100)).toBe('settling')
    const t2 = new CatStateTracker(DEFAULT_HYSTERESIS, 'searching')
    expect(t2.update('connected', 100)).toBe('connected')
  })

  it('promotes settling → connected only after it persists', () => {
    const t = new CatStateTracker(DEFAULT_HYSTERESIS, 'settling')
    expect(t.update('connected', 0)).toBe('settling')
    expect(t.update('connected', promoteMs - 1)).toBe('settling')
    expect(t.update('connected', promoteMs)).toBe('connected')
  })

  it('does not demote connected → settling for brief flips', () => {
    const t = new CatStateTracker(DEFAULT_HYSTERESIS, 'connected')
    // SDK toggles `stable` every second: never holds for demoteMs
    const out = feed(t, [
      ['settling', 0], ['connected', 1000], ['settling', 2000], ['connected', 3000],
      ['settling', 4000], ['connected', 5000], ['settling', 6000], ['connected', 7000]
    ])
    expect(new Set(out)).toEqual(new Set(['connected']))
    expect(t.history).toHaveLength(0)
  })

  it('demotes connected → settling when it persists', () => {
    const t = new CatStateTracker(DEFAULT_HYSTERESIS, 'connected')
    expect(t.update('settling', 0)).toBe('connected')
    expect(t.update('settling', demoteMs - 1)).toBe('connected')
    expect(t.update('settling', demoteMs)).toBe('settling')
  })

  it('absorbs a one-tick stale blip (data arriving just after the timeout)', () => {
    const t = new CatStateTracker(DEFAULT_HYSTERESIS, 'connected')
    const out = feed(t, [['stale', 0], ['stale', 1000], ['connected', 1500], ['connected', 3000]])
    expect(out).toEqual(['connected', 'connected', 'connected', 'connected'])
  })

  it('goes stale after the stale hold and recovers after the recover hold', () => {
    const t = new CatStateTracker(DEFAULT_HYSTERESIS, 'connected')
    expect(t.update('stale', 0)).toBe('connected')
    expect(t.update('stale', staleMs)).toBe('stale')
    expect(t.update('connected', staleMs + 10)).toBe('stale')
    expect(t.update('connected', staleMs + 10 + recoverMs)).toBe('connected')
  })

  it('a changing target restarts the hold timer', () => {
    const t = new CatStateTracker(DEFAULT_HYSTERESIS, 'connected')
    t.update('stale', 0)
    t.update('settling', 1500) // target changed; stale timer discarded
    expect(t.update('stale', 3000)).toBe('connected') // only 0 ms into a *new* stale hold
    expect(t.update('stale', 3000 + staleMs)).toBe('stale')
  })

  it('records committed transitions only', () => {
    const t = new CatStateTracker()
    feed(t, [['searching', 0], ['connected', 10], ['settling', 20], ['settling', 5000]])
    expect(t.history.map((h) => `${h.from}>${h.to}`)).toEqual([
      'idle>searching', 'searching>connected', 'connected>settling'
    ])
  })

  it('caps history length', () => {
    const t = new CatStateTracker(DEFAULT_HYSTERESIS, 'idle', 5)
    for (let i = 0; i < 20; i++) t.update(i % 2 ? 'idle' : 'searching', i)
    expect(t.history.length).toBeLessThanOrEqual(5)
  })
})
