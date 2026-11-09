// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAT_STATES } from '@shared/animation/catState'
import { EMPTY_SIGNAL, type SessionState } from '@shared/signal'
import { App } from './App'
import { DESCRIPTION, HEADLINE } from './catCopy'
import { CatScene } from './components/CatScene'

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

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
afterEach(() => cleanup())

describe('the cat illustration', () => {
  it('exposes every animation hook the CSS drives', () => {
    const { container } = render(<CatScene state="idle" svgRef={() => {}} description="The cat is resting." />)
    for (const cls of [
      'c-breath', 'c-belly', 'c-glow', 'c-halo', 'c-head', 'c-ear-l', 'c-ear-r', 'c-tail',
      'c-pupil-l', 'c-pupil-r', 'c-whisker-l', 'c-whisker-r', 'c-mouth-smile', 'c-mouth-neutral', 'c-zzz'
    ]) {
      expect(container.querySelector(`.${cls}`), cls).not.toBeNull()
    }
    expect(container.querySelectorAll('.c-lid')).toHaveLength(2)
  })

  it('has an accessible name that describes the current state', () => {
    for (const s of CAT_STATES) {
      const { container, unmount } = render(<CatScene state={s} svgRef={() => {}} description={DESCRIPTION[s]} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('role')).toBe('img')
      expect(svg.getAttribute('aria-label')).toContain(DESCRIPTION[s])
      unmount()
    }
  })

  it('decorative scenery is hidden from assistive tech', () => {
    const { container } = render(<CatScene state="idle" svgRef={() => {}} description="x" />)
    expect(container.querySelector('g[aria-hidden="true"]')).not.toBeNull()
    expect(container.querySelector('.c-zzz')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('copy and states', () => {
  it('every state has a headline and description; none infers emotion from the user', () => {
    for (const s of CAT_STATES) {
      expect(HEADLINE[s].length).toBeGreaterThan(10)
      expect(DESCRIPTION[s].length).toBeGreaterThan(10)
    }
    const all = [...Object.values(HEADLINE), ...Object.values(DESCRIPTION)].join(' ').toLowerCase()
    for (const banned of ['stress', 'anxious', 'anxiety', 'happy', 'sad', 'calm down', 'you are relaxed']) {
      expect(all).not.toContain(banned)
    }
  })

  it('opens with the core idea within the first view', async () => {
    mount()
    expect(await screen.findByText('Your breathing brings a little companion to life.')).toBeTruthy()
    expect(screen.getByText('A little companion that breathes with you')).toBeTruthy()
  })

  it('hides the vitals row until a session is running', async () => {
    mount()
    await screen.findByText('Resting')
    expect(screen.queryByTestId('chip-breath')).toBeNull()
  })
})

describe('petting microinteraction', () => {
  it('is a real, labelled button that does not touch the SDK', async () => {
    mount()
    const cat = await screen.findByRole('button', { name: /Pet PAWSE/ })
    expect(cat.getAttribute('aria-label')).toContain('resting')
    await act(async () => fireEvent.click(cat))
    await act(async () => fireEvent.keyDown(cat, { key: 'Enter' }))
    expect(api.start).not.toHaveBeenCalled()
    expect(api.stop).not.toHaveBeenCalled()
  })
})

describe('reduced motion', () => {
  it('renders and animates with prefers-reduced-motion enabled', async () => {
    const mm = vi.fn((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    window.matchMedia = mm as never
    const { container } = mount()
    await screen.findByText('Resting')
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    await waitFor(() => expect(container.querySelector('svg.scene')!.getAttribute('style') ?? '').toContain('--cat-'))
  })
})

describe('development-only simulation', () => {
  async function simulate(id: string) {
    const select = (await screen.findByLabelText('Simulation scenario')) as HTMLSelectElement
    await act(async () => fireEvent.change(select, { target: { value: id } }))
  }

  it('is clearly labelled as dev-only and uses no SDK calls', async () => {
    mount()
    expect(await screen.findByText(/DEV ONLY · simulation/)).toBeTruthy()
    expect(screen.getByText(/Never sent to the SDK; uses no credits/)).toBeTruthy()
  })

  it('shows a loud banner, labels every value as simulated, and never presents it as real', async () => {
    mount()
    await simulate('calm')
    expect(await screen.findByText('SIMULATION')).toBeTruthy()
    expect(screen.getByText(/not measured from you/)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('Simulated').length).toBe(2))
    await waitFor(() => expect(screen.getByTestId('chip-breath').textContent).toMatch(/simulated, not real/))
    expect(screen.getByTestId('chip-heart').textContent).toMatch(/simulated, not real/)
    expect(screen.queryByText(/live reading/)).toBeNull()
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy())
  })

  it('replaces the real session controls and never calls the real API', async () => {
    mount()
    await simulate('calm')
    await screen.findByText('SIMULATION')
    expect(screen.queryByRole('button', { name: 'Start Session' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(api.start).not.toHaveBeenCalled()
    expect(api.stop).not.toHaveBeenCalled()
  })

  it('can preview the error and searching looks, then switch back to the real session', async () => {
    mount()
    await simulate('error')
    expect(await screen.findByText('Simulated', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText(/simulated error for visual testing/)).toBeTruthy()
    await simulate('searching')
    expect(await screen.findByText('Looking for you…')).toBeTruthy()
    await simulate('')
    await waitFor(() => expect(screen.queryByText('SIMULATION')).toBeNull())
    expect(await screen.findByRole('button', { name: 'Start Session' })).toBeTruthy()
  })
})
