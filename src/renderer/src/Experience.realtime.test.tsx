// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_SIGNAL, type SessionState } from '@shared/signal'
import { App } from './App'

/**
 * Real-session flow (the stubbed preload API stands in for main) on a controlled clock:
 * a full 60 s of valid measurement, signal loss, pause/resume, and camera release,
 * without waiting in real time.
 */
const baseState = (over: Partial<SessionState> = {}): SessionState => ({
  phase: 'running',
  availability: { kind: 'ready' },
  sdkVersion: 'test',
  processingStatus: 'running',
  validation: null,
  signal: EMPTY_SIGNAL,
  error: null,
  notice: null,
  recoveryAttempt: 0,
  ...over
})

const fresh = (stable = true) => ({
  value: 14,
  measuredAtMs: Date.now(),
  receivedAtMs: Date.now(),
  confidence: 80,
  stable
})
const liveState = () => baseState({ signal: { breathing: fresh(), pulse: fresh() } })

let pushState: (s: SessionState) => void
let api: Record<'getState' | 'start' | 'stop' | 'getDiagnostics' | 'onState', ReturnType<typeof vi.fn>>

async function advance(ms: number, refreshEveryMs: number | null = 2000): Promise<void> {
  let sinceRefresh = 0
  for (let t = 0; t < ms; t += 250) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    sinceRefresh += 250
    // The SDK delivers new readings every couple of seconds while the signal is good.
    if (refreshEveryMs !== null && sinceRefresh >= refreshEveryMs) {
      sinceRefresh = 0
      act(() => pushState(liveState()))
    }
  }
}

async function mount(initial: SessionState) {
  api = {
    getState: vi.fn(async () => initial),
    start: vi.fn(async () => initial),
    stop: vi.fn(async () => baseState({ phase: 'idle', processingStatus: 'idle' })),
    getDiagnostics: vi.fn(async () => null),
    onState: vi.fn((l: (s: SessionState) => void) => {
      pushState = l
      return () => {}
    })
  }
  ;(window as unknown as { pawse: unknown }).pawse = api
  render(<App />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const text = (t: string | RegExp) => screen.queryByText(t)

describe('a real session over 60 seconds of valid measurement', () => {
  it('completes after ~60 s of valid time, releases the camera, and shows the moment of peace', async () => {
    await mount(liveState())
    await advance(1000)
    expect(text('PAWSE is waking up…')).toBeTruthy() // the signal must hold briefly first
    await advance(1500)
    expect(text('Breathe together')).toBeTruthy()
    expect(api.stop).not.toHaveBeenCalled()

    await advance(30_000)
    expect(text('Breathe together')).toBeTruthy()
    expect(text(/0:(2\d|3\d) left/)).toBeTruthy() // roughly half-way

    await advance(31_000)
    expect(text('You gave PAWSE a little moment of peace. 💚')).toBeTruthy()
    expect(api.stop).toHaveBeenCalledTimes(1) // camera released on completion
    expect(screen.getByRole('button', { name: 'Start another session' })).toBeTruthy()
  })

  it('does not complete early: ~50 s of valid time is not enough', async () => {
    await mount(liveState())
    await advance(51_000)
    expect(text('Breathe together')).toBeTruthy()
    expect(text(/moment of peace/)).toBeNull()
    expect(api.stop).not.toHaveBeenCalled()
  })

  it('pauses the timer on signal loss and resumes with progress kept', async () => {
    await mount(liveState())
    await advance(22_000)
    const before = screen.getByRole('progressbar').getAttribute('aria-valuenow')
    expect(Number(before)).toBeGreaterThan(15)

    // The SDK stops delivering readings: they go stale after 10 s, then the timer pauses.
    await advance(16_000, null)
    expect(text('Lost your signal')).toBeTruthy()
    expect(screen.getByText('Signal lost', { selector: '.state-pill' })).toBeTruthy()
    expect(screen.getByLabelText('Timer paused')).toBeTruthy()

    const pausedAt = screen.getByLabelText('Timer paused').textContent
    await advance(10_000, null) // still no signal: no time is credited
    expect(screen.getByLabelText('Timer paused').textContent).toBe(pausedAt)

    // Signal returns: after a short recovery it resumes from where it stopped.
    await advance(4000)
    expect(text('Breathe together')).toBeTruthy()
    const after = Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
    expect(after).toBeGreaterThanOrEqual(Number(before))
    expect(after).toBeLessThan(Number(before) + 12)
  })

  it('a cat-less honest fallback: while paused, motion is no longer labelled as a live reading', async () => {
    await mount(liveState())
    await advance(5000)
    expect(screen.getByTestId('chip-breath').textContent).toMatch(/live reading/)
    await advance(18_000, null)
    expect(text('Lost your signal')).toBeTruthy()
    expect(screen.getByTestId('chip-breath').textContent).not.toMatch(/live reading/)
    expect(screen.getByTestId('chip-heart').textContent).toMatch(/off/)
  })

  it('manual cancellation mid-session releases the camera at once', async () => {
    await mount(liveState())
    await advance(8000)
    await act(async () => {
      screen.getByRole('button', { name: 'Stop Session' }).click()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(api.stop).toHaveBeenCalledTimes(1)
    await advance(500, null)
    expect(text('Meet PAWSE.')).toBeTruthy()
  })
})

describe('real data: breathing unsteady while the pulse is fine (seen in a real session)', () => {
  const unsteadyState = () =>
    baseState({ signal: { breathing: { ...fresh(false), value: 10 }, pulse: { ...fresh(true), value: 71 } } })

  it('a brief unsteady stretch does not pause the experience', async () => {
    await mount(liveState())
    await advance(6000)
    expect(text('Breathe together')).toBeTruthy()
    act(() => pushState(unsteadyState()))
    await advance(3000, null)
    expect(text('Breathe together')).toBeTruthy()
    expect(text('Lost your signal')).toBeNull()
  })

  it('a sustained unsteady stretch pauses with an honest explanation, not "Lost your signal"', async () => {
    await mount(liveState())
    await advance(6000)
    const refreshUnsteady = async (ms: number) => {
      for (let t = 0; t < ms; t += 1000) {
        await advance(1000, null)
        act(() => pushState(unsteadyState())) // fresh readings keep arriving, just not stable
      }
    }
    await refreshUnsteady(8000)
    expect(text('Breathing is settling')).toBeTruthy()
    expect(text('Lost your signal')).toBeNull()
    expect(screen.getByLabelText('Timer paused')).toBeTruthy()
    // the pulse is live and the camera is on, and the screen says so consistently
    expect(screen.getByText('71')).toBeTruthy()
    expect(screen.getByText('Signal unstable', { selector: '.state-pill' })).toBeTruthy()
    expect(text('Connected')).toBeNull()
    expect(screen.getByTestId('chip-breath').textContent).toMatch(/still settling/)
  })

  it('resumes as soon as the reading steadies, keeping the progress', async () => {
    await mount(liveState())
    await advance(8000)
    for (let t = 0; t < 8000; t += 1000) {
      await advance(1000, null)
      act(() => pushState(unsteadyState()))
    }
    expect(text('Breathing is settling')).toBeTruthy()
    const paused = Number(screen.getByLabelText('Timer paused').textContent!.match(/(\d+):(\d+)/)!.slice(1).reduce((m, v, i) => (i === 0 ? Number(v) * 60 : m + Number(v)), 0))
    await advance(5000) // fresh stable readings return, then a 1 s recovery hold
    expect(text('Breathe together')).toBeTruthy()
    const now = Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
    expect(60 - now).toBeLessThanOrEqual(paused)
  })
})
