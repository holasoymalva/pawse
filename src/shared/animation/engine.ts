import type { CatState } from './catState'
import {
  AMBIENT_BREATH_BPM,
  bpmToHz,
  breathCurve,
  createRng,
  heartbeatEnvelope,
  sanitizeRate
} from './signalMapping'

export interface EngineInput {
  state: CatState
  /** Latest real breathing rate (breaths/min) or null. Never synthesized by callers. */
  breathingBpm: number | null
  /** Latest real pulse rate (bpm) or null. */
  pulseBpm: number | null
}

/** One rendered animation frame. All values are unitless and bounded. */
export interface AnimationFrame {
  state: CatState
  /** 0 (exhaled) … 1 (inhaled), already multiplied by the current breath amplitude. */
  breath: number
  /** 'measured' when the cycle length comes from a real reading; 'ambient' otherwise. */
  breathSource: 'measured' | 'ambient'
  /** Smoothed rate currently driving the cycle (breaths/min). */
  breathBpm: number
  /** 0 … 1 heartbeat pulse, already scaled by amplitude (0 when no pulse is shown). */
  heartbeat: number
  /** 0 open … 1 closed. */
  blink: number
  /** -1 … 1 per ear (negative = tilted back/out, positive = forward); includes droop. */
  earLeft: number
  earRight: number
}

export interface EngineOptions {
  seed?: number
  /** Scales breath, heartbeat and ear motion (e.g. 0.4 for prefers-reduced-motion). */
  motionScale?: number
}

interface Mood {
  breathAmp: number
  heartAmp: number
  /** Ear droop, 0 = perky … 1 = fully drooped. */
  droop: number
  /** 1 = eyes fully open … 0 = closed. */
  eyeOpen: number
  /** Whether the cycle length comes from the measured rate. */
  useMeasuredBreath: boolean
}

const MOODS: Readonly<Record<CatState, Mood>> = {
  idle: { breathAmp: 0.35, heartAmp: 0, droop: 0.25, eyeOpen: 0.8, useMeasuredBreath: false },
  searching: { breathAmp: 0.45, heartAmp: 0, droop: 0, eyeOpen: 1, useMeasuredBreath: false },
  settling: { breathAmp: 0.7, heartAmp: 0.5, droop: 0, eyeOpen: 1, useMeasuredBreath: true },
  connected: { breathAmp: 1, heartAmp: 1, droop: 0, eyeOpen: 1, useMeasuredBreath: true },
  stale: { breathAmp: 0.35, heartAmp: 0, droop: 0.5, eyeOpen: 0.85, useMeasuredBreath: true },
  error: { breathAmp: 0, heartAmp: 0, droop: 1, eyeOpen: 0.55, useMeasuredBreath: false }
}

/** Time constants (seconds) for first-order smoothing. */
const TAU_AMPLITUDE = 0.6
const TAU_RATE = 2.5
/** Largest step honoured; longer gaps (hidden tab, debugger) are clamped. */
export const MAX_STEP_SECONDS = 0.1

const BLINK_DURATION = 0.16
const EAR_TWITCH_DURATION = 0.35

function approach(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

interface PulseEvent {
  nextAt: number
  startedAt: number | null
  /** Extra events queued after the current one (e.g. second half of a double blink). */
  queued: number
  /** True while the event is the second half of a double (so it cannot chain further). */
  followUp: boolean
  direction: number
}

/**
 * Deterministic animation engine. Given the same seed, inputs and step sequence it
 * always yields identical frames. It holds no timers and touches no DOM.
 *
 * - Breathing and heartbeat phases are accumulated (phase += dt × frequency), so
 *   irregular or sudden rate changes never make the cycle jump; the smoothed rate
 *   glides toward the newest measurement.
 * - Blinking and ear twitches are ambient: scheduled from a seeded RNG and
 *   independent of signals and state (state only changes ear droop / eye openness).
 */
export class AnimationEngine {
  private input: EngineInput = { state: 'idle', breathingBpm: null, pulseBpm: null }
  private time = 0
  private breathPhase = 0
  private heartPhase = 0
  private breathBpm = AMBIENT_BREATH_BPM
  private pulseBpm = 70
  private breathAmp: number
  private heartAmp: number
  private droop: number
  private eyeOpen: number
  private readonly rng: () => number
  private readonly motionScale: number
  private blink: PulseEvent
  private earL: PulseEvent
  private earR: PulseEvent
  private disposed = false

  constructor(options: EngineOptions = {}) {
    this.rng = createRng(options.seed ?? 1)
    this.motionScale = options.motionScale ?? 1
    const mood = MOODS.idle
    this.breathAmp = mood.breathAmp
    this.heartAmp = mood.heartAmp
    this.droop = mood.droop
    this.eyeOpen = mood.eyeOpen
    this.blink = { nextAt: 1.5 + this.rng() * 3, startedAt: null, queued: 0, followUp: false, direction: 1 }
    this.earL = { nextAt: 2 + this.rng() * 5, startedAt: null, queued: 0, followUp: false, direction: 1 }
    this.earR = { nextAt: 3 + this.rng() * 6, startedAt: null, queued: 0, followUp: false, direction: -1 }
  }

  setInput(input: EngineInput): void {
    if (this.disposed) return
    this.input = {
      state: input.state,
      breathingBpm: sanitizeRate('breathing', input.breathingBpm),
      pulseBpm: sanitizeRate('pulse', input.pulseBpm)
    }
  }

  step(dtSeconds: number): AnimationFrame {
    const dt = Math.min(Math.max(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0), MAX_STEP_SECONDS)
    const { state, breathingBpm, pulseBpm } = this.input
    const mood = MOODS[state]
    this.time += dt

    const measuredBreath = mood.useMeasuredBreath && breathingBpm !== null
    const breathTarget = measuredBreath ? breathingBpm : AMBIENT_BREATH_BPM
    const showHeart = mood.heartAmp > 0 && pulseBpm !== null

    this.breathBpm = approach(this.breathBpm, breathTarget, dt, TAU_RATE)
    if (pulseBpm !== null) this.pulseBpm = approach(this.pulseBpm, pulseBpm, dt, TAU_RATE)
    this.breathAmp = approach(this.breathAmp, mood.breathAmp, dt, TAU_AMPLITUDE)
    this.heartAmp = approach(this.heartAmp, showHeart ? mood.heartAmp : 0, dt, TAU_AMPLITUDE)
    this.droop = approach(this.droop, mood.droop, dt, TAU_AMPLITUDE)
    this.eyeOpen = approach(this.eyeOpen, mood.eyeOpen, dt, TAU_AMPLITUDE)

    this.breathPhase = (this.breathPhase + dt * bpmToHz(this.breathBpm)) % 1
    this.heartPhase = (this.heartPhase + dt * bpmToHz(this.pulseBpm)) % 1

    const blinkShape = this.advance(this.blink, BLINK_DURATION, 2.5, 6, true)
    const earLShape = this.advance(this.earL, EAR_TWITCH_DURATION, 3, 9, false)
    const earRShape = this.advance(this.earR, EAR_TWITCH_DURATION, 3, 9, false)

    const s = this.motionScale
    const earBase = -this.droop
    return {
      state,
      breath: breathCurve(this.breathPhase) * this.breathAmp * s,
      breathSource: measuredBreath ? 'measured' : 'ambient',
      breathBpm: this.breathBpm,
      heartbeat: heartbeatEnvelope(this.heartPhase) * this.heartAmp * s,
      blink: Math.min(1, Math.max(blinkShape, 1 - this.eyeOpen)),
      earLeft: clamp1(earBase + earLShape * this.earL.direction * 0.6 * s),
      earRight: clamp1(earBase + earRShape * this.earR.direction * 0.6 * s)
    }
  }

  dispose(): void {
    this.disposed = true
  }

  /** Advance one scheduled ambient event and return its current 0..1 shape. */
  private advance(
    ev: PulseEvent,
    duration: number,
    minGap: number,
    maxGap: number,
    allowDouble: boolean
  ): number {
    if (ev.startedAt === null && this.time >= ev.nextAt) {
      ev.startedAt = ev.nextAt
      if (!allowDouble) ev.direction = this.rng() < 0.5 ? 1 : -1
      if (allowDouble && !ev.followUp && this.rng() < 0.15) ev.queued = 1
      ev.followUp = false
    }
    if (ev.startedAt === null) return 0
    const u = (this.time - ev.startedAt) / duration
    if (u >= 1) {
      const endedAt = ev.startedAt + duration
      ev.startedAt = null
      if (ev.queued > 0) {
        ev.queued -= 1
        ev.followUp = true
        ev.nextAt = endedAt + 0.12
      } else {
        ev.nextAt = endedAt + minGap + this.rng() * (maxGap - minGap)
      }
      return 0
    }
    return Math.sin(Math.PI * u)
  }
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v))
}
