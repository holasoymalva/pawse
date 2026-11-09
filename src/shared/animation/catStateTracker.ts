import type { CatState } from './catState'

export interface HysteresisConfig {
  /** settling → connected: raw must be `connected` this long. */
  promoteMs: number
  /** connected → settling: raw must be `settling` this long. */
  demoteMs: number
  /** live → stale: raw must be `stale` this long (on top of the 10 s data timeout). */
  staleMs: number
  /** stale → live: raw must be live this long. */
  recoverMs: number
}

export const DEFAULT_HYSTERESIS: HysteresisConfig = {
  promoteMs: 1500,
  demoteMs: 4000,
  staleMs: 2000,
  recoverMs: 1000
}

export interface StateTransition {
  from: CatState
  to: CatState
  atMs: number
}

const LIVE: readonly CatState[] = ['settling', 'connected']

/**
 * Smooths the raw cat state so brief flips (e.g. the SDK toggling `stable`, or a
 * packet arriving just after the stale timeout) don't make the label or mood flicker.
 *
 * Session-level states (idle, searching, error) are applied immediately because
 * they come from explicit session events rather than noisy data. Moves among the
 * live states (settling, connected, stale) require the new raw state to persist.
 */
export class CatStateTracker {
  private current: CatState
  private pending: { target: CatState; since: number } | null = null
  readonly history: StateTransition[] = []

  constructor(
    private readonly config: HysteresisConfig = DEFAULT_HYSTERESIS,
    initial: CatState = 'idle',
    private readonly maxHistory = 30
  ) {
    this.current = initial
  }

  get state(): CatState {
    return this.current
  }

  update(raw: CatState, nowMs: number): CatState {
    if (raw === this.current) {
      this.pending = null
      return this.current
    }
    const immediate =
      raw === 'idle' ||
      raw === 'error' ||
      raw === 'searching' ||
      !LIVE.concat('stale').includes(this.current)
    if (immediate) return this.commit(raw, nowMs)

    if (!this.pending || this.pending.target !== raw) this.pending = { target: raw, since: nowMs }
    if (nowMs - this.pending.since >= this.holdFor(this.current, raw)) return this.commit(raw, nowMs)
    return this.current
  }

  private holdFor(from: CatState, to: CatState): number {
    if (to === 'stale') return this.config.staleMs
    if (from === 'stale') return this.config.recoverMs
    if (to === 'connected') return this.config.promoteMs
    return this.config.demoteMs // connected → settling
  }

  private commit(next: CatState, nowMs: number): CatState {
    this.history.push({ from: this.current, to: next, atMs: nowMs })
    if (this.history.length > this.maxHistory) this.history.shift()
    this.current = next
    this.pending = null
    return next
  }
}
