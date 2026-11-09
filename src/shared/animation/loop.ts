import type { AnimationEngine, AnimationFrame } from './engine'

export interface Scheduler {
  request(callback: (timestampMs: number) => void): number
  cancel(handle: number): void
}

/** Drives an engine from a frame scheduler (requestAnimationFrame in the app). */
export class AnimationLoop {
  private handle: number | null = null
  private last: number | null = null

  constructor(
    private readonly engine: AnimationEngine,
    private readonly onFrame: (frame: AnimationFrame, dtSeconds: number) => void,
    private readonly scheduler: Scheduler
  ) {}

  get running(): boolean {
    return this.handle !== null
  }

  start(): void {
    if (this.handle !== null) return
    this.last = null
    this.handle = this.scheduler.request(this.tick)
  }

  /** Cancels the pending frame. Safe to call repeatedly. */
  stop(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle)
    this.handle = null
    this.last = null
  }

  /** Stop the loop and release the engine. */
  dispose(): void {
    this.stop()
    this.engine.dispose()
  }

  private tick = (timestampMs: number): void => {
    if (this.handle === null) return
    const dt = this.last === null ? 0 : (timestampMs - this.last) / 1000
    this.last = timestampMs
    this.onFrame(this.engine.step(dt), dt)
    if (this.handle !== null) this.handle = this.scheduler.request(this.tick)
  }
}
