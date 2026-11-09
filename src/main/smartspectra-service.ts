import {
  EMPTY_SIGNAL,
  type Availability,
  type SessionError,
  type SessionState
} from '../shared/signal'
import {
  errorCodeName,
  extractSignals,
  mergeSignals,
  processingStatusName,
  toValidationMessage
} from './normalize'

/** The subset of SmartSpectraSDK this service uses (matches @smartspectra/node-sdk 3.4 typings). */
export interface SdkInstance {
  on(event: 'processingStatus', cb: (status: number) => void): unknown
  on(event: 'validationStatus', cb: (code: number, timestampUs: number, hint: string) => void): unknown
  on(event: 'metrics', cb: (buf: Buffer, timestampUs: number) => void): unknown
  on(event: 'error', cb: (code: number, message: string, retryable: boolean) => void): unknown
  useCameraDefault(): unknown
  start(): void
  stopAsync(): Promise<void>
  destroy(): Promise<void>
}

export interface SdkRuntime {
  version: string
  create(options: { apiKey: string }): SdkInstance
  /** Decodes a metrics buffer into a plain object (never returns the raw Buffer on success). */
  decodeMetrics(buf: Buffer): unknown
}

export type RuntimeLoader = () => Promise<SdkRuntime>

export interface ServiceDeps {
  apiKey: string | null
  loadRuntime: RuntimeLoader
  /** Resolves true if camera access is granted (macOS TCC prompt handled by caller). */
  ensureCameraAccess: () => Promise<{ granted: boolean; message?: string }>
  now?: () => number
}

type Listener = (state: SessionState) => void

/**
 * Owns the SmartSpectra SDK lifecycle in the Electron main process. A fresh SDK
 * instance is created per session and always destroyed on stop, so the camera
 * and native resources are released when a session ends. Nothing is persisted.
 */
export class SmartSpectraService {
  private state: SessionState
  private runtime: SdkRuntime | null = null
  private sdk: SdkInstance | null = null
  private listener: Listener = () => {}
  private teardown: Promise<void> | null = null
  private readonly now: () => number

  constructor(private readonly deps: ServiceDeps) {
    this.now = deps.now ?? Date.now
    this.state = {
      phase: 'idle',
      availability: deps.apiKey ? { kind: 'ready' } : { kind: 'missing-key' },
      sdkVersion: null,
      processingStatus: 'idle',
      validation: null,
      signal: EMPTY_SIGNAL,
      error: null
    }
  }

  onChange(listener: Listener): void {
    this.listener = listener
  }

  getState(): SessionState {
    return this.state
  }

  /** Probe that the native runtime loads on this platform (no camera, no network). */
  async probe(): Promise<void> {
    if (!this.deps.apiKey) return
    try {
      this.runtime = await this.deps.loadRuntime()
      this.patch({ sdkVersion: this.runtime.version })
    } catch (e) {
      this.patch({ availability: classifyLoadFailure(e) })
    }
  }

  async start(): Promise<SessionState> {
    if (this.state.phase !== 'idle' && this.state.phase !== 'error') return this.state
    if (this.state.availability.kind !== 'ready' || !this.deps.apiKey) return this.state

    this.patch({
      phase: 'starting',
      processingStatus: 'starting',
      validation: null,
      signal: EMPTY_SIGNAL,
      error: null
    })

    try {
      const camera = await this.deps.ensureCameraAccess()
      if (!camera.granted) {
        throw new SessionFailure(
          'CameraPermission',
          camera.message ?? 'Camera access was not granted.',
          false
        )
      }
      if (!this.runtime) this.runtime = await this.deps.loadRuntime()
      const runtime = this.runtime
      const sdk = runtime.create({ apiKey: this.deps.apiKey })
      this.sdk = sdk
      this.attach(sdk, runtime)
      sdk.useCameraDefault()
      sdk.start()
    } catch (e) {
      await this.fail(toSessionError(e, this.deps.apiKey))
    }
    return this.state
  }

  async stop(): Promise<SessionState> {
    if (this.state.phase === 'idle' && !this.sdk) return this.state
    await this.release()
    this.patch({
      phase: 'idle',
      processingStatus: 'idle',
      validation: null,
      signal: EMPTY_SIGNAL
    })
    return this.state
  }

  /** Called on app quit. */
  async dispose(): Promise<void> {
    await this.release()
  }

  private attach(sdk: SdkInstance, runtime: SdkRuntime): void {
    sdk.on('processingStatus', (status) => {
      if (sdk !== this.sdk) return
      const name = processingStatusName(status)
      this.patch({
        processingStatus: name,
        phase: name === 'running' ? 'running' : this.state.phase
      })
    })
    sdk.on('validationStatus', (code, _ts, hint) => {
      if (sdk !== this.sdk) return
      this.patch({ validation: toValidationMessage(code, hint, this.now()) })
    })
    sdk.on('metrics', (buf) => {
      if (sdk !== this.sdk) return
      const receivedAt = this.now()
      let decoded: unknown
      try {
        decoded = runtime.decodeMetrics(buf)
      } catch {
        return this.reportDecodeProblem()
      }
      const next = extractSignals(decoded, receivedAt)
      if (!next) return this.reportDecodeProblem()
      if (!next.pulse && !next.breathing) return
      this.patch({ signal: mergeSignals(this.state.signal, next) })
    })
    sdk.on('error', (code, message, retryable) => {
      if (sdk !== this.sdk) return
      void this.fail({
        code,
        name: errorCodeName(code),
        message: redact(message, this.deps.apiKey),
        retryable
      })
    })
  }

  private reportDecodeProblem(): void {
    void this.fail({
      code: null,
      name: 'DecodeError',
      message: 'Received a metrics packet that could not be decoded.',
      retryable: false
    })
  }

  private async fail(error: SessionError): Promise<void> {
    await this.release()
    this.patch({
      phase: 'error',
      processingStatus: 'error',
      signal: EMPTY_SIGNAL,
      error
    })
  }

  /** Stop and destroy the current SDK instance, if any. Idempotent and serialized. */
  private release(): Promise<void> {
    if (this.teardown) return this.teardown
    const sdk = this.sdk
    if (!sdk) return Promise.resolve()
    this.sdk = null
    this.patch({ phase: 'stopping', processingStatus: 'stopping' })
    this.teardown = (async () => {
      try {
        await sdk.stopAsync()
      } catch {
        // continue: destroy() must still run
      }
      try {
        await sdk.destroy()
      } catch {
        // nothing more to release
      }
    })().finally(() => {
      this.teardown = null
    })
    return this.teardown
  }

  private patch(partial: Partial<SessionState>): void {
    this.state = { ...this.state, ...partial }
    this.listener(this.state)
  }
}

class SessionFailure extends Error {
  constructor(
    readonly errorName: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

function redact(text: string, apiKey: string | null): string {
  return apiKey ? text.split(apiKey).join('[redacted]') : text
}

function toSessionError(e: unknown, apiKey: string | null): SessionError {
  if (e instanceof SessionFailure) {
    return { code: null, name: e.errorName, message: e.message, retryable: e.retryable }
  }
  const err = e as { code?: unknown; message?: unknown; retryable?: unknown }
  const code = typeof err?.code === 'number' ? err.code : null
  const message = typeof err?.message === 'string' ? err.message : 'Unknown SDK error.'
  return {
    code,
    name: code === null ? 'Error' : errorCodeName(code),
    message: redact(message, apiKey),
    retryable: err?.retryable === true
  }
}

function classifyLoadFailure(e: unknown): Availability {
  const detail = e instanceof Error ? e.message : String(e)
  const unsupported = /node-sdk-(darwin|linux|win32)|not installed|unsupported/i.test(detail)
  return unsupported
    ? { kind: 'unsupported-platform', detail }
    : { kind: 'sdk-load-failed', detail }
}
