import { describe, expect, it } from 'vitest'
import { STALE_AFTER_MS, type Reading } from '../shared/signal'
import { Diagnostics, intervalStats } from './diagnostics'

const T0 = 1_700_000_000_000
const reading = (receivedAtMs: number, over: Partial<Reading> = {}): Reading => ({
  value: 73.123456,
  confidence: 61.987,
  stable: true,
  measuredAtMs: receivedAtMs,
  receivedAtMs,
  ...over
})

describe('intervalStats', () => {
  it('returns null for no data and correct stats otherwise', () => {
    expect(intervalStats([])).toBeNull()
    const s = intervalStats([100, 200, 300, 400, 1000])!
    expect(s).toMatchObject({ count: 5, minMs: 100, maxMs: 1000, meanMs: 400, p50Ms: 300 })
    expect(s.p95Ms).toBe(1000)
  })
})

describe('Diagnostics', () => {
  it('measures packet and reading intervals and first-reading latency', () => {
    const d = new Diagnostics()
    d.begin(T0)
    d.packet(T0 + 4000, { breathing: reading(T0 + 4000), pulse: null })
    d.packet(T0 + 6000, { breathing: reading(T0 + 6000), pulse: reading(T0 + 6000) })
    d.packet(T0 + 9000, { breathing: reading(T0 + 9000), pulse: null })
    const s = d.snapshot(T0 + 9500)
    expect(s.packets).toMatchObject({ total: 3, withBreathing: 3, withPulse: 1 })
    expect(s.packets.intervals).toMatchObject({ count: 2, minMs: 2000, maxMs: 3000 })
    expect(s.breathing.firstReadingAfterMs).toBe(4000)
    expect(s.pulse.firstReadingAfterMs).toBe(6000)
    expect(s.breathing.receiveIntervals?.meanMs).toBe(2500)
    expect(s.packets.sinceLastMs).toBe(500)
  })

  it('counts stability flips and stable readings', () => {
    const d = new Diagnostics()
    d.begin(T0)
    const flags = [false, false, true, true, false, true]
    flags.forEach((stable, i) => d.packet(T0 + i * 1000, { breathing: reading(T0 + i * 1000, { stable }), pulse: null }))
    const b = d.snapshot(T0 + 7000).breathing
    expect(b.stabilityFlips).toBe(3)
    expect(b.stableReadings).toBe(3)
  })

  it('counts a stale transition once per outage and resets when data returns', () => {
    const d = new Diagnostics()
    d.begin(T0)
    d.packet(T0, { breathing: reading(T0), pulse: null })
    d.tick(T0 + STALE_AFTER_MS - 1)
    expect(d.snapshot(T0).breathing.staleTransitions).toBe(0)
    d.tick(T0 + STALE_AFTER_MS + 1)
    d.tick(T0 + STALE_AFTER_MS + 2000)
    expect(d.snapshot(T0).breathing.staleTransitions).toBe(1)
    d.packet(T0 + 20_000, { breathing: reading(T0 + 20_000), pulse: null })
    d.tick(T0 + 20_000 + STALE_AFTER_MS + 1)
    const b = d.snapshot(T0 + 40_000).breathing
    expect(b.staleTransitions).toBe(2)
    expect(b.longestGapMs).toBe(20_000)
  })

  it('tracks malformed packets, validation, errors and processing transitions', () => {
    const d = new Diagnostics()
    d.begin(T0)
    d.packet(T0, 'malformed')
    d.packet(T0 + 100, { breathing: null, pulse: null })
    d.validationSeen('kTooDark')
    d.validationSeen('kTooDark')
    d.errorSeen('kTimestampGap')
    d.recovery()
    d.status('starting', T0)
    d.status('running', T0 + 1500)
    d.status('running', T0 + 1600)
    const s = d.snapshot(T0 + 2000)
    expect(s.packets).toMatchObject({ malformed: 1, withoutReadings: 1 })
    expect(s.validation).toEqual({ kTooDark: 2 })
    expect(s.errors).toEqual({ kTimestampGap: 1 })
    expect(s.recoveries).toBe(1)
    expect(s.processingTransitions).toEqual([
      { status: 'starting', atMs: 0 },
      { status: 'running', atMs: 1500 }
    ])
  })

  it('never exposes vital-sign values, confidence or credentials in a snapshot', () => {
    const d = new Diagnostics()
    d.begin(T0)
    d.packet(T0 + 1000, { breathing: reading(T0 + 1000), pulse: reading(T0 + 1000) })
    d.packet(T0 + 2000, { breathing: reading(T0 + 2000), pulse: reading(T0 + 2000) })
    const json = JSON.stringify(d.snapshot(T0 + 3000))
    expect(json).not.toContain('73.1234')
    expect(json).not.toContain('61.98')
    expect(json).not.toMatch(/apiKey|api_key|SMARTSPECTRA_API_KEY|"value"|"confidence"/)
  })

  it('freezes uptime when a session ends and restarts cleanly', () => {
    const d = new Diagnostics()
    d.begin(T0)
    d.end(T0 + 5000)
    expect(d.snapshot(T0 + 9000)).toMatchObject({ sessionActive: false, sessionUptimeMs: 5000 })
    d.begin(T0 + 10_000)
    expect(d.snapshot(T0 + 10_500)).toMatchObject({ sessionActive: true, sessionUptimeMs: 500, packets: { total: 0 } })
  })
})
