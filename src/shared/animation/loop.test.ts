import { describe, expect, it, vi } from 'vitest'
import { AnimationEngine } from './engine'
import { AnimationLoop, type Scheduler } from './loop'
import { frameToCssVars } from './cssVars'
import type { PersonalityFrame } from './personality'

/** Manual scheduler: tracks pending callbacks so cleanup can be asserted. */
function fakeScheduler() {
  let next = 1
  const pending = new Map<number, (t: number) => void>()
  const scheduler: Scheduler = {
    request: (cb) => {
      pending.set(next, cb)
      return next++
    },
    cancel: (h) => void pending.delete(h)
  }
  const tick = (t: number) => {
    const entries = [...pending.entries()]
    pending.clear()
    for (const [, cb] of entries) cb(t)
  }
  return { scheduler, pending, tick }
}

describe('AnimationLoop lifecycle and cleanup', () => {
  it('emits frames while running, with dt derived from timestamps', () => {
    const { scheduler, tick } = fakeScheduler()
    const engine = new AnimationEngine()
    const step = vi.spyOn(engine, 'step')
    const frames: unknown[] = []
    const loop = new AnimationLoop(engine, (f) => frames.push(f), scheduler)
    loop.start()
    tick(1000)
    tick(1016)
    expect(frames).toHaveLength(2)
    expect(step.mock.calls[0]![0]).toBe(0)
    expect(step.mock.calls[1]![0]).toBeCloseTo(0.016)
  })
  it('start is idempotent: only one frame request is ever pending', () => {
    const { scheduler, pending } = fakeScheduler()
    const loop = new AnimationLoop(new AnimationEngine(), () => {}, scheduler)
    loop.start()
    loop.start()
    expect(pending.size).toBe(1)
  })
  it('stop cancels the pending frame and no more frames are produced', () => {
    const { scheduler, pending, tick } = fakeScheduler()
    const onFrame = vi.fn()
    const loop = new AnimationLoop(new AnimationEngine(), onFrame, scheduler)
    loop.start()
    tick(0)
    loop.stop()
    expect(loop.running).toBe(false)
    expect(pending.size).toBe(0)
    tick(16)
    expect(onFrame).toHaveBeenCalledTimes(1)
  })
  it('restart after stop does not apply a huge dt for the paused period', () => {
    const { scheduler, tick } = fakeScheduler()
    const engine = new AnimationEngine()
    const step = vi.spyOn(engine, 'step')
    const loop = new AnimationLoop(engine, () => {}, scheduler)
    loop.start()
    tick(0)
    loop.stop()
    loop.start()
    tick(60_000)
    expect(step.mock.calls.at(-1)![0]).toBe(0)
  })
  it('dispose stops the loop and disables the engine', () => {
    const { scheduler, pending } = fakeScheduler()
    const engine = new AnimationEngine()
    const loop = new AnimationLoop(engine, () => {}, scheduler)
    loop.start()
    loop.dispose()
    expect(pending.size).toBe(0)
    const before = engine.step(0.016)
    engine.setInput({ state: 'connected', breathingBpm: 20, pulseBpm: 80 })
    // input after dispose is ignored: state stays 'idle'
    expect(engine.step(0.016).state).toBe(before.state)
  })
  it('a frame callback that stops the loop prevents rescheduling', () => {
    const { scheduler, pending, tick } = fakeScheduler()
    const holder: { loop?: AnimationLoop } = {}
    holder.loop = new AnimationLoop(new AnimationEngine(), () => holder.loop!.stop(), scheduler)
    holder.loop.start()
    tick(0)
    expect(pending.size).toBe(0)
  })
})

describe('AnimationLoop dt', () => {
  it('passes the step dt to the frame callback', () => {
    const { scheduler, tick } = fakeScheduler()
    const dts: number[] = []
    const loop = new AnimationLoop(new AnimationEngine(), (_f, dt) => dts.push(dt), scheduler)
    loop.start()
    tick(100)
    tick(116)
    expect(dts[0]).toBe(0)
    expect(dts[1]).toBeCloseTo(0.016)
  })
})

describe('frameToCssVars', () => {
  it('produces bounded, subtle transforms', () => {
    const vars = frameToCssVars({
      state: 'connected', breath: 1, breathSource: 'live', breathBpm: 14,
      heartbeat: 1, blink: 1, earLeft: 1, earRight: -1
    })
    expect(Number(vars['--cat-scale-y'])).toBeLessThanOrEqual(1.05)
    expect(Number(vars['--cat-heart'])).toBeLessThanOrEqual(1.06)
    expect(Number(vars['--cat-blink'])).toBe(1)
    expect(Number(vars['--cat-belly'])).toBeLessThanOrEqual(1.11)
    expect(vars['--cat-ear-l']).toMatch(/deg$/)
  })
  it('neutral frame leaves the cat untouched', () => {
    const v = frameToCssVars({
      state: 'idle', breath: 0, breathSource: 'decorative', breathBpm: 12,
      heartbeat: 0, blink: 0, earLeft: 0, earRight: 0
    })
    expect(v['--cat-scale-y']).toBe('1.0000')
    expect(v['--cat-blink']).toBe('0.000')
    expect(v['--cat-pupil']).toBe('1.000')
  })
})

describe('frameToCssVars with personality', () => {
  const frame = {
    state: 'connected' as const, breath: 0.5, breathSource: 'live' as const, breathBpm: 14,
    heartbeat: 0.4, blink: 0.2, earLeft: 0.2, earRight: -0.2
  }
  const p: PersonalityFrame = {
    tail: 6, headTilt: -4, headShiftX: 2, gazeX: 0.5, gazeY: -0.2, lid: 0.1, pupil: 1.2, smile: 0.7, zzz: 0, whisker: 1, earBoostLeft: 0.3, earBoostRight: 0, delight: 0
  }
  it('adds ambient channels and layers ear boosts onto the engine ears', () => {
    const v = frameToCssVars(frame, p)
    expect(v['--cat-tail']).toBe('6.00deg')
    expect(v['--cat-tilt']).toBe('-4.00deg')
    expect(v['--cat-smile']).toBe('0.700')
    expect(parseFloat(v['--cat-ear-l']!)).toBeCloseTo(0.5 * 14, 1)
  })
  it('clamps ears and maps heartbeat to glow', () => {
    const v = frameToCssVars(frame, { ...p, earBoostLeft: 5 })
    expect(parseFloat(v['--cat-ear-l']!)).toBeCloseTo(14, 1)
    expect(v['--cat-glow']).toBe('0.400')
  })
})

describe('settled resting pose (end of the experience)', () => {
  const frame = {
    state: 'idle' as const, breath: 0.2, breathSource: 'decorative' as const, breathBpm: 12,
    heartbeat: 0, blink: 0, earLeft: 0, earRight: 0
  }
  it('is a no-op at 0 and blends in a peaceful pose at 1', () => {
    const rest = frameToCssVars(frame, undefined, 0)
    const settled = frameToCssVars(frame, undefined, 1)
    expect(rest['--cat-blink']).toBe('0.000')
    expect(settled['--cat-blink']).toBe('1.000') // eyes closed
    expect(parseFloat(settled['--cat-head-y']!)).toBeGreaterThan(parseFloat(rest['--cat-head-y']!) + 10)
    expect(parseFloat(settled['--cat-ear-l']!)).toBeLessThan(parseFloat(rest['--cat-ear-l']!))
    expect(parseFloat(settled['--cat-tail']!)).toBeLessThan(parseFloat(rest['--cat-tail']!))
    expect(Number(settled['--cat-smile'])).toBeGreaterThan(0.8)
    expect(Number(settled['--cat-zzz'])).toBeGreaterThan(0.8)
  })
  it('blends smoothly and clamps out-of-range input', () => {
    const half = frameToCssVars(frame, undefined, 0.5)
    expect(Number(half['--cat-blink'])).toBe(0.5)
    expect(frameToCssVars(frame, undefined, 9)['--cat-blink']).toBe('1.000')
    expect(frameToCssVars(frame, undefined, -3)['--cat-blink']).toBe('0.000')
  })
  it('exposes gaze and head-shift variables in px', () => {
    const v = frameToCssVars(frame, { ...{ tail: 0, headTilt: 0, headShiftX: 2, gazeX: 1, gazeY: -1, lid: 0.6, pupil: 1, smile: 0, zzz: 0, whisker: 0, earBoostLeft: 0, earBoostRight: 0, delight: 0 } })
    expect(v['--cat-gaze-x']).toMatch(/px$/)
    expect(v['--cat-head-x']).toBe('2.00px')
    expect(Number(v['--cat-blink'])).toBe(0.6)
  })
})
