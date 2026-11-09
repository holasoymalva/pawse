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

const wakeButton = () => screen.findByRole('button', { name: 'Wake up PAWSE' }) as Promise<HTMLButtonElement>
const slow = { timeout: 6000 }

beforeEach(() => {
  unsubscribe.mockClear()
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
afterEach(() => cleanup())

describe('Stage 1: meet PAWSE, consent and waking up', () => {
  it('welcomes the user, explains camera use, and keeps the button disabled until consent', async () => {
    mount(baseState())
    const wake = await wakeButton()
    expect(wake.disabled).toBe(true)
    expect(screen.getByText('Meet PAWSE.')).toBeTruthy()
    expect(screen.getByText('A tiny companion that comes alive with your breathing.')).toBeTruthy()
    expect(screen.getByText(/uses your camera to read breathing and pulse/i)).toBeTruthy()
    expect(screen.getByText(/does not save frames or measurements/i)).toBeTruthy()
    expect(screen.getByText(/not a medical device/i)).toBeTruthy()
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(wake.disabled).toBe(false)
  })

  it('never starts without a click; waking up starts once with consent: true and moves to Connecting', async () => {
    mount(baseState())
    const wake = await wakeButton()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(api.start).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(wake))
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.start).toHaveBeenCalledWith({ consent: true })
    expect(await screen.findByText('PAWSE is waking up…')).toBeTruthy()
  })
})

describe('Stage 2: connecting (honest about the signal)', () => {
  it('shows friendly, real-state messages while the camera starts', async () => {
    mount(baseState({ phase: 'starting', processingStatus: 'starting' }))
    expect(await screen.findByText('PAWSE is waking up…')).toBeTruthy()
    expect(screen.getByText('Waking up the camera…')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop Session' })).toBeTruthy()
  })

  it('without readings it keeps looking and never pretends it is connected', async () => {
    mount(baseState({ phase: 'running', processingStatus: 'running' }))
    expect(await screen.findByText(/Looking for you\. Sit comfortably/)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 2200))
    expect(screen.queryByText('Breathe together')).toBeNull()
    expect(screen.getByText('PAWSE is waking up…')).toBeTruthy()
  })

  it('shows SDK validation hints and recovery progress', async () => {
    const hint = { code: 5, name: 'kTooDark', hint: 'Add more light on your face.', ok: false, atMs: 1 }
    mount(baseState({ phase: 'running', validation: hint }))
    expect(await screen.findByText('Add more light on your face.', { selector: 'p.lede' })).toBeTruthy()
    pushState(baseState({ phase: 'starting', recoveryAttempt: 2 }))
    expect(await screen.findByText(/Reconnecting to SmartSpectra… \(attempt 2\)/, { selector: 'p.lede' })).toBeTruthy()
  })

  it('unstable readings keep it in Connecting ("Settling in")', async () => {
    mount(baseState({ phase: 'running', signal: { breathing: reading(14, { stable: false }), pulse: null } }))
    expect(await screen.findByText('Settling in')).toBeTruthy()
    expect(await screen.findByText('Almost there. Keep breathing naturally.')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 2200))
    expect(screen.queryByText('Breathe together')).toBeNull()
  })

  it('stale readings never start the timed session', async () => {
    const old = Date.now() - STALE_AFTER_MS - 5000
    mount(baseState({ phase: 'running', signal: { breathing: reading(14, { receivedAtMs: old }), pulse: null } }))
    expect(await screen.findByText('Signal paused')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 2200))
    expect(screen.queryByText('Breathe together')).toBeNull()
  })
})

describe('Stage 3: breathe together (live measurements only)', () => {
  const live = () => baseState({ phase: 'running', signal: { breathing: reading(14.4), pulse: reading(71.6) } })

  it('starts the timed session once valid live readings are present, with discreet live indicators', async () => {
    mount(live())
    expect(await screen.findByText('Breathe together', undefined, slow)).toBeTruthy()
    expect(screen.getByText(/\d:\d\d left/)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Breathe Together progress' })).toBeTruthy()
    expect(screen.getByTestId('chip-breath').textContent).toMatch(/live reading/)
    expect(screen.getByTestId('chip-heart').textContent).toMatch(/live reading/)
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getByText('72')).toBeTruthy()
    expect(screen.getByText(/not synchronised/i)).toBeTruthy()
    expect(screen.getByText(/Camera is on/)).toBeTruthy()
  })

  it('does not score or judge: no targets, grades or emotion words', async () => {
    mount(live())
    await screen.findByText('Breathe together', undefined, slow)
    const text = document.body.textContent!.toLowerCase()
    for (const word of ['score', 'great job', 'well done', 'stress', 'anxious', 'calm down', 'relaxed', 'target']) {
      expect(text).not.toContain(word)
    }
  })

  it('the Stop button ends the session, releases the camera and returns to the welcome', async () => {
    mount(live())
    await screen.findByText('Breathe together', undefined, slow)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop Session' })))
    expect(api.stop).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Meet PAWSE.')).toBeTruthy()
    expect(screen.queryByText('Breathe together')).toBeNull()
  })

  it('pushes of new state update the live values', async () => {
    mount(live())
    await screen.findByText('Breathe together', undefined, slow)
    pushState(baseState({ phase: 'running', signal: { breathing: reading(16), pulse: reading(64) } }))
    expect(await screen.findByText('64')).toBeTruthy()
  })

  it('a stopped session (phase idle) returns to the welcome', async () => {
    mount(live())
    await screen.findByText('Breathe together', undefined, slow)
    pushState(baseState({ phase: 'idle' }))
    expect(await screen.findByText('Meet PAWSE.')).toBeTruthy()
  })
})

describe('failures are explained and recoverable', () => {
  it('missing key: explains how to fix it and disables Wake up', async () => {
    mount(baseState({ availability: { kind: 'missing-key' } }))
    expect(await screen.findByText('API key missing')).toBeTruthy()
    expect(screen.getByText(/\.env\.example/)).toBeTruthy()
    expect(((await wakeButton()) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('unsupported platform and SDK load failure are explained', async () => {
    mount(baseState({ availability: { kind: 'unsupported-platform', detail: 'no runtime for riscv' } }))
    expect(await screen.findByText('This platform is not supported')).toBeTruthy()
    cleanup()
    mount(baseState({ availability: { kind: 'sdk-load-failed', detail: 'dlopen failed' } }))
    expect(await screen.findByText('SmartSpectra failed to load')).toBeTruthy()
  })

  it('camera permission denial is explained and the user can try again', async () => {
    mount(baseState({
      phase: 'error',
      error: { code: null, name: 'CameraPermission', message: 'Enable the camera in System Settings.', retryable: false }
    }))
    expect(await screen.findByText("PAWSE can't use the camera")).toBeTruthy()
    expect(screen.getByText(/System Settings/)).toBeTruthy()
    expect(await wakeButton()).toBeTruthy()
  })

  it('exhausted SDK credits are explained in plain language', async () => {
    mount(baseState({
      phase: 'error',
      error: { code: 4, name: 'kCreditExhausted', message: 'Status 402 Insufficient credits', retryable: false }
    }))
    expect(await screen.findByText('SmartSpectra credits used up')).toBeTruthy()
    expect(screen.getByText(/physiology\.presagetech\.com/)).toBeTruthy()
  })

  it('a failure mid-session returns to the welcome with the explanation', async () => {
    mount(baseState({ phase: 'running', signal: { breathing: reading(14), pulse: reading(70) } }))
    await screen.findByText('Breathe together', undefined, slow)
    pushState(baseState({
      phase: 'error',
      error: { code: 6, name: 'kServerError', message: 'bad gateway', retryable: true }
    }))
    expect(await screen.findByText("Can't reach SmartSpectra")).toBeTruthy()
    expect(await screen.findByText('Meet PAWSE.')).toBeTruthy()
  })

  it('shows a non-fatal SDK notice while the session keeps running', async () => {
    mount(baseState({
      phase: 'running',
      notice: { code: 11, name: 'kTimestampGap', message: 'gap in frames', atMs: 1 }
    }))
    expect(await screen.findByText(/kTimestampGap/)).toBeTruthy()
    expect(screen.getByText(/still running/i)).toBeTruthy()
  })
})

describe('development diagnostics', () => {
  it('is unavailable (key ignored) when main reports no diagnostics', async () => {
    mount(baseState())
    await wakeButton()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true })
    })
    expect(screen.queryByLabelText('Development diagnostics')).toBeNull()
  })

  it('opens on Cmd+Shift+D when diagnostics are available and closes again', async () => {
    mount(baseState())
    api.getDiagnostics.mockResolvedValue(emptyDiag())
    await wakeButton()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true })
    })
    expect(await screen.findByLabelText('Development diagnostics')).toBeTruthy()
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
    await wakeButton()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalled()
  })
})
