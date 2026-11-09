import type { AnimationFrame } from './engine'
import type { PersonalityFrame } from './personality'

/** Visual constants (kept subtle on purpose). */
const BREATH_SCALE_Y = 0.05
const BREATH_SCALE_X = 0.022
const BELLY_SCALE = 0.1
const HEAD_LIFT_PX = 3
const HEART_SCALE = 0.06
const EAR_MAX_DEG = 14

const NEUTRAL: PersonalityFrame = {
  tail: 0,
  headTilt: 0,
  pupil: 1,
  smile: 0,
  zzz: 0,
  whisker: 0,
  earBoostLeft: 0,
  earBoostRight: 0,
  delight: 0
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v))

/**
 * Converts the physiological frame (breath, heartbeat, blink, ears) plus the
 * ambient personality frame into CSS custom properties consumed by the cat SVG.
 */
export function frameToCssVars(
  frame: AnimationFrame,
  personality: PersonalityFrame = NEUTRAL
): Record<string, string> {
  const earL = clamp1(frame.earLeft + personality.earBoostLeft)
  const earR = clamp1(frame.earRight + personality.earBoostRight)
  return {
    '--cat-scale-y': (1 + frame.breath * BREATH_SCALE_Y).toFixed(4),
    '--cat-scale-x': (1 + frame.breath * BREATH_SCALE_X).toFixed(4),
    '--cat-belly': (1 + frame.breath * BELLY_SCALE).toFixed(4),
    '--cat-head-y': `${(-frame.breath * HEAD_LIFT_PX).toFixed(2)}px`,
    '--cat-halo': frame.breath.toFixed(3),
    '--cat-heart': (1 + frame.heartbeat * HEART_SCALE).toFixed(4),
    '--cat-glow': frame.heartbeat.toFixed(3),
    '--cat-blink': frame.blink.toFixed(3),
    '--cat-ear-l': `${(earL * EAR_MAX_DEG).toFixed(2)}deg`,
    '--cat-ear-r': `${(-earR * EAR_MAX_DEG).toFixed(2)}deg`,
    '--cat-tail': `${personality.tail.toFixed(2)}deg`,
    '--cat-tilt': `${personality.headTilt.toFixed(2)}deg`,
    '--cat-pupil': personality.pupil.toFixed(3),
    '--cat-smile': personality.smile.toFixed(3),
    '--cat-zzz': personality.zzz.toFixed(3),
    '--cat-whisker': `${personality.whisker.toFixed(2)}deg`
  }
}
