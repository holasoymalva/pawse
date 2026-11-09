import { describe, expect, it, vi } from 'vitest'
import {
  MAX_CONSECUTIVE_MALFORMED,
  MAX_RECOVERY_ATTEMPTS,
  SmartSpectraService,
  type SdkInstance,
  type SdkRuntime,
  type Timers
} from './smartspectra-service'

// A fake SDK, used ONLY to unit-test lifecycle logic. It is never used by the app.
function fakeRuntime() {
  const handlers: Record<string, (...a: never[]) => void> = {}
  const calls: string[] = []
  const sdk: SdkInstance = {
    on: ((event: string, cb: (...a: never[]) => void) => {
      handlers[event] = cb
    }) as SdkInstance['on'],
    useCameraDefault: () => void calls.push('useCamera'),
    start: () => void calls.push('start'),
    stopAsync: async () => void calls.push('stopAsync'),
    reset: () => void calls.push('reset'),
    destroy: async () => void calls.push('destroy')
  }
  const runtime: SdkRuntime = {
    version: 'test',
    create: () => sdk,
    decodeMetrics: (buf) => JSON.parse(buf.toString())
  }
  const emit = (event: string, ...args: unknown[]) => (handlers[event] as (...a: unknown[]) => void)(...args)
  return { runtime, calls, emit, sdk }
}

/** Manual timers so backoff/interval behaviour is deterministic and leaks are visible. */
function manualTimers() {
  let id = 0
  const timeouts = new Map<number, { fn: () => void; ms: number }>()
  const intervals = new Map<number, () => void>()
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      timeouts.set(++id, { fn, ms })
      return id
    },
    clearTimeout: (h) => void timeouts.delete(h as number),
    setInterval: (fn) => {
      intervals.set(++id, fn)
      return id
    },
    clearInterval: (h) => void intervals.delete(h as number)
  }
  const fireTimeouts = () => {
    const due = [...timeouts.values()]
    timeouts.clear()
    due.forEach((t) => t.fn())
  }
  return { timers, timeouts, intervals, fireTimeouts }
}

function setup(over: Partial<ConstructorParameters<typeof SmartSpectraService>[0]> = {}) {
  const f = fakeRuntime()
  const t = manualTimers()
  let clock = 1_700_000_000_000
  const svc = new SmartSpectraService({
    apiKey: 'SECRET-KEY',
    loadRuntime: async () => f.runtime,
    ensureCameraAccess: async () => ({ granted: true }),
    now: () => clock,
    timers: t.timers,
    ...over
  })
  return { svc, ...f, ...t, advance: (ms: number) => void (clock += ms) }
}

const metrics = (obj: unknown) => Buffer.from(JSON.stringify(obj))
const pulse = (value: number, extra: Record<string, unknown> = {}) =>
  metrics({ cardio: { pulseRate: [{ value, confidence: 90, stable: true, timestamp: 1, ...extra }] } })

describe('SmartSpectraService basics', () => {
  it('reports missing key without starting', async () => {
    const { svc, calls } = setup({ apiKey: null })
    expect(svc.getState().availability.kind).toBe('missing-key')
    await svc.start()
    expect(calls).toEqual([])
  })

  it('starts the camera session and becomes running on processingStatus=3', async () => {
    const { svc, calls, emit } = setup()
    await svc.start()
    expect(calls).toEqual(['useCamera', 'start'])
    expect(svc.getState().phase).toBe('starting')
    emit('processingStatus', 3)
    expect(svc.getState().phase).toBe('running')
  })

  it('normalizes live metrics and ignores payloads without usable readings', async () => {
    const { svc, emit } = setup()
    await svc.start()
    emit('metrics', metrics({}), 1)
    expect(svc.getState().signal).toEqual({ pulse: null, breathing: null })
    emit('metrics', pulse(71), 2)
    expect(svc.getState().signal.pulse?.value).toBe(71)
  })

  it('surfaces validation hints', async () => {
    const { svc, emit } = setup()
    await svc.start()
    emit('validationStatus', 5, 1, 'Too dark')
    expect(svc.getState().validation?.hint).toBe('Too dark')
  })

  it('stop() stops and destroys the SDK and clears signals', async () => {
    const { svc, calls, emit } = setup()
    await svc.start()
    emit('metrics', pulse(70), 1)
    await svc.stop()
    expect(calls.slice(-2)).toEqual(['stopAsync', 'destroy'])
    expect(svc.getState()).toMatchObject({ phase: 'idle', signal: { pulse: null, breathing: null } })
  })

  it('denied camera permission fails before any SDK is created', async () => {
    const { svc, calls } = setup({ ensureCameraAccess: async () => ({ granted: false, message: 'nope' }) })
    await svc.start()
    expect(calls).toEqual([])
    expect(svc.getState()).toMatchObject({ phase: 'error', error: { name: 'CameraPermission' } })
  })

  it('a start() that throws tears down and reports the SDK error code', async () => {
    const f = fakeRuntime()
    const original = f.runtime.create
    f.runtime.create = (o) => {
      const sdk = original(o)
      sdk.start = () => {
        throw Object.assign(new Error('no camera'), { code: 7, retryable: true })
      }
      return sdk
    }
    const svc = new SmartSpectraService({
      apiKey: 'k',
      loadRuntime: async () => f.runtime,
      ensureCameraAccess: async () => ({ granted: true })
    })
    await svc.start()
    expect(svc.getState().error).toMatchObject({ code: 7, name: 'kInputUnavailable', retryable: true })
    expect(f.calls).toContain('destroy')
  })

  it('classifies a missing native package as unsupported platform', async () => {
    const { svc } = setup({
      loadRuntime: async () => {
        throw new Error('Cannot find @smartspectra/node-sdk-linux-riscv64 (not installed)')
      }
    })
    await svc.probe()
    expect(svc.getState().availability.kind).toBe('unsupported-platform')
  })
})

describe('error handling', () => {
  it('a non-retryable SDK error releases resources and exposes a redacted error', async () => {
    const { svc, calls, emit } = setup()
    await svc.start()
    emit('error', 2, 'bad key SECRET-KEY', false)
    await vi.waitFor(() => expect(svc.getState().phase).toBe('error'))
    expect(calls).toContain('destroy')
    const err = svc.getState().error
    expect(err?.name).toBe('kAuthenticationFailed')
    expect(err?.message).not.toContain('SECRET-KEY')
  })

  it('a retryable SDK error keeps the session alive and shows a notice that clears with data', async () => {
    const { svc, calls, emit } = setup()
    await svc.start()
    emit('processingStatus', 3)
    emit('error', 11, 'timestamp gap', true)
    expect(svc.getState().phase).toBe('running')
    expect(svc.getState().notice).toMatchObject({ name: 'kTimestampGap' })
    expect(calls).not.toContain('destroy')
    emit('metrics', pulse(70), 5)
    expect(svc.getState().notice).toBeNull()
  })
})

describe('malformed packets', () => {
  it('ignores isolated malformed packets and keeps streaming', async () => {
    const { svc, emit } = setup()
    await svc.start()
    emit('metrics', Buffer.from('not json'), 1)
    emit('metrics', pulse(70), 2)
    emit('metrics', Buffer.from('{broken'), 3)
    expect(svc.getState().phase).not.toBe('error')
    expect(svc.getState().signal.pulse?.value).toBe(70)
  })

  it(`fails only after ${MAX_CONSECUTIVE_MALFORMED} consecutive malformed packets`, async () => {
    const { svc, calls, emit } = setup()
    await svc.start()
    for (let i = 0; i < MAX_CONSECUTIVE_MALFORMED - 1; i++) emit('metrics', Buffer.from('x'), i)
    expect(svc.getState().error).toBeNull()
    emit('metrics', Buffer.from('x'), 99)
    await vi.waitFor(() => expect(svc.getState().error?.name).toBe('DecodeError'))
    expect(calls).toContain('destroy')
  })

  it('a good packet resets the malformed streak', async () => {
    const { svc, emit } = setup()
    await svc.start()
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < MAX_CONSECUTIVE_MALFORMED - 1; i++) emit('metrics', Buffer.from('x'), i)
      emit('metrics', pulse(70), 0)
    }
    expect(svc.getState().error).toBeNull()
  })

  it('a decoded-but-raw Buffer payload counts as malformed, not as data', async () => {
    const f = fakeRuntime()
    f.runtime.decodeMetrics = (buf) => buf
    const svc = new SmartSpectraService({
      apiKey: 'k',
      loadRuntime: async () => f.runtime,
      ensureCameraAccess: async () => ({ granted: true }),
      diagnostics: true
    })
    await svc.start()
    f.emit('metrics', Buffer.from([1]), 1)
    expect(svc.getDiagnostics()?.packets.malformed).toBe(1)
    expect(svc.getState().error).toBeNull()
  })
})

describe('recovery', () => {
  it('resets and restarts the pipeline when the SDK reports its error state', async () => {
    const { svc, calls, emit, timeouts, fireTimeouts } = setup()
    await svc.start()
    emit('processingStatus', 3)
    emit('processingStatus', 5) // kError
    expect(svc.getState()).toMatchObject({ phase: 'starting', recoveryAttempt: 1 })
    expect(timeouts.size).toBe(1)
    fireTimeouts()
    await vi.waitFor(() => expect(calls.slice(-3)).toEqual(['stopAsync', 'reset', 'start']))
    emit('processingStatus', 3)
    expect(svc.getState()).toMatchObject({ phase: 'running', recoveryAttempt: 0, error: null })
    expect(calls).not.toContain('destroy')
  })

  it('gives up after the attempt budget and releases the SDK', async () => {
    const { svc, calls, emit, fireTimeouts } = setup()
    await svc.start()
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      emit('processingStatus', 5)
      fireTimeouts()
      await vi.waitFor(() => expect(calls.filter((c) => c === 'reset')).toHaveLength(i + 1))
      await vi.waitFor(() => expect(svc.getState().phase).toBe('starting'))
    }
    emit('processingStatus', 5)
    await vi.waitFor(() => expect(svc.getState().error?.name).toBe('RecoveryFailed'))
    expect(calls).toContain('destroy')
  })

  it('restores the attempt budget after a long healthy period', async () => {
    const { svc, calls, emit, fireTimeouts, advance } = setup()
    await svc.start()
    emit('processingStatus', 5)
    fireTimeouts()
    await vi.waitFor(() => expect(calls).toContain('reset'))
    advance(31_000)
    emit('metrics', pulse(70), 1)
    emit('processingStatus', 5)
    expect(svc.getState().recoveryAttempt).toBe(1) // budget restarted, not 2
  })

  it('stop() during the backoff cancels the pending reset and releases everything', async () => {
    const { svc, calls, emit, timeouts } = setup()
    await svc.start()
    emit('processingStatus', 5)
    expect(timeouts.size).toBe(1)
    await svc.stop()
    expect(timeouts.size).toBe(0)
    expect(calls).not.toContain('reset')
    expect(calls.slice(-2)).toEqual(['stopAsync', 'destroy'])
    expect(svc.getState().phase).toBe('idle')
  })

  it('a failing reset ends in an error state with cleanup', async () => {
    const { svc, calls, emit, fireTimeouts, sdk } = setup()
    await svc.start()
    sdk.reset = () => {
      throw Object.assign(new Error('boom'), { code: 8, retryable: false })
    }
    emit('processingStatus', 5)
    fireTimeouts()
    await vi.waitFor(() => expect(svc.getState().phase).toBe('error'))
    expect(svc.getState().error?.name).toBe('kProcessingFailed')
    expect(calls).toContain('destroy')
  })
})

describe('cancellation', () => {
  it('stop() while waiting for the camera prompt never creates an SDK', async () => {
    let release!: (v: { granted: boolean }) => void
    const gate = new Promise<{ granted: boolean }>((r) => (release = r))
    const { svc, calls } = setup({ ensureCameraAccess: () => gate })
    const starting = svc.start()
    expect(svc.getState().phase).toBe('starting')
    await svc.stop()
    release({ granted: true })
    await starting
    expect(calls).toEqual([])
    expect(svc.getState().phase).toBe('idle')
  })

  it('events from a destroyed SDK are ignored', async () => {
    const { svc, emit } = setup()
    await svc.start()
    await svc.stop()
    emit('metrics', pulse(70), 1)
    emit('processingStatus', 3)
    expect(svc.getState()).toMatchObject({ phase: 'idle', signal: { pulse: null } })
  })

  it('can start again after stop with a fresh SDK', async () => {
    const { svc, calls } = setup()
    await svc.start()
    await svc.stop()
    await svc.start()
    expect(calls.filter((c) => c === 'start')).toHaveLength(2)
  })
})

describe('diagnostics integration', () => {
  it('is null unless enabled', async () => {
    const { svc } = setup()
    expect(svc.getDiagnostics()).toBeNull()
  })

  it('records packets and runs a tick timer that is cleared on stop', async () => {
    const { svc, emit, intervals, advance } = setup({ diagnostics: true })
    await svc.start()
    expect(intervals.size).toBe(1)
    emit('metrics', pulse(70), 1)
    advance(2000)
    emit('metrics', pulse(71, { timestamp: 2 }), 2)
    const d = svc.getDiagnostics()!
    expect(d.packets).toMatchObject({ total: 2, withPulse: 2, withBreathing: 0 })
    expect(d.pulse.receiveIntervals?.meanMs).toBe(2000)
    await svc.stop()
    expect(intervals.size).toBe(0)
    expect(svc.getDiagnostics()?.sessionActive).toBe(false)
  })
})
