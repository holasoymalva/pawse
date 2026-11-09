import type { CatState } from './catState'
import { createRng } from './signalMapping'

/**
 * Ambient personality for the cat: tail sway, head tilts, curious pupils, a soft
 * smile, resting "zzz", whisker sway, and a delighted reaction when petted.
 *
 * Everything here is decorative and driven only by the app's *session state* (never
 * by biometric values), so it can't imply any emotion read from the user. It is
 * deterministic for a given seed and step sequence, and independent of the
 * breathing/heartbeat engine, which it does not modify.
 */

export interface PersonalityFrame {
  /** Tail rotation in degrees (positive = swings out to the right). */
  tail: number
  /** Head tilt in degrees. */
  headTilt: number
  /** Pupil size multiplier (≈0.7 narrow … 1.35 wide). */
  pupil: number
  /** 0 neutral mouth … 1 soft smile. */
  smile: number
  /** 0 hidden … 1 visible resting "zzz". */
  zzz: number
  /** Whisker sway in degrees. */
  whisker: number
  /** Additive ear offsets (-1…1) layered on the engine's ear values. */
  earBoostLeft: number
  earBoostRight: number
  /** 0…1: how strongly the "petted" reaction is playing. */
  delight: number
}

interface StateStyle {
  tailAmp: number
  tailPeriod: number
  tiltEvery: [number, number]
  tiltDeg: number
  pupil: number
  smile: number
  zzz: number
  /** Resting ear perk (forward). */
  earPerk: number
  /** Whether the ears independently swivel as if listening. */
  listen: boolean
}

const STYLES: Readonly<Record<CatState, StateStyle>> = {
  // resting: slow lazy tail, sleepy face, floating z's
  idle: { tailAmp: 3, tailPeriod: 8, tiltEvery: [14, 26], tiltDeg: 3, pupil: 0.8, smile: 0.15, zzz: 1, earPerk: 0, listen: false },
  // curious: wide pupils, perked ears that swivel, frequent head tilts, livelier tail
  searching: { tailAmp: 9, tailPeriod: 3.4, tiltEvery: [2.5, 5], tiltDeg: 9, pupil: 1.3, smile: 0, zzz: 0, earPerk: 0.3, listen: true },
  // patient: calm and attentive
  settling: { tailAmp: 6, tailPeriod: 5, tiltEvery: [8, 15], tiltDeg: 5, pupil: 1.0, smile: 0.4, zzz: 0, earPerk: 0.1, listen: false },
  // peaceful: soft eyes, gentle smile, lazy tail
  connected: { tailAmp: 5, tailPeriod: 6.5, tiltEvery: [10, 20], tiltDeg: 4, pupil: 0.9, smile: 0.85, zzz: 0, earPerk: 0, listen: false },
  // paused signal: looks up, a little wondering
  stale: { tailAmp: 3, tailPeriod: 9, tiltEvery: [6, 11], tiltDeg: 7, pupil: 1.1, smile: 0, zzz: 0, earPerk: 0.15, listen: false },
  // apologetic: still and quiet
  error: { tailAmp: 1.2, tailPeriod: 10, tiltEvery: [18, 30], tiltDeg: 3, pupil: 0.95, smile: 0, zzz: 0, earPerk: 0, listen: false }
}

export const PETTED_DURATION_S = 2.6
const MAX_STEP_S = 0.1
const TAU = 0.5

function approach(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

/** Smooth 0 → 1 → 0 bell over u in [0,1]. */
function bell(u: number): number {
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2
}

interface Timed {
  nextAt: number
  startedAt: number | null
  duration: number
  amount: number
}

export interface PersonalityOptions {
  seed?: number
  /** Scales all motion (e.g. 0.4 for prefers-reduced-motion). */
  motionScale?: number
}

export class PersonalityEngine {
  private state: CatState = 'idle'
  private time = 0
  private readonly rng: () => number
  private readonly scale: number
  private pupil = STYLES.idle.pupil
  private smile = STYLES.idle.smile
  private zzz = STYLES.idle.zzz
  private tailAmp = STYLES.idle.tailAmp
  private earPerk = STYLES.idle.earPerk
  private readonly tilt: Timed
  private readonly flick: Timed
  private readonly listenL: Timed
  private readonly listenR: Timed
  private pettedAt: number | null = null
  private readonly phase: number

  constructor(options: PersonalityOptions = {}) {
    this.rng = createRng((options.seed ?? 1) ^ 0x9e3779b9)
    this.scale = options.motionScale ?? 1
    this.phase = this.rng() * Math.PI * 2
    this.tilt = { nextAt: 6 + this.rng() * 6, startedAt: null, duration: 2.4, amount: 0 }
    this.flick = { nextAt: 5 + this.rng() * 6, startedAt: null, duration: 0.55, amount: 0 }
    this.listenL = { nextAt: 2 + this.rng() * 3, startedAt: null, duration: 1.1, amount: 0 }
    this.listenR = { nextAt: 3 + this.rng() * 3, startedAt: null, duration: 1.1, amount: 0 }
  }

  setState(state: CatState): void {
    this.state = state
  }

  /** The user petted the cat (click/tap/keyboard). Purely visual. */
  pet(): void {
    this.pettedAt = this.time
  }

  step(dtSeconds: number): PersonalityFrame {
    const dt = Math.min(Math.max(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0), MAX_STEP_S)
    this.time += dt
    const style = STYLES[this.state]

    const delight = this.delightLevel()
    this.pupil = approach(this.pupil, style.pupil + delight * 0.35, dt, TAU)
    this.smile = approach(this.smile, Math.max(style.smile, delight), dt, TAU)
    this.zzz = approach(this.zzz, delight > 0.2 ? 0 : style.zzz, dt, 1.2)
    this.tailAmp = approach(this.tailAmp, style.tailAmp * (1 + delight * 0.8), dt, 0.8)
    this.earPerk = approach(this.earPerk, style.earPerk + delight * 0.45, dt, 0.35)

    const t = this.time
    const w = (2 * Math.PI) / style.tailPeriod
    const sway = Math.sin(w * t + this.phase) + 0.45 * Math.sin(w * 1.7 * t + this.phase * 2.1)
    const flick = this.event(this.flick, [6, 14], () => (this.rng() < 0.5 ? -1 : 1) * (10 + this.rng() * 8))
    const tailDeg = (this.tailAmp * sway + flick * bell(this.progress(this.flick))) * this.scale

    const tiltTarget = this.event(this.tilt, style.tiltEvery, () => (this.rng() < 0.5 ? -1 : 1) * style.tiltDeg * (0.6 + this.rng() * 0.6), 1.6, 3.2)
    const tilt = tiltTarget * this.envelope(this.tilt) * this.scale
    const restLean = this.state === 'idle' ? 2.5 : this.state === 'stale' ? -2 : 0

    const listenL = style.listen ? this.event(this.listenL, [1.6, 4], () => 0.35 + this.rng() * 0.4) * bell(this.progress(this.listenL)) : 0
    const listenR = style.listen ? this.event(this.listenR, [1.6, 4], () => 0.35 + this.rng() * 0.4) * bell(this.progress(this.listenR)) : 0

    return {
      tail: tailDeg,
      headTilt: tilt + restLean * this.scale,
      pupil: this.pupil,
      smile: this.smile,
      zzz: this.zzz,
      whisker: (1.6 * Math.sin((2 * Math.PI * t) / 5.2 + this.phase) + delight * 2.2 * Math.sin(t * 16)) * this.scale,
      earBoostLeft: (this.earPerk + listenL) * this.scale,
      earBoostRight: (this.earPerk + listenR) * this.scale,
      delight
    }
  }

  private delightLevel(): number {
    if (this.pettedAt === null) return 0
    const u = (this.time - this.pettedAt) / PETTED_DURATION_S
    if (u >= 1) {
      this.pettedAt = null
      return 0
    }
    return u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85
  }

  private progress(ev: Timed): number {
    return ev.startedAt === null ? 0 : (this.time - ev.startedAt) / ev.duration
  }

  /** Fraction of full tilt: eased in, held, eased out. */
  private envelope(ev: Timed): number {
    const u = this.progress(ev)
    if (ev.startedAt === null || u <= 0 || u >= 1) return 0
    if (u < 0.3) return Math.sin((u / 0.3) * (Math.PI / 2)) ** 2
    if (u > 0.75) return Math.cos(((u - 0.75) / 0.25) * (Math.PI / 2)) ** 2
    return 1
  }

  /**
   * Runs a randomly scheduled event; returns its signed amount while active.
   * `gap` is the wait range until the next event; `dur` optionally randomizes length.
   */
  private event(
    ev: Timed,
    gap: [number, number],
    makeAmount: () => number,
    minDur = ev.duration,
    maxDur = ev.duration
  ): number {
    if (ev.startedAt === null && this.time >= ev.nextAt) {
      ev.startedAt = ev.nextAt
      ev.amount = makeAmount()
      ev.duration = minDur + this.rng() * (maxDur - minDur)
    }
    if (ev.startedAt !== null && this.time - ev.startedAt >= ev.duration) {
      const end = ev.startedAt + ev.duration
      ev.startedAt = null
      ev.nextAt = end + gap[0] + this.rng() * (gap[1] - gap[0])
    }
    return ev.startedAt === null ? 0 : ev.amount
  }
}
