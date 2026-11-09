import type { AnimationFrame } from './engine'

/** Visual constants for the placeholder cat (kept subtle on purpose). */
const BREATH_SCALE_Y = 0.045
const BREATH_SCALE_X = 0.02
const HEART_SCALE = 0.05
const EAR_MAX_DEG = 14

/** Converts an animation frame to CSS custom properties consumed by the cat SVG. */
export function frameToCssVars(frame: AnimationFrame): Record<string, string> {
  return {
    '--cat-scale-y': (1 + frame.breath * BREATH_SCALE_Y).toFixed(4),
    '--cat-scale-x': (1 + frame.breath * BREATH_SCALE_X).toFixed(4),
    '--cat-heart': (1 + frame.heartbeat * HEART_SCALE).toFixed(4),
    '--cat-eye-y': (1 - frame.blink * 0.92).toFixed(3),
    '--cat-ear-l': `${(frame.earLeft * EAR_MAX_DEG).toFixed(2)}deg`,
    '--cat-ear-r': `${(-frame.earRight * EAR_MAX_DEG).toFixed(2)}deg`
  }
}
