import type { CatState } from '@shared/animation/catState'

/** Headline under the cat: what is happening, in plain language. No emotion is inferred from the user. */
export const HEADLINE: Readonly<Record<CatState, string>> = {
  idle: 'Your breathing brings a little companion to life.',
  searching: 'Sit comfortably and face the camera. PAWSE is looking for you.',
  settling: 'Almost there. Keep breathing naturally.',
  connected: 'Your breathing is bringing PAWSE to life.',
  stale: 'The signal paused for a moment. Hold still and PAWSE will find you.',
  error: 'PAWSE needs a hand. See the message below.'
}

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
