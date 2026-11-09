import { useCallback, useEffect, useRef, useState } from 'react'
import {
  begin,
  cancel,
  initialExperience,
  isLiveBreathing,
  isUnsteadyBreathing,
  progressOf,
  remainingMs,
  reset,
  tick,
  type ExperienceState,
  type Stage
} from '@shared/experience/machine'
import type { SessionState } from '@shared/signal'

const TICK_MS = 250

export interface ExperienceView {
  stage: Stage
  /** 0…1 of valid measurement time. */
  progress: number
  remainingMs: number
  /** Why the experience last returned to the welcome stage. */
  endReason: ExperienceState['endReason']
  begin: () => void
  cancel: () => void
  reset: () => void
}

/**
 * Runs the "Breathe Together" state machine against the (real or simulated)
 * session. `timeScale` only has an effect while `simulated` is true.
 */
export function useExperience(
  session: Pick<SessionState, 'phase' | 'signal'>,
  simulated: boolean,
  timeScale: number
): ExperienceView {
  const [exp, setExp] = useState<ExperienceState>(initialExperience)
  const ref = useRef({ session, simulated, timeScale })
  useEffect(() => {
    ref.current = { session, simulated, timeScale }
  })

  useEffect(() => {
    const id = window.setInterval(() => {
      const { session: sess, simulated: sim, timeScale: scale } = ref.current
      const now = Date.now()
      setExp((s) =>
        tick(s, {
          nowMs: now,
          phase: sess.phase,
          valid: isLiveBreathing(sess, now),
          unsteady: isUnsteadyBreathing(sess, now),
          timeScale: sim ? scale : 1,
          adopt: !sim
        })
      )
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  return {
    stage: exp.stage,
    progress: progressOf(exp),
    remainingMs: remainingMs(exp),
    endReason: exp.endReason,
    begin: useCallback(() => setExp((s) => begin(s, Date.now())), []),
    cancel: useCallback(() => setExp((s) => cancel(s)), []),
    reset: useCallback(() => setExp((s) => reset(s)), [])
  }
}
