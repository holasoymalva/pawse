import { describe, expect, it } from 'vitest'
import { frameToCssVars } from './cssVars'
import { AnimationEngine } from './engine'
import { PersonalityEngine } from './personality'

/**
 * End-to-end through the layer the SVG actually reads (CSS variables):
 * a measured rate must show up as the right number of visible breath cycles and
 * heartbeat pulses. Deterministic: runs the engines at a fixed 60 fps.
 */
const DT = 1 / 60

function simulate(breathBpm: number | null, pulseBpm: number | null, seconds: number, warmup = 30) {
  const engine = new AnimationEngine({ seed: 9 })
  const personality = new PersonalityEngine({ seed: 9 })
  engine.setInput({ state: 'connected', breathingBpm: breathBpm, pulseBpm })
  personality.setState('connected')
  const vars: Record<string, string>[] = []
  for (let t = 0; t < warmup + seconds; t += DT) {
    const v = frameToCssVars(engine.step(DT), personality.step(DT))
    if (t >= warmup) vars.push(v)
  }
  return vars
}

function crossings(values: number[], level: number): number {
  let n = 0
  for (let i = 1; i < values.length; i++) if (values[i - 1]! < level && values[i]! >= level) n++
  return n
}

describe('measured rates reach the visual layer', () => {
  it.each([8, 12, 15, 24])('%i breaths/min gives that many belly cycles per minute (±1)', (bpm) => {
    const v = simulate(bpm, 70, 60).map((x) => Number(x['--cat-belly']))
    const mid = (Math.max(...v) + Math.min(...v)) / 2
    expect(Math.abs(crossings(v, mid) - bpm)).toBeLessThanOrEqual(1)
  })

  it.each([55, 72, 98])('%i bpm gives that many chest-glow pulses per minute (±2)', (bpm) => {
    const v = simulate(15, bpm, 60).map((x) => Number(x['--cat-glow']))
    // 0.8 sits above the softer "dub" (peak 0.6), so only the main "lub" of each beat counts
    expect(Math.abs(crossings(v, 0.8) - bpm)).toBeLessThanOrEqual(2)
  })

  it('the belly and body visibly move, but stay subtle', () => {
    const v = simulate(15, 70, 30)
    const belly = v.map((x) => Number(x['--cat-belly']))
    expect(Math.max(...belly) - Math.min(...belly)).toBeGreaterThan(0.05)
    expect(Math.max(...belly)).toBeLessThan(1.12)
    const body = v.map((x) => Number(x['--cat-scale-y']))
    expect(Math.max(...body)).toBeLessThan(1.06)
  })

  it('without a measured pulse there is no heartbeat glow', () => {
    const v = simulate(15, null, 30).map((x) => Number(x['--cat-glow']))
    expect(Math.max(...v)).toBe(0)
  })

  it('the breathing tempo glides to a new measured rate instead of jumping', () => {
    const engine = new AnimationEngine({ seed: 1 })
    engine.setInput({ state: 'connected', breathingBpm: 10, pulseBpm: 70 })
    for (let i = 0; i < 60 * 30; i++) engine.step(DT)
    engine.setInput({ state: 'connected', breathingBpm: 24, pulseBpm: 70 })
    const rates: number[] = []
    for (let i = 0; i < 60 * 3; i++) rates.push(engine.step(DT).breathBpm)
    expect(rates[0]!).toBeLessThan(11)
    expect(rates.at(-1)!).toBeLessThan(24)
    for (let i = 1; i < rates.length; i++) expect(rates[i]! - rates[i - 1]!).toBeLessThan(0.2)
  })
})
