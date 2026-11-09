import type { AnimationFrame } from './engine'
import type { PersonalityFrame } from './personality'

/** Visual constants (kept subtle on purpose). */
const BREATH_SCALE_Y = 0.05
const BREATH_SCALE_X = 0.022
const BELLY_SCALE = 0.1
const HEAD_LIFT_PX = 3
const HEART_SCALE = 0.06
const EAR_MAX_DEG = 14
const GAZE_X_PX = 3.4
const GAZE_Y_PX = 2.4

/** "Settled" resting pose used at the end of the experience (0 = normal … 1 = fully settled). */
const SETTLE = { headDropPx: 16, headTiltDeg: -7, earDown: 0.9, tailDeg: -24, squashY: 0.065, spreadX: 0.03 }

export const NEUTRAL_PERSONALITY: PersonalityFrame = {
  tail: 0,
  headTilt: 0,
  headShiftX: 0,
  gazeX: 0,
  gazeY: 0,
  lid: 0,
  pupil: 1,
  smile: 0,
  zzz: 0,
  whisker: 0,
  earBoostLeft: 0,
  earBoostRight: 0,
  delight: 0
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v))
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/**
 * Converts the physiological frame (breath, heartbeat, blink, ears) plus the
 * ambient personality frame into CSS custom properties consumed by the cat SVG.
 *
 * `settle` (0…1) blends in the peaceful resting pose: eyes closed, head lowered and
 * nuzzled, ears down, tail drawn in, body relaxed, a gentle smile.
 */
export function frameToCssVars(
  frame: AnimationFrame,
  personality: PersonalityFrame = NEUTRAL_PERSONALITY,
  settle = 0
): Record<string, string> {
  const s = clamp01(settle)
  const earL = clamp1(frame.earLeft + personality.earBoostLeft - s * SETTLE.earDown)
  const earR = clamp1(frame.earRight + personality.earBoostRight - s * SETTLE.earDown)
  const blink = Math.max(frame.blink, personality.lid, s)
  return {
    '--cat-scale-y': ((1 + frame.breath * BREATH_SCALE_Y) * (1 - s * SETTLE.squashY)).toFixed(4),
    '--cat-scale-x': ((1 + frame.breath * BREATH_SCALE_X) * (1 + s * SETTLE.spreadX)).toFixed(4),
    '--cat-belly': (1 + frame.breath * BELLY_SCALE).toFixed(4),
    '--cat-head-y': `${(-frame.breath * HEAD_LIFT_PX + s * SETTLE.headDropPx).toFixed(2)}px`,
    '--cat-head-x': `${personality.headShiftX.toFixed(2)}px`,
    '--cat-halo': frame.breath.toFixed(3),
    '--cat-heart': (1 + frame.heartbeat * HEART_SCALE).toFixed(4),
    '--cat-glow': frame.heartbeat.toFixed(3),
    '--cat-blink': blink.toFixed(3),
    '--cat-ear-l': `${(earL * EAR_MAX_DEG).toFixed(2)}deg`,
    '--cat-ear-r': `${(-earR * EAR_MAX_DEG).toFixed(2)}deg`,
    '--cat-tail': `${(personality.tail + s * SETTLE.tailDeg).toFixed(2)}deg`,
    '--cat-tilt': `${(personality.headTilt + s * SETTLE.headTiltDeg).toFixed(2)}deg`,
    '--cat-gaze-x': `${(personality.gazeX * GAZE_X_PX).toFixed(2)}px`,
    '--cat-gaze-y': `${(personality.gazeY * GAZE_Y_PX).toFixed(2)}px`,
    '--cat-pupil': personality.pupil.toFixed(3),
    '--cat-smile': Math.max(personality.smile, s * 0.9).toFixed(3),
    '--cat-zzz': Math.max(personality.zzz, s * 0.85).toFixed(3),
    '--cat-whisker': `${personality.whisker.toFixed(2)}deg`
  }
}
