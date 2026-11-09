import { describe, expect, it } from 'vitest'
import { CAT_STATES, type CatState } from './catState'
import { PersonalityEngine, PETTED_DURATION_S, type PersonalityFrame } from './personality'

const DT = 1 / 60

function run(e: PersonalityEngine, seconds: number): PersonalityFrame[] {
  const out: PersonalityFrame[] = []
  for (let t = 0; t < seconds; t += DT) out.push(e.step(DT))
  return out
}
const settle = (state: CatState, seconds = 60, seed = 3) => {
  const e = new PersonalityEngine({ seed })
  e.setState(state)
  return run(e, seconds)
}
const range = (f: PersonalityFrame[], k: keyof PersonalityFrame) => {
  const v = f.map((x) => x[k])
  return Math.max(...v) - Math.min(...v)
}

describe('PersonalityEngine determinism', () => {
  it('same seed and steps give identical frames', () => {
    expect(settle('connected', 40, 7)).toEqual(settle('connected', 40, 7))
  })
  it('different seeds give different ambient motion', () => {
    expect(settle('connected', 40, 1).map((f) => f.tail)).not.toEqual(settle('connected', 40, 2).map((f) => f.tail))
  })
  it('bad dt values are harmless', () => {
    const e = new PersonalityEngine()
    expect(Number.isFinite(e.step(NaN).tail)).toBe(true)
    expect(Number.isFinite(e.step(-4).headTilt)).toBe(true)
    expect(Number.isFinite(e.step(1e9).tail)).toBe(true)
  })
})

describe('organic ambient behaviour', () => {
  it('the tail keeps moving in every state without repeating exactly', () => {
    for (const s of CAT_STATES) {
      const f = settle(s, 90)
      expect(range(f, 'tail'), `${s} tail moves`).toBeGreaterThan(1)
      const first = f.slice(0, 600).map((x) => x.tail.toFixed(2)).join()
      const later = f.slice(1800, 2400).map((x) => x.tail.toFixed(2)).join()
      expect(first).not.toBe(later)
    }
  })
  it('the head tilts occasionally and returns to rest', () => {
    const f = settle('searching', 60)
    expect(Math.max(...f.map((x) => Math.abs(x.headTilt)))).toBeGreaterThan(3)
    expect(f.some((x) => Math.abs(x.headTilt) < 1.5)).toBe(true)
  })
  it('tilts are bounded', () => {
    for (const s of CAT_STATES) {
      for (const x of settle(s, 60)) {
        expect(Math.abs(x.headTilt)).toBeLessThan(16)
        expect(Math.abs(x.tail)).toBeLessThan(40)
      }
    }
  })
  it('whiskers sway gently', () => {
    const f = settle('connected', 30)
    expect(range(f, 'whisker')).toBeGreaterThan(1)
    expect(Math.max(...f.map((x) => Math.abs(x.whisker)))).toBeLessThan(5)
  })
})

describe('expressions follow session state, never biometrics', () => {
  const last = (s: CatState) => settle(s, 20).at(-1)!
  it('curious while searching: wide pupils and perked, swivelling ears', () => {
    const f = settle('searching', 40)
    expect(f.at(-1)!.pupil).toBeGreaterThan(last('connected').pupil + 0.25)
    expect(f.at(-1)!.earBoostLeft).toBeGreaterThan(0.2)
    expect(range(f.slice(600), 'earBoostLeft')).toBeGreaterThan(0.15)
  })
  it('peaceful when connected: soft smile, no zzz', () => {
    expect(last('connected').smile).toBeGreaterThan(0.7)
    expect(last('connected').zzz).toBeLessThan(0.05)
  })
  it('patient while settling: a little smile, calm', () => {
    const s = last('settling').smile
    expect(s).toBeGreaterThan(0.25)
    expect(s).toBeLessThan(0.6)
  })
  it('sleepy when resting: shows zzz, narrow pupils', () => {
    expect(last('idle').zzz).toBeGreaterThan(0.9)
    expect(last('idle').pupil).toBeLessThan(0.9)
  })
  it('error and stale do not smile', () => {
    expect(last('error').smile).toBeLessThan(0.05)
    expect(last('stale').smile).toBeLessThan(0.05)
  })
  it('expression changes ease in rather than snapping', () => {
    const e = new PersonalityEngine({ seed: 5 })
    e.setState('searching')
    run(e, 10)
    const before = e.step(DT)
    e.setState('connected')
    const after = e.step(DT)
    expect(Math.abs(after.pupil - before.pupil)).toBeLessThan(0.05)
    expect(Math.abs(after.smile - before.smile)).toBeLessThan(0.05)
  })
})

describe('petting microinteraction', () => {
  it('plays a bounded delight reaction and then ends', () => {
    const e = new PersonalityEngine({ seed: 2 })
    e.setState('connected')
    run(e, 10)
    const base = e.step(DT)
    e.pet()
    const during = run(e, PETTED_DURATION_S / 2)
    expect(Math.max(...during.map((f) => f.delight))).toBeGreaterThan(0.8)
    expect(Math.max(...during.map((f) => f.smile))).toBeGreaterThan(base.smile - 0.01)
    expect(Math.max(...during.map((f) => f.earBoostLeft))).toBeGreaterThan(base.earBoostLeft + 0.2)
    const after = run(e, PETTED_DURATION_S * 2).at(-1)!
    expect(after.delight).toBe(0)
  })
  it('wakes the resting cat briefly (zzz fades)', () => {
    const e = new PersonalityEngine({ seed: 2 })
    e.setState('idle')
    run(e, 10)
    e.pet()
    const f = run(e, 1.2)
    expect(Math.min(...f.map((x) => x.zzz))).toBeLessThan(0.7)
  })
})

describe('reduced motion', () => {
  it('motionScale shrinks tail, tilt and whisker motion', () => {
    const full = new PersonalityEngine({ seed: 4 })
    const calm = new PersonalityEngine({ seed: 4, motionScale: 0.4 })
    full.setState('searching')
    calm.setState('searching')
    const a = run(full, 60)
    const b = run(calm, 60)
    expect(range(b, 'tail')).toBeCloseTo(range(a, 'tail') * 0.4, 0)
    expect(Math.max(...b.map((f) => Math.abs(f.headTilt)))).toBeLessThan(
      Math.max(...a.map((f) => Math.abs(f.headTilt))) * 0.5
    )
  })
})
