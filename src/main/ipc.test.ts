import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import { EMPTY_SIGNAL, type SessionState } from '../shared/signal'
import { registerIpc, type IpcMainLike, type SessionApi } from './ipc'

const state: SessionState = {
  phase: 'idle',
  availability: { kind: 'ready' },
  sdkVersion: 'x',
  processingStatus: 'idle',
  validation: null,
  signal: EMPTY_SIGNAL,
  error: null,
  notice: null,
  recoveryAttempt: 0
}

function setup() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l) }
  const service: SessionApi = {
    getState: vi.fn(() => state),
    start: vi.fn(async () => ({ ...state, phase: 'starting' as const })),
    stop: vi.fn(async () => state),
    getDiagnostics: vi.fn(() => null)
  }
  registerIpc(ipc, service)
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
  return { handlers, service, call }
}

describe('IPC handlers', () => {
  it('registers exactly the documented channels (no extras)', () => {
    const { handlers } = setup()
    expect([...handlers.keys()].sort()).toEqual(
      [IPC.getState, IPC.start, IPC.stop, IPC.getDiagnostics].sort()
    )
  })

  it('start requires explicit consent === true', () => {
    const { call, service } = setup()
    for (const bad of [undefined, null, {}, { consent: false }, { consent: 'true' }, { consent: 1 }, 'yes']) {
      expect(() => call(IPC.start, bad)).toThrow(/consent/i)
    }
    expect(service.start).not.toHaveBeenCalled()
  })

  it('start with consent delegates once and returns the new state', async () => {
    const { call, service } = setup()
    await expect(call(IPC.start, { consent: true })).resolves.toMatchObject({ phase: 'starting' })
    expect(service.start).toHaveBeenCalledTimes(1)
  })

  it('stop, getState and getDiagnostics delegate to the service', async () => {
    const { call, service } = setup()
    await call(IPC.stop)
    expect(service.stop).toHaveBeenCalledTimes(1)
    expect(call(IPC.getState)).toEqual(state)
    expect(call(IPC.getDiagnostics)).toBeNull()
  })

  it('does not forward renderer-supplied arguments beyond the consent check', async () => {
    const { call, service } = setup()
    await call(IPC.start, { consent: true, apiKey: 'attacker', camera: 'x' })
    expect(service.start).toHaveBeenCalledWith()
  })
})
