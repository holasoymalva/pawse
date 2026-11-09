import type { CatState } from '@shared/animation/catState'

/** Short spoken description for the cat's accessible name. */
export const DESCRIPTION: Readonly<Record<CatState, string>> = {
  idle: 'The cat is resting.',
  searching: 'The cat looks curious and is looking for you.',
  settling: 'The cat is waiting patiently while the measurement settles.',
  connected: 'The cat is relaxed and breathing at the rate measured from you.',
  stale: 'The cat is waiting; the measurement paused.',
  error: 'The cat is quiet; something went wrong.'
}

export const BREATH_LABEL = {
  live: 'live reading',
  held: 'last reading (paused)',
  decorative: 'decorative, not a measurement'
} as const

export const HEART_LABEL = { live: 'live reading', none: 'off' } as const

/** In dev simulation, any "live" label becomes explicitly simulated. */
export const SIMULATED_LABEL = 'simulated, not real'

/** Welcome and completion copy for the "Breathe Together" experience. */
export const COPY = {
  meetTitle: 'Meet PAWSE.',
  meetLede: 'A tiny companion that comes alive with your breathing.',
  wake: 'Wake up PAWSE',
  connectingTitle: 'PAWSE is waking up…',
  breathingTitle: 'Breathe together',
  breathingLede: "PAWSE is breathing at your measured rate. Just breathe naturally.",
  peaceTitle: 'You gave PAWSE a little moment of peace. 💚',
  peaceLede: 'That was 60 seconds of live breathing measurement.',
  another: 'Start another session'
} as const

/** m:ss for a remaining/elapsed duration in ms. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
