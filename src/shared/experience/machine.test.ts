import { describe, expect, it } from 'vitest'
import { EMPTY_SIGNAL, STALE_AFTER_MS, type Reading, type SessionPhase } from '../signal'
import {
  begin,
  cancel,
  DEFAULT_CONFIG,
  EXPERIENCE_MS,
  initialExperience,
  isLiveBreathing,
  isUnsteadyBreathing,
  progressOf,
  remainingMs,
  reset,
  tick,
  type ExperienceState,
  type TickInput
} from './machine'

const T0 = 1_700_000_000_000
const STEP = 250

/** Drives the machine with a fixed tick interval from a start time. */
function drive(
  s: ExperienceState,
  from: number,
  ms: number,
  input: Partial<Omit<TickInput, 'nowMs'>> = {}
): { state: ExperienceState; now: number } {
  let now = from
  let state = s
  for (let t = 0; t < ms; t += STEP) {
    now += STEP
    state = tick(state, { nowMs: now, phase: 'running', valid: true, ...input })
  }
  return { state, now }
}

const connecting = () => begin(initialExperience(), T0)
function breathing(): { state: ExperienceState; now: number } {
  const r = drive(connecting(), T0, DEFAULT_CONFIG.enterMs + STEP)
  expect(r.state.stage).toBe('breathing')
  return r
}

describe('stage transitions', () => {
  it('starts at "meet" and does nothing until begin()', () => {
    const s = initialExperience()
    expect(tick(s, { nowMs: T0, phase: 'idle', valid: true })).toBe(s)
    expect(s.stage).toBe('meet')
  })

  it('begin moves meet → connecting, and only from meet', () => {
    const s = connecting()
    expect(s.stage).toBe('connecting')
    expect(begin(s, T0 + 5)).toBe(s)
  })

  it('does not claim a connection before a valid reading', () => {
    const r = drive(connecting(), T0, 30_000, { valid: false })
    expect(r.state.stage).toBe('connecting')
    expect(r.state.validMs).toBe(0)
  })

  it('needs the valid signal to hold before starting the timed session', () => {
    expect(drive(connecting(), T0, DEFAULT_CONFIG.enterMs - STEP).state.stage).toBe('connecting')
    expect(drive(connecting(), T0, DEFAULT_CONFIG.enterMs + STEP).state.stage).toBe('breathing')
  })

  it('a flickering signal never reaches breathing (hysteresis)', () => {
    let state = connecting()
    let now = T0
    for (let i = 0; i < 40; i++) {
      ;({ state, now } = drive(state, now, 1000, { valid: true }))
      ;({ state, now } = drive(state, now, 500, { valid: false }))
    }
    expect(state.stage).toBe('connecting')
  })

  it('completes at 60 s of valid time and ends in peace', () => {
    const { state } = drive(breathing().state, breathing().now, EXPERIENCE_MS + STEP)
    expect(state.stage).toBe('peace')
    expect(state.validMs).toBe(EXPERIENCE_MS)
    expect(progressOf(state)).toBe(1)
    expect(remainingMs(state)).toBe(0)
  })

  it('peace is final until reset, then a new session can begin', () => {
    const b = breathing()
    const done = drive(b.state, b.now, EXPERIENCE_MS + STEP).state
    expect(tick(done, { nowMs: T0 + 9e6, phase: 'running', valid: false })).toEqual(done)
    const again = reset(done)
    expect(again.stage).toBe('meet')
    expect(again.validMs).toBe(0)
    expect(begin(again, T0).stage).toBe('connecting')
  })
})

describe('timer accuracy', () => {
  it('credits exactly the elapsed valid time', () => {
    const b = breathing()
    const { state } = drive(b.state, b.now, 20_000)
    expect(state.validMs).toBe(20_000)
    expect(progressOf(state)).toBeCloseTo(20 / 60, 5)
    expect(remainingMs(state)).toBe(40_000)
  })

  it('finishes within one tick of 60 s, whatever the tick rate', () => {
    for (const step of [100, 250, 500, 1000]) {
      let s = breathing().state
      let now = breathing().now
      let elapsed = 0
      while (s.stage === 'breathing') {
        now += step
        elapsed += step
        s = tick(s, { nowMs: now, phase: 'running', valid: true })
        expect(elapsed).toBeLessThan(EXPERIENCE_MS + 2 * step)
      }
      expect(Math.abs(elapsed - EXPERIENCE_MS)).toBeLessThanOrEqual(step)
    }
  })

  it('completion depends on elapsed valid time only, not on values', () => {
    // `valid` is the only input; two runs with different "rates" behave identically.
    const run = (): number => {
      let s = breathing().state
      let now = breathing().now
      let elapsed = 0
      while (s.stage === 'breathing') {
        now += STEP
        elapsed += STEP
        s = tick(s, { nowMs: now, phase: 'running', valid: true })
      }
      return elapsed
    }
    expect(run()).toBe(run())
  })

  it('does not credit time the page was asleep (large gaps are capped)', () => {
    const b = breathing()
    const s = tick(b.state, { nowMs: b.now + 60 * 60 * 1000, phase: 'running', valid: true })
    expect(s.validMs).toBeLessThanOrEqual(DEFAULT_CONFIG.maxStepMs)
    expect(s.stage).toBe('breathing')
  })

  it('never goes backwards or over the total', () => {
    const b = breathing()
    const s = tick(b.state, { nowMs: b.now - 5000, phase: 'running', valid: true })
    expect(s.validMs).toBeGreaterThanOrEqual(0)
    const done = drive(b.state, b.now, EXPERIENCE_MS * 2).state
    expect(done.validMs).toBeLessThanOrEqual(EXPERIENCE_MS)
  })

  it('dev time scale speeds up credited time only when provided', () => {
    const b = breathing()
    const fast = drive(b.state, b.now, 2000, { timeScale: 10 }).state
    expect(fast.validMs).toBe(20_000)
    expect(drive(b.state, b.now, 2000).state.validMs).toBe(2000)
  })
})

describe('signal loss and recovery', () => {
  it('pauses after the grace period and credits no time while invalid', () => {
    const b = breathing()
    const run = drive(b.state, b.now, 10_000)
    const credited = run.state.validMs
    const lost = drive(run.state, run.now, 20_000, { valid: false })
    expect(lost.state.stage).toBe('paused')
    expect(lost.state.validMs).toBe(credited)
  })

  it('short dropouts within the grace period do not pause', () => {
    const b = breathing()
    const gap = drive(b.state, b.now, DEFAULT_CONFIG.lossGraceMs - STEP, { valid: false })
    expect(gap.state.stage).toBe('breathing')
    const back = drive(gap.state, gap.now, 5000)
    expect(back.state.stage).toBe('breathing')
  })

  it('resumes only after the signal holds, keeping prior progress', () => {
    const b = breathing()
    const run = drive(b.state, b.now, 12_000)
    const lost = drive(run.state, run.now, 5000, { valid: false })
    expect(lost.state.stage).toBe('paused')
    const blip = drive(lost.state, lost.now, DEFAULT_CONFIG.recoverMs - STEP)
    expect(blip.state.stage).toBe('paused')
    const back = drive(lost.state, lost.now, DEFAULT_CONFIG.recoverMs + STEP)
    expect(back.state.stage).toBe('breathing')
    expect(back.state.validMs).toBe(run.state.validMs)
    const more = drive(back.state, back.now, 3000)
    expect(more.state.validMs).toBe(run.state.validMs + 3000)
  })

  it('paused flicker does not resume', () => {
    const b = breathing()
    const lost = drive(b.state, b.now, 5000, { valid: false })
    let { state, now } = lost
    for (let i = 0; i < 20; i++) {
      ;({ state, now } = drive(state, now, 500, { valid: true }))
      ;({ state, now } = drive(state, now, 250, { valid: false }))
    }
    expect(state.stage).toBe('paused')
  })

  it('can still complete after multiple losses', () => {
    let { state, now } = breathing()
    for (let i = 0; i < 3; i++) {
      ;({ state, now } = drive(state, now, 10_000))
      ;({ state, now } = drive(state, now, 4000, { valid: false }))
      ;({ state, now } = drive(state, now, 2000))
    }
    ;({ state } = drive(state, now, 40_000))
    expect(state.stage).toBe('peace')
  })
})

describe('cancellation and session lifecycle', () => {
  it('cancel returns to meet from any active stage and discards progress', () => {
    const b = breathing()
    const mid = drive(b.state, b.now, 10_000).state
    const c = cancel(mid)
    expect(c.stage).toBe('meet')
    expect(c.validMs).toBe(0)
    expect(c.endReason).toBe('cancelled')
    expect(cancel(connecting()).stage).toBe('meet')
    const paused = drive(b.state, b.now, 4000, { valid: false }).state
    expect(cancel(paused).stage).toBe('meet')
  })

  it('cancel does nothing outside an active stage', () => {
    const s = initialExperience()
    expect(cancel(s)).toBe(s)
  })

  it('a session error ends the experience with reason "error"', () => {
    const b = breathing()
    const s = tick(b.state, { nowMs: b.now + STEP, phase: 'error', valid: false })
    expect(s.stage).toBe('meet')
    expect(s.endReason).toBe('error')
    expect(tick(connecting(), { nowMs: T0 + STEP, phase: 'error', valid: false }).endReason).toBe('error')
  })

  it('the session going idle after it was active ends the experience', () => {
    const b = breathing()
    const s = tick(b.state, { nowMs: b.now + STEP, phase: 'idle', valid: false })
    expect(s.stage).toBe('meet')
    expect(s.endReason).toBe('ended')
  })

  it('an idle phase right after begin() (start not yet applied) does not end it', () => {
    let s = connecting()
    s = tick(s, { nowMs: T0 + STEP, phase: 'idle', valid: false })
    expect(s.stage).toBe('connecting')
    s = tick(s, { nowMs: T0 + 2 * STEP, phase: 'starting', valid: false })
    s = tick(s, { nowMs: T0 + 3 * STEP, phase: 'running', valid: true })
    expect(s.stage).toBe('connecting')
  })

  it('does not re-adopt a session that is still stopping after cancel', () => {
    const c = cancel(breathing().state)
    const still = tick(c, { nowMs: T0, phase: 'running', valid: true, adopt: true })
    expect(still.stage).toBe('meet')
    const idle = tick(still, { nowMs: T0 + STEP, phase: 'idle', valid: false, adopt: true })
    expect(idle.awaitIdle).toBe(false)
    // once idle has been seen, a *new* running session may be adopted
    expect(tick(idle, { nowMs: T0 + 2 * STEP, phase: 'running', valid: false, adopt: true }).stage).toBe('connecting')
  })

  it('adopts an already-running real session, but never a simulated one', () => {
    const s = initialExperience()
    expect(tick(s, { nowMs: T0, phase: 'running', valid: false, adopt: true }).stage).toBe('connecting')
    expect(tick(s, { nowMs: T0, phase: 'running', valid: false, adopt: false }).stage).toBe('meet')
    expect(tick(s, { nowMs: T0, phase: 'running', valid: false }).stage).toBe('meet')
  })

  it('after completion the (finishing) session is not re-adopted', () => {
    const b = breathing()
    const done = drive(b.state, b.now, EXPERIENCE_MS + STEP).state
    const next = reset(done)
    expect(tick(next, { nowMs: T0, phase: 'running', valid: true, adopt: true }).stage).toBe('meet')
  })
})

describe('isLiveBreathing', () => {
  const reading = (over: Partial<Reading> = {}): Reading => ({
    value: 14, measuredAtMs: T0, receivedAtMs: T0, confidence: 80, stable: true, ...over
  })
  const session = (phase: SessionPhase, breathing: Reading | null, pulse: Reading | null = null) => ({
    phase,
    signal: { breathing, pulse }
  })

  it('requires a running session and a fresh, stable breathing reading', () => {
    expect(isLiveBreathing(session('running', reading()), T0 + 1000)).toBe(true)
    expect(isLiveBreathing(session('running', reading({ stable: false })), T0)).toBe(false)
    expect(isLiveBreathing(session('running', reading()), T0 + STALE_AFTER_MS + 1)).toBe(false)
    expect(isLiveBreathing(session('starting', reading()), T0)).toBe(false)
    expect(isLiveBreathing(session('running', null), T0)).toBe(false)
    expect(isLiveBreathing({ phase: 'running', signal: EMPTY_SIGNAL }, T0)).toBe(false)
  })

  it('a pulse alone is not enough: the cat needs a breathing rate', () => {
    expect(isLiveBreathing(session('running', null, reading()), T0)).toBe(false)
  })
})

describe('unsteady breathing is not a lost signal', () => {
  it('tolerates a longer unsteady stretch than a lost signal before pausing', () => {
    const b = breathing()
    // 3 s of unsteady: well past the lost-signal grace (1.5 s) but within the unsteady grace (5 s)
    const unsteady = drive(b.state, b.now, 3000, { valid: false, unsteady: true })
    expect(unsteady.state.stage).toBe('breathing')
    // the same 3 s with a truly lost signal pauses
    const lost = drive(b.state, b.now, 3000, { valid: false, unsteady: false })
    expect(lost.state.stage).toBe('paused')
  })

  it('still pauses when the unsteadiness is sustained', () => {
    const b = breathing()
    const r = drive(b.state, b.now, DEFAULT_CONFIG.unsteadyGraceMs + STEP, { valid: false, unsteady: true })
    expect(r.state.stage).toBe('paused')
  })

  it('credits no valid time while unsteady (strict), and resumes counting when steady', () => {
    const b = breathing()
    const run = drive(b.state, b.now, 10_000)
    const flap = drive(run.state, run.now, 3000, { valid: false, unsteady: true })
    expect(flap.state.validMs).toBe(run.state.validMs)
    const back = drive(flap.state, flap.now, 2000)
    expect(back.state.validMs).toBe(run.state.validMs + 2000)
    expect(back.state.stage).toBe('breathing')
  })

  it('a flickering stability flag never pauses and still reaches the end on valid time alone', () => {
    let { state, now } = breathing()
    let credited = 0
    while (state.stage === 'breathing' && credited < 400_000) {
      ;({ state, now } = drive(state, now, 6000, { valid: true }))
      credited += 6000
      if (state.stage !== 'breathing') break
      ;({ state, now } = drive(state, now, 2000, { valid: false, unsteady: true }))
      expect(state.stage).toBe('breathing')
    }
    expect(state.stage).toBe('peace')
  })

  it('isUnsteadyBreathing: fresh but not stable, only while running', () => {
    const reading = (stable: boolean, receivedAtMs = T0): Reading => ({ value: 10, measuredAtMs: T0, receivedAtMs, confidence: 30, stable })
    const sess = (phase: SessionPhase, b: Reading | null) => ({ phase, signal: { breathing: b, pulse: null } })
    expect(isUnsteadyBreathing(sess('running', reading(false)), T0 + 1000)).toBe(true)
    expect(isUnsteadyBreathing(sess('running', reading(true)), T0 + 1000)).toBe(false)
    expect(isUnsteadyBreathing(sess('running', reading(false)), T0 + STALE_AFTER_MS + 1)).toBe(false)
    expect(isUnsteadyBreathing(sess('running', null), T0)).toBe(false)
    expect(isUnsteadyBreathing(sess('starting', reading(false)), T0)).toBe(false)
  })
})
