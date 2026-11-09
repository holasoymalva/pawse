import type { CatState } from './catState'
import { createRng } from './signalMapping'

/**
 * Ambient personality for the cat: tail sway, flicks and swishes, head tilts and
 * shifts, curious glances, slow blinks, pupil size, a soft smile, resting "zzz",
 * whisker sway, and a delighted reaction when petted.
 *
 * Everything here is decorative and driven only by the app's *session state* (never
 * by biometric values), so it can't imply any emotion read from the user. It is
 * deterministic for a given seed and step sequence, and independent of the
 * breathing/heartbeat engine, which it does not modify.
 *
 * Organic feel comes from (a) frequencies that drift and amplitudes that breathe
 * slowly, (b) randomly timed events with skewed gaps and random durations/sizes,
 * and (c) an activity budget so the cat never does too many things at once.
 */

export interface PersonalityFrame {
  /** Tail rotation in degrees (positive = swings out to the right). */
  tail: number
  /** Head tilt in degrees. */
  headTilt: number
  /** Small sideways head adjustment in px (positive = right). */
  headShiftX: number
  /** Eye gaze, -1…1 (x: left→right, y: up→down). */
  gazeX: number
  gazeY: number
  /** Extra upper-lid closure 0…1 (slow, content blinks), combined with the engine's blinks. */
  lid: number
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

type Range = readonly [number, number]

interface StateStyle {
  tailAmp: number
  tailPeriod: number
  pupil: number
  smile: number
  zzz: number
  /** Resting ear perk (forward). */
  earPerk: number
  /** Whether the ears independently swivel as if listening. */
  listen: boolean
  /** Seconds between events; null = never in this state. */
  tilt: Range
  tiltDeg: number
  shift: Range | null
  flick: Range | null
  swish: Range | null
  glance: Range | null
  glanceSize: number
  slowBlink: Range | null
}

const STYLES: Readonly<Record<CatState, StateStyle>> = {
  // resting: slow lazy tail, sleepy face, rare small glances, floating z's
  idle: { tailAmp: 3, tailPeriod: 8, pupil: 0.8, smile: 0.15, zzz: 1, earPerk: 0, listen: false, tilt: [14, 26], tiltDeg: 3, shift: null, flick: [14, 30], swish: null, glance: [14, 28], glanceSize: 0.45, slowBlink: null },
  // curious: wide pupils, perked and swivelling ears, frequent tilts and glances, livelier tail
  searching: { tailAmp: 9, tailPeriod: 3.4, pupil: 1.3, smile: 0, zzz: 0, earPerk: 0.3, listen: true, tilt: [2.5, 5], tiltDeg: 9, shift: [3, 7], flick: [6, 14], swish: [12, 22], glance: [1.6, 3.8], glanceSize: 1, slowBlink: null },
  // patient: calm and attentive
  settling: { tailAmp: 6, tailPeriod: 5, pupil: 1.0, smile: 0.4, zzz: 0, earPerk: 0.1, listen: false, tilt: [8, 15], tiltDeg: 5, shift: [9, 18], flick: [8, 18], swish: [16, 30], glance: [5, 11], glanceSize: 0.75, slowBlink: [14, 28] },
  // peaceful: soft eyes, gentle smile, lazy tail, slow blinks
  connected: { tailAmp: 5, tailPeriod: 6.5, pupil: 0.9, smile: 0.85, zzz: 0, earPerk: 0, listen: false, tilt: [10, 20], tiltDeg: 4, shift: [10, 22], flick: [9, 20], swish: [14, 28], glance: [5, 12], glanceSize: 0.65, slowBlink: [11, 22] },
  // paused signal: looks around a little, wondering
  stale: { tailAmp: 3, tailPeriod: 9, pupil: 1.1, smile: 0, zzz: 0, earPerk: 0.15, listen: false, tilt: [6, 11], tiltDeg: 7, shift: [8, 16], flick: null, swish: null, glance: [3.5, 8], glanceSize: 0.9, slowBlink: null },
  // apologetic: still and quiet
  error: { tailAmp: 1.2, tailPeriod: 10, pupil: 0.95, smile: 0, zzz: 0, earPerk: 0, listen: false, tilt: [18, 30], tiltDeg: 3, shift: null, flick: null, swish: null, glance: [20, 40], glanceSize: 0.3, slowBlink: null }
}

export const PETTED_DURATION_S = 2.6
const MAX_STEP_S = 0.1
const TAU = 0.5
/** At most this many "major" body movements (head/tail/ears) at once. */
export const MAX_MAJOR_ACTIVE = 2
/** Minimum seconds between the *starts* of two major movements. */
const MAJOR_COOLDOWN_S = 0.6

function approach(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

/** Smooth 0 → 1 → 0 bell over u in [0,1]. */
function bell(u: number): number {
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2
}

/** Eased in, held, eased out (for tilts and glances). */
function hold(u: number): number {
  if (u <= 0 || u >= 1) return 0
  if (u < 0.3) return Math.sin((u / 0.3) * (Math.PI / 2)) ** 2
  if (u > 0.75) return Math.cos(((u - 0.75) / 0.25) * (Math.PI / 2)) ** 2
  return 1
}

type EventName = 'tilt' | 'shift' | 'flick' | 'swish' | 'glance' | 'slowBlink' | 'listenL' | 'listenR'
const MAJOR: ReadonlySet<EventName> = new Set(['tilt', 'shift', 'flick', 'swish', 'listenL', 'listenR'])

interface Track {
  nextAt: number
  startedAt: number | null
  duration: number
  amount: number
  amount2: number
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
  private readonly p: [number, number, number, number]
  private theta1 = 0
  private theta2 = 0
  private lastMajorStart = -10
  private pettedAt: number | null = null
  private readonly tracks: Record<EventName, Track>

  constructor(options: PersonalityOptions = {}) {
    this.rng = createRng((options.seed ?? 1) ^ 0x9e3779b9)
    this.scale = options.motionScale ?? 1
    const r = (): number => this.rng() * Math.PI * 2
    this.p = [r(), r(), r(), r()]
    this.theta1 = this.p[0]
    this.theta2 = this.p[1] * 2.1
    const t = (first: number, spread: number): Track => ({
      nextAt: first + this.rng() * spread,
      startedAt: null,
      duration: 1,
      amount: 0,
      amount2: 0
    })
    this.tracks = {
      tilt: t(6, 6),
      shift: t(8, 8),
      flick: t(5, 6),
      swish: t(12, 10),
      glance: t(3, 5),
      slowBlink: t(7, 8),
      listenL: t(2, 3),
      listenR: t(3, 3)
    }
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
    const t = this.time
    const style = STYLES[this.state]

    const delight = this.delightLevel()
    this.pupil = approach(this.pupil, style.pupil + delight * 0.35, dt, TAU)
    this.smile = approach(this.smile, Math.max(style.smile, delight), dt, TAU)
    this.zzz = approach(this.zzz, delight > 0.2 ? 0 : style.zzz, dt, 0.8)
    this.tailAmp = approach(this.tailAmp, style.tailAmp * (1 + delight * 0.8), dt, 0.8)
    this.earPerk = approach(this.earPerk, style.earPerk + delight * 0.45, dt, 0.35)

    // Tail: two drifting-frequency sways with slowly breathing amplitude (never an exact loop).
    const w = (2 * Math.PI) / style.tailPeriod
    this.theta1 += w * (1 + 0.18 * Math.sin(t / 9.1 + this.p[2])) * dt
    this.theta2 += w * 1.7 * (1 + 0.12 * Math.sin(t / 7.3 + this.p[3])) * dt
    const amp = this.tailAmp * (0.75 + 0.25 * Math.sin(t / 13.7 + this.p[3]))
    const sway = amp * (Math.sin(this.theta1) + 0.45 * Math.sin(this.theta2))

    // Events (major ones share a budget so the cat never does too much at once).
    const flick = this.run('flick', style.flick, [0.4, 0.75], () => (this.rng() < 0.5 ? -1 : 1) * (8 + this.rng() * 9))
    const swish = this.run('swish', style.swish, [1.0, 1.7], () => (this.rng() < 0.5 ? -1 : 1) * (13 + this.rng() * 11))
    const tilt = this.run('tilt', style.tilt, [1.6, 3.2], () => (this.rng() < 0.5 ? -1 : 1) * style.tiltDeg * (0.6 + this.rng() * 0.6))
    const shift = this.run('shift', style.shift, [1.4, 2.6], () => (this.rng() < 0.5 ? -1 : 1) * (1.5 + this.rng() * 2.2))
    const listenL = style.listen ? this.run('listenL', [1.6, 4], [0.9, 1.4], () => 0.35 + this.rng() * 0.4) : null
    const listenR = style.listen ? this.run('listenR', [1.6, 4], [0.9, 1.4], () => 0.35 + this.rng() * 0.4) : null
    const glance = this.run('glance', style.glance, [0.6, 1.5], () => (this.rng() < 0.5 ? -1 : 1) * style.glanceSize * (0.5 + this.rng() * 0.5), () => (this.rng() - 0.55) * style.glanceSize)
    const slow = this.run('slowBlink', style.slowBlink, [0.55, 0.85], () => 0.85 + this.rng() * 0.1)

    const tailDeg = (sway + flick.value * bell(flick.u) + swish.value * bell(swish.u)) * this.scale
    const restLean = this.state === 'idle' ? 2.5 : this.state === 'stale' ? -2 : 0
    const headTilt = (tilt.value * hold(tilt.u) + restLean) * this.scale
    const headShiftX = shift.value * hold(shift.u) * this.scale

    // Eyes follow the head shift a little, plus independent glances; return to centre when petted.
    const centre = 1 - delight
    const gazeX = (glance.value * hold(glance.u) + Math.sign(shift.value) * 0.45 * hold(shift.u)) * centre * this.scale
    const gazeY = glance.value2 * hold(glance.u) * centre * this.scale

    return {
      tail: tailDeg,
      headTilt,
      headShiftX,
      gazeX: Math.max(-1, Math.min(1, gazeX)),
      gazeY: Math.max(-1, Math.min(1, gazeY)),
      lid: slow.value * bell(slow.u),
      pupil: this.pupil,
      smile: this.smile,
      zzz: this.zzz,
      whisker: (1.6 * Math.sin((2 * Math.PI * t) / 5.2 + this.p[0]) + delight * 2.2 * Math.sin(t * 16)) * this.scale,
      earBoostLeft: (this.earPerk + (listenL ? listenL.value * bell(listenL.u) : 0)) * this.scale,
      earBoostRight: (this.earPerk + (listenR ? listenR.value * bell(listenR.u) : 0)) * this.scale,
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

  private majorActive(): number {
    let n = 0
    for (const name of MAJOR) if (this.tracks[name].startedAt !== null) n++
    return n
  }

  /** Gap to the next event: skewed toward the short end, with the occasional long pause. */
  private nextGap(range: Range): number {
    const [lo, hi] = range
    const g = lo + Math.pow(this.rng(), 1.5) * (hi - lo)
    return this.rng() < 0.12 ? g * 1.8 : g
  }

  /**
   * Runs one randomly scheduled event. Returns its signed amount and progress u (0..1)
   * while active. Major events postpone themselves if the activity budget is full.
   */
  private run(
    name: EventName,
    gap: Range | null,
    dur: Range,
    makeAmount: () => number,
    makeAmount2: () => number = () => 0
  ): { value: number; value2: number; u: number } {
    const ev = this.tracks[name]
    if (ev.startedAt === null && this.time >= ev.nextAt) {
      if (!gap) {
        ev.nextAt = this.time + 5 // disabled in this state; look again later (cheap)
      } else if (this.blocked(name)) {
        ev.nextAt = this.time + 0.4 + this.rng() * 0.9
      } else {
        ev.startedAt = ev.nextAt
        ev.amount = makeAmount()
        ev.amount2 = makeAmount2()
        ev.duration = dur[0] + this.rng() * (dur[1] - dur[0])
        if (MAJOR.has(name)) this.lastMajorStart = this.time
      }
    }
    if (ev.startedAt !== null && this.time - ev.startedAt >= ev.duration) {
      const end = ev.startedAt + ev.duration
      ev.startedAt = null
      ev.nextAt = end + (gap ? this.nextGap(gap) : 5)
    }
    if (ev.startedAt === null) return { value: 0, value2: 0, u: 0 }
    return { value: ev.amount, value2: ev.amount2, u: (this.time - ev.startedAt) / ev.duration }
  }

  private blocked(name: EventName): boolean {
    if (!MAJOR.has(name)) return false
    if (this.majorActive() >= MAX_MAJOR_ACTIVE) return true
    if (this.time - this.lastMajorStart < MAJOR_COOLDOWN_S) return true
    // The tail does one thing at a time.
    if (name === 'flick' && this.tracks.swish.startedAt !== null) return true
    if (name === 'swish' && this.tracks.flick.startedAt !== null) return true
    return false
  }

  /** Test hook: number of major movements currently playing. */
  get activeMajorCount(): number {
    return this.majorActive()
  }
}
