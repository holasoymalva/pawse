// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { EMPTY_SIGNAL, STALE_AFTER_MS, type Reading, type SessionState } from '@shared/signal'
import { App } from './App'

const reading = (value: number, over: Partial<Reading> = {}): Reading => ({
  value,
  measuredAtMs: Date.now(),
  receivedAtMs: Date.now(),
  confidence: 80,
  stable: true,
  ...over
})

const baseState = (over: Partial<SessionState> = {}): SessionState => ({
  phase: 'idle',
  availability: { kind: 'ready' },
  sdkVersion: 'test',
  processingStatus: 'idle',
  validation: null,
  signal: EMPTY_SIGNAL,
  error: null,
  notice: null,
  recoveryAttempt: 0,
  ...over
})

const emptyDiag = (): DiagnosticsSnapshot => {
  const sig = {
    readings: 0, receiveIntervals: null, sdkSampleIntervals: null, firstReadingAfterMs: null,
    stabilityFlips: 0, stableReadings: 0, staleTransitions: 0, longestGapMs: null
  }
  return {
    sessionActive: true, sessionUptimeMs: 1000,
    packets: { total: 3, withBreathing: 2, withPulse: 1, withoutReadings: 0, malformed: 0, intervals: null, sinceLastMs: 10 },
    breathing: sig, pulse: sig, validation: {}, errors: {}, recoveries: 0, processingTransitions: []
  }
}

let pushState: (s: SessionState) => void
const unsubscribe = vi.fn()
let api: {
  getState: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  getDiagnostics: ReturnType<typeof vi.fn>
  onState: ReturnType<typeof vi.fn>
}

function mount(initial: SessionState) {
  api = {
    getState: vi.fn(async () => initial),
    start: vi.fn(async () => baseState({ phase: 'starting', processingStatus: 'starting' })),
    stop: vi.fn(async () => baseState()),
    getDiagnostics: vi.fn(async () => null),
    onState: vi.fn((l: (s: SessionState) => void) => {
      pushState = (s) => act(() => l(s))
      return unsubscribe
    })
  }
  ;(window as unknown as { pawse: unknown }).pawse = api
  return render(<App />)
}

beforeEach(() => {
  unsubscribe.mockClear()
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
afterEach(() => cleanup())

describe('consent and session controls', () => {
  it('shows the privacy explanation and keeps Start disabled until consent is given', async () => {
    mount(baseState())
    const start = (await screen.findByRole('button', { name: 'Start Session' })) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(screen.getByText(/does not save frames or measurements/i)).toBeTruthy()
    expect(screen.getByText(/not a medical device/i)).toBeTruthy()
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(start.disabled).toBe(false)
  })

  it('never starts without a click, and starts with consent: true exactly once', async () => {
    mount(baseState())
    const start = await screen.findByRole('button', { name: 'Start Session' })
    fireEvent.click(screen.getByRole('checkbox'))
    await act(async () => fireEvent.click(start))
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.start).toHaveBeenCalledWith({ consent: true })
  })

  it('shows Stop while running and calls stop()', async () => {
    mount(baseState({ phase: 'running', processingStatus: 'running' }))
    const stop = await screen.findByRole('button', { name: 'Stop Session' })
    expect(screen.getByText(/Camera is on/)).toBeTruthy()
    await act(async () => fireEvent.click(stop))
    expect(api.stop).toHaveBeenCalledTimes(1)
  })

  it('disables Stop while the SDK is stopping', async () => {
    mount(baseState({ phase: 'stopping' }))
    expect(((await screen.findByRole('button', { name: 'Stop Session' })) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/releasing the camera/i)).toBeTruthy()
  })
})

describe('blocked and error states', () => {
  it('missing key: explains how to fix it and disables Start', async () => {
    mount(baseState({ availability: { kind: 'missing-key' } }))
    expect(await screen.findByText('API key missing')).toBeTruthy()
    expect(screen.getByText(/\.env\.example/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Start Session' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('unsupported platform is explained', async () => {
    mount(baseState({ availability: { kind: 'unsupported-platform', detail: 'no runtime for riscv' } }))
    expect(await screen.findByText('This platform is not supported')).toBeTruthy()
    expect(screen.getByText(/no runtime for riscv/)).toBeTruthy()
  })

  it('SDK load failure is shown', async () => {
    mount(baseState({ availability: { kind: 'sdk-load-failed', detail: 'dlopen failed' } }))
    expect(await screen.findByText('SmartSpectra failed to load')).toBeTruthy()
  })

  it('error state shows code name and message and lets the user retry', async () => {
    mount(baseState({
      phase: 'error',
      error: { code: 2, name: 'kAuthenticationFailed', message: 'invalid key', retryable: false }
    }))
    expect(await screen.findByText('kAuthenticationFailed')).toBeTruthy()
    expect(screen.getByText(/invalid key/)).toBeTruthy()
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeTruthy()
  })

  it('shows a non-fatal SDK notice while the session keeps running', async () => {
    mount(baseState({
      phase: 'running',
      notice: { code: 11, name: 'kTimestampGap', message: 'gap in frames', atMs: 1 }
    }))
    expect(await screen.findByText(/kTimestampGap/)).toBeTruthy()
    expect(screen.getByText(/still running/i)).toBeTruthy()
  })

  it('shows reconnecting progress during recovery', async () => {
    mount(baseState({ phase: 'starting', recoveryAttempt: 2 }))
    expect(await screen.findByText(/Reconnecting to SmartSpectra… \(attempt 2\)/)).toBeTruthy()
  })

  it('shows SDK validation hints only while a session is active and not ok', async () => {
    const hint = { code: 5, name: 'kTooDark', hint: 'Add more light on your face.', ok: false, atMs: 1 }
    const { rerender } = mount(baseState({ phase: 'running', validation: hint }))
    expect(await screen.findByText('Add more light on your face.')).toBeTruthy()
    pushState(baseState({ phase: 'running', validation: { ...hint, code: 0, name: 'kOk', ok: true } }))
    await waitFor(() => expect(screen.queryByText('Add more light on your face.')).toBeNull())
    rerender(<App />)
  })
})

describe('live vs decorative labelling', () => {
  it('without readings the motion is labelled decorative', async () => {
    mount(baseState({ phase: 'running' }))
    await screen.findByText('Looking for you…')
    expect(screen.getByTestId('chip-breath').textContent).toMatch(/decorative, not a measurement/)
    expect(screen.getByTestId('chip-heart').textContent).toMatch(/off/)
  })

  it('with fresh readings the motion is labelled live and values are shown', async () => {
    mount(baseState({ phase: 'running', signal: { breathing: reading(14.4), pulse: reading(71.6) } }))
    await screen.findByText('Connected')
    expect(screen.getByTestId('chip-breath').textContent).toMatch(/live reading/)
    expect(screen.getByTestId('chip-heart').textContent).toMatch(/live reading/)
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getByText('72')).toBeTruthy()
  })

  it('unstable readings are labelled Settling and still live', async () => {
    mount(baseState({ phase: 'running', signal: { breathing: reading(14, { stable: false }), pulse: null } }))
    await screen.findByText('Settling in')
    expect(screen.getByText('Settling…')).toBeTruthy()
    expect(screen.getByTestId('chip-breath').textContent).toMatch(/live reading/)
  })

  it('old readings show Signal paused and a held, non-live breath chip', async () => {
    const old = Date.now() - STALE_AFTER_MS - 5000
    mount(baseState({
      phase: 'running',
      signal: { breathing: reading(14, { receivedAtMs: old }), pulse: reading(70, { receivedAtMs: old }) }
    }))
    await screen.findByText('Signal paused')
    expect(screen.getByTestId('chip-breath').textContent).toMatch(/last reading/)
    expect(screen.getByTestId('chip-heart').textContent).toMatch(/off/)
    expect(screen.getAllByText('No recent update').length).toBeGreaterThan(0)
  })

  it('updates when new state is pushed from the main process', async () => {
    mount(baseState({ phase: 'running' }))
    await screen.findByText('Looking for you…')
    pushState(baseState({ phase: 'running', signal: { breathing: reading(16), pulse: reading(64) } }))
    await screen.findByText('Connected')
    expect(screen.getByText('64')).toBeTruthy()
  })

  it('explains that the cat follows rate, not each breath', async () => {
    mount(baseState({ phase: 'running' }))
    expect(await screen.findByText(/not synchronised/i)).toBeTruthy()
  })
})

describe('development diagnostics', () => {
  it('is unavailable (key ignored) when main reports no diagnostics', async () => {
    mount(baseState({ phase: 'running' }))
    await screen.findByText('Looking for you…')
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true })
    })
    expect(screen.queryByLabelText('Development diagnostics')).toBeNull()
  })

  it('opens on Cmd+Shift+D when diagnostics are available and closes again', async () => {
    mount(baseState({ phase: 'running', signal: { breathing: reading(15), pulse: null } }))
    api.getDiagnostics.mockResolvedValue(emptyDiag())
    await screen.findByText('Connected')
    await act(async () => {
      fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true })
    })
    expect(await screen.findByLabelText('Development diagnostics')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copy report/ })).toBeTruthy()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true })
    })
    await waitFor(() => expect(screen.queryByLabelText('Development diagnostics')).toBeNull())
  })
})

describe('cleanup', () => {
  it('unmount unsubscribes from main-process state and cancels animation frames', async () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { unmount } = mount(baseState())
    await screen.findByRole('button', { name: 'Start Session' })
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalled()
  })
})
