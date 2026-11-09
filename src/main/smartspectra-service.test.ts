import { describe, expect, it, vi } from 'vitest'
import { SmartSpectraService, type SdkInstance, type SdkRuntime } from './smartspectra-service'

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
    destroy: async () => void calls.push('destroy')
  }
  const runtime: SdkRuntime = {
    version: 'test',
    create: () => sdk,
    decodeMetrics: (buf) => JSON.parse(buf.toString())
  }
  const emit = (event: string, ...args: unknown[]) => (handlers[event] as (...a: unknown[]) => void)(...args)
  return { runtime, calls, emit }
}

function setup(over: Partial<ConstructorParameters<typeof SmartSpectraService>[0]> = {}) {
  const f = fakeRuntime()
  const svc = new SmartSpectraService({
    apiKey: 'SECRET-KEY',
    loadRuntime: async () => f.runtime,
    ensureCameraAccess: async () => ({ granted: true }),
    now: () => 1_700_000_000_000,
    ...over
  })
  return { svc, ...f }
}

const metrics = (obj: unknown) => Buffer.from(JSON.stringify(obj))

describe('SmartSpectraService', () => {
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
    emit('metrics', metrics({ cardio: { pulseRate: [{ value: 71, confidence: 90, stable: true, timestamp: 1 }] } }), 2)
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
    emit('metrics', metrics({ breathing: { rate: [{ value: 14, confidence: 90, stable: true, timestamp: 1 }] } }), 1)
    await svc.stop()
    expect(calls.slice(-2)).toEqual(['stopAsync', 'destroy'])
    expect(svc.getState()).toMatchObject({ phase: 'idle', signal: { pulse: null, breathing: null } })
  })

  it('SDK errors release resources and expose a redacted error', async () => {
    const { svc, calls, emit } = setup()
    await svc.start()
    emit('error', 2, 'bad key SECRET-KEY', false)
    await vi.waitFor(() => expect(svc.getState().phase).toBe('error'))
    expect(calls).toContain('destroy')
    const err = svc.getState().error
    expect(err?.name).toBe('kAuthenticationFailed')
    expect(err?.message).not.toContain('SECRET-KEY')
  })

  it('an undecodable (raw buffer) payload is an error, not silent data', async () => {
    const f = fakeRuntime()
    f.runtime.decodeMetrics = (buf) => buf
    const svc = new SmartSpectraService({
      apiKey: 'k',
      loadRuntime: async () => f.runtime,
      ensureCameraAccess: async () => ({ granted: true })
    })
    await svc.start()
    f.emit('metrics', Buffer.from([1]), 1)
    await vi.waitFor(() => expect(svc.getState().error?.name).toBe('DecodeError'))
    expect(f.calls).toContain('destroy')
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
