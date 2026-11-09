import { describe, expect, it } from 'vitest'
import {
  AMBIENT_BREATH_BPM,
  breathCurve,
  breathPeriodSeconds,
  createRng,
  heartbeatEnvelope,
  heartPeriodSeconds,
  sanitizeRate
} from './signalMapping'

describe('rate → period mapping', () => {
  it('breath cycle is 60 / breathsPerMinute seconds', () => {
    expect(breathPeriodSeconds(12)).toBe(5)
    expect(breathPeriodSeconds(15)).toBe(4)
    expect(breathPeriodSeconds(20)).toBe(3)
  })
  it('heartbeat period is 60 / bpm seconds', () => {
    expect(heartPeriodSeconds(60)).toBe(1)
    expect(heartPeriodSeconds(75)).toBeCloseTo(0.8)
  })
  it('ambient rate is a plain constant, not a reading', () => {
    expect(AMBIENT_BREATH_BPM).toBe(12)
  })
})

describe('sanitizeRate', () => {
  it('passes plausible values and rejects everything else', () => {
    expect(sanitizeRate('breathing', 14)).toBe(14)
    expect(sanitizeRate('pulse', 72)).toBe(72)
    expect(sanitizeRate('pulse', 0)).toBeNull()
    expect(sanitizeRate('pulse', 500)).toBeNull()
    expect(sanitizeRate('breathing', 100)).toBeNull()
    expect(sanitizeRate('pulse', NaN)).toBeNull()
    expect(sanitizeRate('pulse', Infinity)).toBeNull()
    expect(sanitizeRate('pulse', null)).toBeNull()
    expect(sanitizeRate('pulse', undefined)).toBeNull()
  })
})

describe('curves', () => {
  it('breathCurve is smooth, bounded and periodic', () => {
    expect(breathCurve(0)).toBeCloseTo(0)
    expect(breathCurve(0.5)).toBeCloseTo(1)
    expect(breathCurve(1)).toBeCloseTo(0)
    for (let p = 0; p <= 1; p += 0.01) {
      const v = breathCurve(p)
      expect(v).toBeGreaterThanOrEqual(-1e-9)
      expect(v).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
  it('heartbeat envelope peaks at "lub" and has a smaller "dub"', () => {
    const lub = heartbeatEnvelope(0)
    const dub = heartbeatEnvelope(0.28)
    const rest = heartbeatEnvelope(0.7)
    expect(lub).toBeGreaterThan(dub)
    expect(dub).toBeGreaterThan(rest)
    expect(rest).toBeLessThan(0.05)
    expect(heartbeatEnvelope(0.999)).toBeCloseTo(heartbeatEnvelope(-0.001), 5)
  })
  it('seeded rng is deterministic and in [0,1)', () => {
    const a = createRng(7)
    const b = createRng(7)
    for (let i = 0; i < 20; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(createRng(1)()).not.toBe(createRng(2)())
  })
})
