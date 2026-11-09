import type { DiagnosticsSnapshot } from '../shared/diagnostics'
import {
  EMPTY_SIGNAL,
  type Availability,
  type SessionError,
  type SessionState
} from '../shared/signal'
import { Diagnostics } from './diagnostics'
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
  /** Rebuilds the SDK pipeline after an unrecoverable error state; the camera selection is kept. */
  reset(): void
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
  /** Collect development diagnostics (timing/stability only). Off in packaged builds. */
  diagnostics?: boolean
  /** Override timers in tests. */
  timers?: Timers
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout)
}

/** Consecutive undecodable packets tolerated before the session is failed. */
export const MAX_CONSECUTIVE_MALFORMED = 5
/** Pipeline reset attempts before giving up. */
export const MAX_RECOVERY_ATTEMPTS = 3
/** Delay before recovery attempt n is n × this. */
export const RECOVERY_BACKOFF_MS = 750
/** After this long without needing recovery, the attempt budget is restored. */
export const RECOVERY_BUDGET_RESET_MS = 30_000

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
  private readonly timers: Timers
  private readonly diag: Diagnostics | null

  /** Bumped by stop()/fail(); async work started under an older generation is abandoned. */
  private generation = 0
  private malformedStreak = 0
  private recoveryAttempts = 0
  private lastRecoveryAt = 0
  private recovering = false
  private sleepHandle: unknown = null
  private sleepResolve: (() => void) | null = null
  private tickHandle: unknown = null

  constructor(private readonly deps: ServiceDeps) {
    this.now = deps.now ?? Date.now
    this.timers = deps.timers ?? realTimers
    this.diag = deps.diagnostics ? new Diagnostics() : null
    this.state = {
      phase: 'idle',
      availability: deps.apiKey ? { kind: 'ready' } : { kind: 'missing-key' },
      sdkVersion: null,
      processingStatus: 'idle',
      validation: null,
      signal: EMPTY_SIGNAL,
      error: null,
      notice: null,
      recoveryAttempt: 0
    }
  }

  onChange(listener: Listener): void {
    this.listener = listener
  }

  getState(): SessionState {
    return this.state
  }

  /** Null unless diagnostics were enabled (development builds). */
  getDiagnostics(): DiagnosticsSnapshot | null {
    return this.diag ? this.diag.snapshot(this.now()) : null
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

    const gen = ++this.generation
    this.malformedStreak = 0
    this.recoveryAttempts = 0
    this.recovering = false
    this.diag?.begin(this.now())
    this.patch({
      phase: 'starting',
      processingStatus: 'starting',
      validation: null,
      signal: EMPTY_SIGNAL,
      error: null,
      notice: null,
      recoveryAttempt: 0
    })

    try {
      const camera = await this.deps.ensureCameraAccess()
      if (gen !== this.generation) return this.state // stopped while waiting for permission
      if (!camera.granted) {
        throw new SessionFailure(
          'CameraPermission',
          camera.message ?? 'Camera access was not granted.',
          false
        )
      }
      if (!this.runtime) this.runtime = await this.deps.loadRuntime()
      if (gen !== this.generation) return this.state
      const runtime = this.runtime
      const sdk = runtime.create({ apiKey: this.deps.apiKey })
      this.sdk = sdk
      this.attach(sdk, runtime)
      this.startTicking()
      sdk.useCameraDefault()
      sdk.start()
    } catch (e) {
      if (gen === this.generation) await this.fail(toSessionError(e, this.deps.apiKey))
    }
    return this.state
  }

  async stop(): Promise<SessionState> {
    if (this.state.phase === 'idle' && !this.sdk) return this.state
    this.generation++ // abandons any start() / recovery still in flight
    this.recovering = false
    await this.release()
    this.patch({
      phase: 'idle',
      processingStatus: 'idle',
      validation: null,
      signal: EMPTY_SIGNAL,
      notice: null,
      recoveryAttempt: 0
    })
    return this.state
  }

  /** Called on app quit. */
  async dispose(): Promise<void> {
    this.generation++
    await this.release()
  }

  private attach(sdk: SdkInstance, runtime: SdkRuntime): void {
    sdk.on('processingStatus', (status) => {
      if (sdk !== this.sdk) return
      const name = processingStatusName(status)
      this.diag?.status(name, this.now())
      if (name === 'error') {
        void this.recover()
        return
      }
      if (name === 'running') {
        this.patch({ processingStatus: name, phase: 'running', recoveryAttempt: 0 })
        return
      }
      // While recovering, keep the visible phase at 'starting'.
      this.patch({ processingStatus: name })
    })
    sdk.on('validationStatus', (code, _ts, hint) => {
      if (sdk !== this.sdk) return
      const message = toValidationMessage(code, hint, this.now())
      this.diag?.validationSeen(message.name)
      this.patch({ validation: message })
    })
    sdk.on('metrics', (buf) => {
      if (sdk !== this.sdk) return
      this.onMetrics(runtime, buf)
    })
    sdk.on('error', (code, message, retryable) => {
      if (sdk !== this.sdk) return
      this.onSdkError(code, message, retryable)
    })
  }

  private onMetrics(runtime: SdkRuntime, buf: Buffer): void {
    const receivedAt = this.now()
    const next = safeExtract(runtime, buf, receivedAt)
    if (!next) {
      // An isolated undecodable packet is ignored; a sustained run means the stream is broken.
      this.diag?.packet(receivedAt, 'malformed')
      this.malformedStreak++
      if (this.malformedStreak >= MAX_CONSECUTIVE_MALFORMED) {
        void this.fail({
          code: null,
          name: 'DecodeError',
          message: `Received ${this.malformedStreak} undecodable metrics packets in a row.`,
          retryable: false
        })
      }
      return
    }
    this.malformedStreak = 0
    this.diag?.packet(receivedAt, next)
    if (!next.pulse && !next.breathing) return
    if (this.recoveryAttempts > 0 && receivedAt - this.lastRecoveryAt > RECOVERY_BUDGET_RESET_MS) {
      this.recoveryAttempts = 0
    }
    this.patch({ signal: mergeSignals(this.state.signal, next), notice: null })
  }

  private onSdkError(code: number, message: string, retryable: boolean): void {
    const name = errorCodeName(code)
    this.diag?.errorSeen(name)
    const clean = redact(message, this.deps.apiKey)
    if (!retryable) {
      void this.fail({ code, name, message: clean, retryable: false })
      return
    }
    // Retryable: keep the session; the SDK may recover on its own, and if it
    // moves to its error state the processingStatus handler runs a pipeline reset.
    this.patch({ notice: { code, name, message: clean, atMs: this.now() } })
  }

  /** Reset the SDK pipeline after it reported an error state, with backoff and a bounded budget. */
  private async recover(): Promise<void> {
    const sdk = this.sdk
    if (!sdk || this.recovering) return
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      await this.fail({
        code: null,
        name: 'RecoveryFailed',
        message: `The SmartSpectra pipeline could not be recovered after ${MAX_RECOVERY_ATTEMPTS} attempts.`,
        retryable: true
      })
      return
    }
    const gen = this.generation
    this.recovering = true
    this.recoveryAttempts++
    this.lastRecoveryAt = this.now()
    this.diag?.recovery()
    this.patch({
      phase: 'starting',
      processingStatus: 'starting',
      recoveryAttempt: this.recoveryAttempts
    })
    try {
      await this.sleep(RECOVERY_BACKOFF_MS * this.recoveryAttempts)
      if (gen !== this.generation || sdk !== this.sdk) return
      await sdk.stopAsync()
      if (gen !== this.generation || sdk !== this.sdk) return
      sdk.reset()
      sdk.start()
    } catch (e) {
      if (gen === this.generation && sdk === this.sdk) {
        await this.fail(toSessionError(e, this.deps.apiKey))
      }
    } finally {
      if (gen === this.generation) this.recovering = false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepResolve = resolve
      this.sleepHandle = this.timers.setTimeout(() => {
        this.sleepHandle = null
        this.sleepResolve = null
        resolve()
      }, ms)
    })
  }

  private cancelSleep(): void {
    if (this.sleepHandle !== null) this.timers.clearTimeout(this.sleepHandle)
    this.sleepHandle = null
    this.sleepResolve?.()
    this.sleepResolve = null
  }

  private startTicking(): void {
    if (!this.diag || this.tickHandle !== null) return
    this.tickHandle = this.timers.setInterval(() => this.diag?.tick(this.now()), 1000)
  }

  private stopTicking(): void {
    if (this.tickHandle !== null) this.timers.clearInterval(this.tickHandle)
    this.tickHandle = null
  }

  private async fail(error: SessionError): Promise<void> {
    this.generation++
    this.recovering = false
    await this.release()
    this.patch({
      phase: 'error',
      processingStatus: 'error',
      signal: EMPTY_SIGNAL,
      notice: null,
      recoveryAttempt: 0,
      error
    })
  }

  /** Stop and destroy the current SDK instance, if any. Idempotent and serialized. */
  private release(): Promise<void> {
    this.cancelSleep()
    this.stopTicking()
    if (this.teardown) return this.teardown
    const sdk = this.sdk
    this.diag?.end(this.now())
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

/** Decode + extract; any failure (throw or non-object payload) yields null. */
function safeExtract(
  runtime: SdkRuntime,
  buf: Buffer,
  receivedAt: number
): ReturnType<typeof extractSignals> {
  try {
    return extractSignals(runtime.decodeMetrics(buf), receivedAt)
  } catch {
    return null
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
