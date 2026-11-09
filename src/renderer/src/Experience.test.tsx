// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_SIGNAL, type SessionState } from '@shared/signal'
import { App } from './App'

const idle = (over: Partial<SessionState> = {}): SessionState => ({
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

let api: Record<'getState' | 'start' | 'stop' | 'getDiagnostics' | 'onState', ReturnType<typeof vi.fn>>

function mount(initial = idle()) {
  api = {
    getState: vi.fn(async () => initial),
    start: vi.fn(async () => initial),
    stop: vi.fn(async () => initial),
    getDiagnostics: vi.fn(async () => null),
    onState: vi.fn(() => () => {})
  }
  ;(window as unknown as { pawse: unknown }).pawse = api
  return render(<App />)
}

async function simulate(id: string, speed = 60) {
  const scenario = (await screen.findByLabelText('Simulation scenario')) as HTMLSelectElement
  await act(async () => fireEvent.change(screen.getByLabelText('Simulation speed'), { target: { value: String(speed) } }))
  await act(async () => fireEvent.change(scenario, { target: { value: id } }))
}
const wake = async () => {
  const btn = await screen.findByRole('button', { name: 'Wake up PAWSE' })
  await act(async () => fireEvent.click(btn))
}
const long = { timeout: 9000 }

vi.setConfig({ testTimeout: 25000 })

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
afterEach(() => cleanup())

describe('the full "Breathe Together" journey (development simulation, ×60 speed)', () => {
  it('meet → connecting → breathe together → a little moment of peace', async () => {
    mount()
    expect(await screen.findByText('Meet PAWSE.')).toBeTruthy()
    await simulate('normal')
    await screen.findByText('SIMULATION')
    await wake()
    expect(await screen.findByText('PAWSE is waking up…')).toBeTruthy()
    expect(await screen.findByText('Breathe together', undefined, long)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Breathe Together progress' })).toBeTruthy()
    expect(screen.getByTestId('chip-breath').textContent).toMatch(/simulated, not real/)
    expect(await screen.findByText('You gave PAWSE a little moment of peace. 💚', undefined, long)).toBeTruthy()
    expect(screen.getByText('That was 60 seconds of live breathing measurement.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start another session' })).toBeTruthy()
    // the cat shows the settled, celebrating scene
    expect(document.querySelector('svg.scene')!.getAttribute('data-stage')).toBe('peace')
  })

  it('"Start another session" returns to the welcome and a new run can begin', async () => {
    mount()
    await simulate('normal')
    await wake()
    await screen.findByText(/moment of peace/, undefined, long)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start another session' })))
    expect(await screen.findByText('Meet PAWSE.')).toBeTruthy()
    await wake()
    expect(await screen.findByText('PAWSE is waking up…')).toBeTruthy()
  })

  it('works for slow, normal and fast breathing presets', async () => {
    for (const preset of ['slow', 'fast']) {
      const { unmount } = mount()
      await simulate(preset)
      await wake()
      expect(await screen.findByText('Breathe together', undefined, long)).toBeTruthy()
      unmount()
    }
  })

  it('cancelling at any moment returns to the welcome', async () => {
    mount()
    await simulate('normal', 1)
    await wake()
    await screen.findByText('Breathe together', undefined, long)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop Session' })))
    expect(await screen.findByText('Meet PAWSE.')).toBeTruthy()
    expect(screen.queryByText(/moment of peace/)).toBeNull()
  })

  it('cancelling while still connecting works too', async () => {
    mount()
    await simulate('searching')
    await wake()
    await screen.findByText('PAWSE is waking up…')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop Session' })))
    expect(await screen.findByText('Meet PAWSE.')).toBeTruthy()
  })

  it('unstable readings never start the timed session', async () => {
    mount()
    await simulate('settling')
    await wake()
    await screen.findByText('PAWSE is waking up…')
    await new Promise((r) => setTimeout(r, 2600))
    expect(screen.queryByText('Breathe together')).toBeNull()
    expect(screen.getByText('Almost there. Keep breathing naturally.')).toBeTruthy()
  })

  it('previews errors, including exhausted credits, without touching the SDK', async () => {
    mount()
    await simulate('credits')
    expect(await screen.findByText('SmartSpectra credits used up')).toBeTruthy()
    await simulate('error')
    expect(await screen.findByText('Simulated', { selector: 'strong' })).toBeTruthy()
  })
})

describe('simulation isolation', () => {
  it('never calls the real SDK API, start, stop or diagnostics beyond reads', async () => {
    mount()
    await simulate('normal')
    await wake()
    await screen.findByText('Breathe together', undefined, long)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop Session' })))
    await simulate('normal')
    await wake()
    await screen.findByText(/moment of peace/, undefined, long)
    expect(api.start).not.toHaveBeenCalled()
    expect(api.stop).not.toHaveBeenCalled()
  })

  it('wakes without needing camera consent (no camera is involved)', async () => {
    mount()
    await simulate('normal')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(((await screen.findByRole('button', { name: 'Wake up PAWSE' })) as HTMLButtonElement).disabled).toBe(false)
  })

  it('labels everything simulated and never as live', async () => {
    mount()
    await simulate('normal', 1)
    await wake()
    await screen.findByText('Breathe together', undefined, long)
    expect(screen.getByText('SIMULATION')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('Simulated').length).toBe(2))
    expect(screen.queryByText(/live reading/)).toBeNull()
    expect(screen.queryByText(/Camera is on/)).toBeNull()
  })

  it('turning the simulation off resets to the real welcome', async () => {
    mount()
    await simulate('normal', 1)
    await wake()
    await screen.findByText('Breathe together', undefined, long)
    const scenario = screen.getByLabelText('Simulation scenario') as HTMLSelectElement
    await act(async () => fireEvent.change(scenario, { target: { value: '' } }))
    expect(await screen.findByText('Meet PAWSE.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('SIMULATION')).toBeNull())
    expect(await screen.findByRole('checkbox')).toBeTruthy()
  })

  it('enabling the simulation while a real session runs stops the real session first', async () => {
    mount(idle({ phase: 'running', processingStatus: 'running' }))
    await screen.findByText('PAWSE is waking up…')
    await simulate('normal', 1)
    await waitFor(() => expect(api.stop).toHaveBeenCalledTimes(1))
  })

  it('switching scenario keeps the experience going', async () => {
    mount()
    await simulate('normal', 1)
    await wake()
    await screen.findByText('Breathe together', undefined, long)
    await simulate('slow', 1)
    await new Promise((r) => setTimeout(r, 600))
    expect(screen.getByText('Breathe together')).toBeTruthy()
  })
})

describe('reduced motion', () => {
  it('the journey still completes with prefers-reduced-motion enabled', async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never
    mount()
    await simulate('normal')
    await wake()
    expect(await screen.findByText(/moment of peace/, undefined, long)).toBeTruthy()
  })
})
