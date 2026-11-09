import { freshnessOf, type SessionState } from '../signal'

export type CatState = 'idle' | 'searching' | 'settling' | 'connected' | 'stale' | 'error'

export const CAT_STATES: readonly CatState[] = [
  'idle',
  'searching',
  'settling',
  'connected',
  'stale',
  'error'
]

/**
 * Derive the cat's presentation state from real session state only.
 *
 * - idle:      no session (or stopping)
 * - searching: session starting, or running with no reading yet
 * - settling:  fresh readings exist but none is flagged `stable` by the SDK
 * - connected: at least one fresh reading is flagged `stable` by the SDK
 * - stale:     readings exist but none has updated recently
 * - error:     the session failed
 */
export function deriveCatState(
  session: Pick<SessionState, 'phase' | 'signal'>,
  nowMs: number
): CatState {
  switch (session.phase) {
    case 'error':
      return 'error'
    case 'idle':
    case 'stopping':
      return 'idle'
    case 'starting':
      return 'searching'
    case 'running':
      break
  }
  const readings = [session.signal.breathing, session.signal.pulse].filter(
    (r): r is NonNullable<typeof r> => r !== null
  )
  if (readings.length === 0) return 'searching'
  const fresh = readings.filter((r) => freshnessOf(r, nowMs) === 'fresh')
  if (fresh.length === 0) return 'stale'
  return fresh.some((r) => r.stable) ? 'connected' : 'settling'
}

export const CAT_STATE_LABEL: Readonly<Record<CatState, string>> = {
  idle: 'Resting',
  searching: 'Looking for you…',
  settling: 'Settling in',
  connected: 'Connected',
  stale: 'Signal paused',
  error: 'Something went wrong'
}
