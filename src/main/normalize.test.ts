import { describe, expect, it } from 'vitest'
import { EMPTY_SIGNAL, freshnessOf, STALE_AFTER_MS } from '../shared/signal'
import {
  extractSignals,
  latestReading,
  mergeSignals,
  toValidationMessage
} from './normalize'

const NOW = 1_700_000_000_000
const sample = (value: number, o: Record<string, unknown> = {}) => ({
  value,
  confidence: 80,
  stable: true,
  timestamp: (NOW - 500) * 1000,
  ...o
})

describe('latestReading', () => {
  it('takes the last valid sample and converts microseconds to ms', () => {
    const r = latestReading([sample(60), sample(72)], 'pulse', NOW)
    expect(r).toMatchObject({ value: 72, confidence: 80, stable: true, receivedAtMs: NOW })
    expect(r?.measuredAtMs).toBe(NOW - 500)
  })

  it('accepts Long-like timestamps', () => {
    const r = latestReading([sample(15, { timestamp: { toNumber: () => 5_000_000 } })], 'breathing', NOW)
    expect(r?.measuredAtMs).toBe(5000)
  })

  it('skips NaN, infinite and implausible values and falls back to an earlier sample', () => {
    const r = latestReading([sample(70), sample(NaN), sample(900), sample(0)], 'pulse', NOW)
    expect(r?.value).toBe(70)
  })

  it('returns null when nothing valid is present', () => {
    expect(latestReading([sample(900)], 'pulse', NOW)).toBeNull()
    expect(latestReading([], 'pulse', NOW)).toBeNull()
    expect(latestReading(undefined, 'pulse', NOW)).toBeNull()
    expect(latestReading('nope', 'pulse', NOW)).toBeNull()
  })

  it('rejects samples missing confidence or stable instead of inventing them', () => {
    expect(latestReading([{ value: 70, timestamp: 1 }], 'pulse', NOW)).toBeNull()
    expect(latestReading([sample(70, { stable: undefined })], 'pulse', NOW)).toBeNull()
  })

  it('keeps unstable readings flagged as unstable', () => {
    expect(latestReading([sample(70, { stable: false, confidence: 20 })], 'pulse', NOW)?.stable).toBe(false)
  })

  it('uses plausibility windows per kind', () => {
    expect(latestReading([sample(120)], 'breathing', NOW)).toBeNull()
    expect(latestReading([sample(120)], 'pulse', NOW)).not.toBeNull()
  })
})

describe('extractSignals', () => {
  it('reads breathing.rate and cardio.pulseRate', () => {
    const s = extractSignals(
      { breathing: { rate: [sample(14)] }, cardio: { pulseRate: [sample(66)] } },
      NOW
    )
    expect(s?.breathing?.value).toBe(14)
    expect(s?.pulse?.value).toBe(66)
  })

  it('handles payloads with only one group', () => {
    const s = extractSignals({ breathing: { rate: [sample(14)] } }, NOW)
    expect(s?.pulse).toBeNull()
    expect(s?.breathing?.value).toBe(14)
  })

  it('returns null for a raw Buffer or non-objects (undecoded payload)', () => {
    expect(extractSignals(Buffer.from([1, 2, 3]), NOW)).toBeNull()
    expect(extractSignals(null, NOW)).toBeNull()
    expect(extractSignals('x', NOW)).toBeNull()
  })

  it('returns empty readings for an empty decoded message', () => {
    expect(extractSignals({}, NOW)).toEqual({ pulse: null, breathing: null })
  })
})

describe('mergeSignals', () => {
  it('keeps the previous reading when the new packet lacks it', () => {
    const prev = mergeSignals(EMPTY_SIGNAL, extractSignals({ cardio: { pulseRate: [sample(70)] } }, NOW)!)
    const next = mergeSignals(prev, extractSignals({ breathing: { rate: [sample(12)] } }, NOW + 1)!)
    expect(next.pulse?.value).toBe(70)
    expect(next.breathing?.value).toBe(12)
  })
})

describe('freshnessOf', () => {
  const r = latestReading([sample(70)], 'pulse', NOW)
  it('classifies none / fresh / stale', () => {
    expect(freshnessOf(null, NOW)).toBe('none')
    expect(freshnessOf(r, NOW + 1000)).toBe('fresh')
    expect(freshnessOf(r, NOW + STALE_AFTER_MS + 1)).toBe('stale')
  })
})

describe('toValidationMessage', () => {
  it('prefers the SDK hint', () => {
    const m = toValidationMessage(5, ' Add more light ', NOW)
    expect(m).toMatchObject({ code: 5, name: 'kTooDark', hint: 'Add more light', ok: false })
  })
  it('falls back to local copy and flags kOk', () => {
    expect(toValidationMessage(1, '', NOW).hint).toMatch(/face/i)
    expect(toValidationMessage(0, '', NOW).ok).toBe(true)
  })
  it('tolerates unknown codes', () => {
    expect(toValidationMessage(99, '', NOW).name).toBe('code 99')
  })
})
