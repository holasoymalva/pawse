import { describe, expect, it, vi } from 'vitest'
import { AnimationEngine } from './engine'
import { AnimationLoop, type Scheduler } from './loop'
import { frameToCssVars } from './cssVars'

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

describe('frameToCssVars', () => {
  it('produces bounded, subtle transforms', () => {
    const vars = frameToCssVars({
      state: 'connected', breath: 1, breathSource: 'measured', breathBpm: 14,
      heartbeat: 1, blink: 1, earLeft: 1, earRight: -1
    })
    expect(Number(vars['--cat-scale-y'])).toBeLessThanOrEqual(1.05)
    expect(Number(vars['--cat-heart'])).toBeLessThanOrEqual(1.06)
    expect(Number(vars['--cat-eye-y'])).toBeGreaterThan(0)
    expect(vars['--cat-ear-l']).toMatch(/deg$/)
  })
  it('neutral frame leaves the cat untouched', () => {
    const v = frameToCssVars({
      state: 'idle', breath: 0, breathSource: 'ambient', breathBpm: 12,
      heartbeat: 0, blink: 0, earLeft: 0, earRight: 0
    })
    expect(v['--cat-scale-y']).toBe('1.0000')
    expect(v['--cat-eye-y']).toBe('1.000')
  })
})
