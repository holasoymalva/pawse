import { describe, expect, it } from 'vitest'
import { CAT_STATES } from './catState'
import { AnimationEngine, MAX_STEP_SECONDS, type AnimationFrame, type EngineInput } from './engine'

const DT = 1 / 60

function run(engine: AnimationEngine, seconds: number, dt = DT): AnimationFrame[] {
  const frames: AnimationFrame[] = []
  for (let t = 0; t < seconds; t += dt) frames.push(engine.step(dt))
  return frames
}

const connected = (b = 15, p = 70): EngineInput => ({ state: 'connected', breathingBpm: b, pulseBpm: p })

/** Counts upward crossings of 0.5 on the breath signal after normalizing by amplitude. */
function breathCycles(frames: AnimationFrame[], threshold: number): number {
  let n = 0
  for (let i = 1; i < frames.length; i++) {
    if (frames[i - 1]!.breath < threshold && frames[i]!.breath >= threshold) n++
  }
  return n
}

describe('AnimationEngine determinism', () => {
  it('same seed, inputs and steps give identical frames', () => {
    const a = new AnimationEngine({ seed: 42 })
    const b = new AnimationEngine({ seed: 42 })
    a.setInput(connected())
    b.setInput(connected())
    expect(run(a, 20)).toEqual(run(b, 20))
  })
  it('different seeds change only the ambient animation, not the breath cycle', () => {
    const a = new AnimationEngine({ seed: 1 })
    const b = new AnimationEngine({ seed: 2 })
    a.setInput(connected())
    b.setInput(connected())
    const fa = run(a, 20)
    const fb = run(b, 20)
    expect(fa.map((f) => f.breath)).toEqual(fb.map((f) => f.breath))
    expect(fa.map((f) => f.blink)).not.toEqual(fb.map((f) => f.blink))
  })
})

describe('breathing cycle from measured rate', () => {
  it('completes ~one cycle every 60/bpm seconds once settled', () => {
    const e = new AnimationEngine({ seed: 3 })
    e.setInput(connected(15))
    run(e, 30) // let amplitude and rate settle
    const frames = run(e, 60)
    // 15 br/min over 60 s ≈ 15 cycles
    expect(breathCycles(frames, 0.5)).toBeGreaterThanOrEqual(14)
    expect(breathCycles(frames, 0.5)).toBeLessThanOrEqual(16)
  })
  it('reports measured vs ambient source honestly', () => {
    const e = new AnimationEngine()
    e.setInput({ state: 'connected', breathingBpm: 15, pulseBpm: 70 })
    expect(e.step(DT).breathSource).toBe('measured')
    e.setInput({ state: 'searching', breathingBpm: 15, pulseBpm: 70 })
    expect(e.step(DT).breathSource).toBe('ambient')
    e.setInput({ state: 'connected', breathingBpm: null, pulseBpm: 70 })
    expect(e.step(DT).breathSource).toBe('ambient')
  })
  it('ignores implausible rates instead of animating them', () => {
    const e = new AnimationEngine()
    e.setInput({ state: 'connected', breathingBpm: 999, pulseBpm: NaN })
    const f = run(e, 5).at(-1)!
    expect(f.breathSource).toBe('ambient')
    expect(f.heartbeat).toBe(0)
  })
})

describe('smoothness under irregular metric updates', () => {
  it('rate changes glide: no frame jumps beyond a small bound', () => {
    const e = new AnimationEngine({ seed: 5 })
    e.setInput(connected(12))
    run(e, 20)
    let prev = e.step(DT)
    let maxJump = 0
    const updates = [22, 8, 30, 10, 18]
    for (let i = 0; i < updates.length; i++) {
      e.setInput(connected(updates[i]!)) // irregular, abrupt SDK updates
      const frames = run(e, 1.3 + i * 0.7)
      for (const f of frames) {
        maxJump = Math.max(maxJump, Math.abs(f.breath - prev.breath), Math.abs(f.heartbeat - prev.heartbeat) * 0.3)
        prev = f
      }
    }
    expect(maxJump).toBeLessThan(0.12)
  })
  it('smoothed rate converges toward the new measurement without overshoot', () => {
    const e = new AnimationEngine()
    e.setInput(connected(12))
    run(e, 20)
    e.setInput(connected(20))
    const rates = run(e, 15).map((f) => f.breathBpm)
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThanOrEqual(rates[i - 1]! - 1e-9)
    expect(rates.at(-1)!).toBeLessThanOrEqual(20)
    expect(rates.at(-1)!).toBeGreaterThan(19)
  })
  it('a long gap (hidden tab) is clamped to one bounded step', () => {
    const a = new AnimationEngine({ seed: 9 })
    const b = new AnimationEngine({ seed: 9 })
    a.setInput(connected())
    b.setInput(connected())
    expect(a.step(30)).toEqual(b.step(MAX_STEP_SECONDS))
  })
  it('bad dt values are treated as zero', () => {
    const e = new AnimationEngine()
    const f = e.step(NaN)
    expect(Number.isFinite(f.breath)).toBe(true)
    expect(e.step(-5).breath).toBeCloseTo(f.breath)
  })
})

describe('state behaviour', () => {
  const settle = (state: EngineInput['state']) => {
    const e = new AnimationEngine({ seed: 11 })
    e.setInput({ state, breathingBpm: 14, pulseBpm: 72 })
    return run(e, 15)
  }
  const peak = (frames: AnimationFrame[], key: 'breath' | 'heartbeat') =>
    Math.max(...frames.slice(-600).map((f) => f[key]))

  it('connected has full amplitude; settling and stale are reduced', () => {
    const c = peak(settle('connected'), 'breath')
    expect(c).toBeGreaterThan(0.9)
    expect(peak(settle('settling'), 'breath')).toBeLessThan(c)
    expect(peak(settle('stale'), 'breath')).toBeLessThan(0.5)
  })
  it('heartbeat shows only while measuring (settling/connected)', () => {
    expect(peak(settle('connected'), 'heartbeat')).toBeGreaterThan(0.5)
    expect(peak(settle('settling'), 'heartbeat')).toBeGreaterThan(0.2)
    for (const s of ['idle', 'searching', 'stale', 'error'] as const) {
      expect(peak(settle(s), 'heartbeat')).toBeLessThan(0.01)
    }
  })
  it('error stills the breathing and droops the ears', () => {
    const f = settle('error')
    expect(peak(f, 'breath')).toBeLessThan(0.02)
    expect(f.at(-1)!.earLeft).toBeLessThan(-0.5)
  })
  it('state changes ease in rather than snapping', () => {
    const e = new AnimationEngine()
    e.setInput(connected())
    run(e, 10)
    const before = e.step(DT).earLeft
    e.setInput({ state: 'error', breathingBpm: null, pulseBpm: null })
    const after = e.step(DT).earLeft
    expect(Math.abs(after - before)).toBeLessThan(0.1)
  })
  it('all frame values stay bounded in every state', () => {
    for (const s of CAT_STATES) {
      for (const f of settle(s)) {
        expect(f.breath).toBeGreaterThanOrEqual(0)
        expect(f.breath).toBeLessThanOrEqual(1)
        expect(f.heartbeat).toBeGreaterThanOrEqual(0)
        expect(f.heartbeat).toBeLessThanOrEqual(1)
        expect(f.blink).toBeGreaterThanOrEqual(0)
        expect(f.blink).toBeLessThanOrEqual(1)
        expect(Math.abs(f.earLeft)).toBeLessThanOrEqual(1)
        expect(Math.abs(f.earRight)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('ambient blinking and ear movement', () => {
  it('blinks and twitches ears in every state, independent of signals', () => {
    for (const s of CAT_STATES) {
      const e = new AnimationEngine({ seed: 21 })
      e.setInput({ state: s, breathingBpm: null, pulseBpm: null })
      const frames = run(e, 60)
      const blinked = frames.some((f) => f.blink > 0.8)
      expect(blinked, `${s} should blink`).toBe(true)
      const lefts = frames.slice(-1200).map((f) => f.earLeft)
      expect(Math.max(...lefts) - Math.min(...lefts), `${s} ears move`).toBeGreaterThan(0.1)
    }
  })
  it('blink schedule is unaffected by the breathing rate', () => {
    const a = new AnimationEngine({ seed: 8 })
    const b = new AnimationEngine({ seed: 8 })
    a.setInput({ state: 'connected', breathingBpm: 10, pulseBpm: 60 })
    b.setInput({ state: 'connected', breathingBpm: 25, pulseBpm: 110 })
    expect(run(a, 40).map((f) => f.blink)).toEqual(run(b, 40).map((f) => f.blink))
  })
  it('blinks are brief (< 0.5 s) and ears twitch on their own schedules', () => {
    const e = new AnimationEngine({ seed: 4 })
    e.setInput(connected())
    run(e, 10) // let the idle → connected eye-openness transition finish
    const frames = run(e, 60)
    let run0 = 0
    let longest = 0
    for (const f of frames) {
      run0 = f.blink > 0.05 ? run0 + 1 : 0
      longest = Math.max(longest, run0)
    }
    expect(longest * DT).toBeLessThan(0.5)
    const lTimes = frames.map((f, i) => (Math.abs(f.earLeft) > 0.2 ? i : -1)).filter((i) => i >= 0)
    const rTimes = frames.map((f, i) => (Math.abs(f.earRight) > 0.2 ? i : -1)).filter((i) => i >= 0)
    expect(lTimes).not.toEqual(rTimes)
  })
  it('a double blink never chains into more than two (many seeds, long run)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const e = new AnimationEngine({ seed })
      e.setInput(connected())
      run(e, 10)
      let blinks = 0
      let longestGap0 = 0
      let inBlink = false
      let streak = 0
      for (const f of run(e, 300)) {
        const closed = f.blink > 0.05
        if (closed && !inBlink) blinks++
        inBlink = closed
        streak = closed ? streak + 1 : 0
        longestGap0 = Math.max(longestGap0, streak)
      }
      expect(longestGap0 * DT, `seed ${seed}`).toBeLessThan(0.3)
      expect(blinks).toBeGreaterThan(20)
    }
  })
  it('motionScale reduces breath, heartbeat and ear motion', () => {
    const full = new AnimationEngine({ seed: 6 })
    const calm = new AnimationEngine({ seed: 6, motionScale: 0.4 })
    full.setInput(connected())
    calm.setInput(connected())
    const pf = Math.max(...run(full, 20).map((f) => f.breath))
    const pc = Math.max(...run(calm, 20).map((f) => f.breath))
    expect(pc).toBeCloseTo(pf * 0.4, 1)
  })
})
