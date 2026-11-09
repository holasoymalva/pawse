import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'

const exposed: Record<string, unknown> = {}
const listeners = new Map<string, Set<(...a: unknown[]) => void>>()
const invoke = vi.fn(async () => 'ok')

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (k: string, v: unknown) => void (exposed[k] = v) },
  ipcRenderer: {
    invoke: (...a: unknown[]) => (invoke as (...x: unknown[]) => unknown)(...a),
    on: (c: string, l: (...a: unknown[]) => void) => {
      if (!listeners.has(c)) listeners.set(c, new Set())
      listeners.get(c)!.add(l)
    },
    removeListener: (c: string, l: (...a: unknown[]) => void) => void listeners.get(c)?.delete(l)
  }
}))

type Api = {
  getState(): Promise<unknown>
  start(r: unknown): Promise<unknown>
  stop(): Promise<unknown>
  getDiagnostics(): Promise<unknown>
  onState(l: (s: unknown) => void): () => void
}

describe('preload bridge', () => {
  beforeEach(async () => {
    invoke.mockClear()
    listeners.clear()
    vi.resetModules()
    await import('./index')
  })

  it('exposes only `pawse` with exactly the typed methods, and never ipcRenderer', () => {
    expect(Object.keys(exposed)).toEqual(['pawse'])
    expect(Object.keys(exposed.pawse as object).sort()).toEqual(
      ['getDiagnostics', 'getState', 'onState', 'start', 'stop'].sort()
    )
    expect(JSON.stringify(Object.keys(exposed))).not.toMatch(/ipc/i)
  })

  it('maps each method to its channel', async () => {
    const api = exposed.pawse as Api
    await api.getState()
    await api.start({ consent: true })
    await api.stop()
    await api.getDiagnostics()
    expect(invoke.mock.calls).toEqual([
      [IPC.getState],
      [IPC.start, { consent: true }],
      [IPC.stop],
      [IPC.getDiagnostics]
    ])
  })

  it('onState subscribes, forwards only the state payload, and unsubscribes', () => {
    const api = exposed.pawse as Api
    const seen: unknown[] = []
    const off = api.onState((s) => seen.push(s))
    const set = listeners.get(IPC.stateChanged)!
    expect(set.size).toBe(1)
    ;[...set][0]!({ sender: 'secret-event-object' }, { phase: 'running' })
    expect(seen).toEqual([{ phase: 'running' }])
    off()
    expect(set.size).toBe(0)
  })
})
