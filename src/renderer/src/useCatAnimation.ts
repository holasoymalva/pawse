import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnimationEngine, describeMotion, type BreathSource, type HeartSource } from '@shared/animation/engine'
import { AnimationLoop } from '@shared/animation/loop'
import { frameToCssVars } from '@shared/animation/cssVars'
import { PersonalityEngine } from '@shared/animation/personality'
import { deriveCatState, type CatState } from '@shared/animation/catState'
import { CatStateTracker, type StateTransition } from '@shared/animation/catStateTracker'
import type { SessionState } from '@shared/signal'

export interface CatView {
  /** Hysteresis-filtered state (what the cat and the label show). */
  catState: CatState
  /** What the motion is based on: real readings vs decorative animation. */
  motion: { breath: BreathSource; heart: HeartSource }
  history: StateTransition[]
  /** Visual-only reaction when the user pets the cat. */
  pet: () => void
}

const STATE_POLL_MS = 250

/**
 * Runs the deterministic engines on requestAnimationFrame and writes the result
 * straight to CSS variables on `target` (no React re-render per frame):
 * - AnimationEngine: breathing, heartbeat, blink, ears (from real readings/state)
 * - PersonalityEngine: tail, head tilt, expressions (from session state only)
 */
export function useCatAnimation(
  target: RefObject<SVGSVGElement | null>,
  session: Pick<SessionState, 'phase' | 'signal'>
): CatView {
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  })

  const [view, setView] = useState<{ state: CatState; history: StateTransition[] }>({
    state: 'idle',
    history: []
  })
  const engineRef = useRef<AnimationEngine | null>(null)
  const personalityRef = useRef<PersonalityEngine | null>(null)
  const breathing = session.signal.breathing?.value ?? null
  const pulse = session.signal.pulse?.value ?? null

  // Evaluate the raw state against the clock and smooth it with hysteresis.
  useEffect(() => {
    const tracker = new CatStateTracker()
    const tick = (): void => {
      const now = Date.now()
      const before = tracker.state
      const next = tracker.update(deriveCatState(sessionRef.current, now), now)
      if (next !== before) setView({ state: next, history: [...tracker.history] })
    }
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, STATE_POLL_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [])

  // Animation loop: created once, disposed on unmount.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const seed = Math.floor(Math.random() * 0xffffffff)
    const motionScale = reduced ? 0.4 : 1
    const engine = new AnimationEngine({ seed, motionScale })
    const personality = new PersonalityEngine({ seed: seed ^ 0x5bd1e995, motionScale })
    engineRef.current = engine
    personalityRef.current = personality
    const loop = new AnimationLoop(
      engine,
      (frame, dt) => {
        const el = target.current
        if (!el) return
        const vars = frameToCssVars(frame, personality.step(dt))
        for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value)
      },
      {
        request: (cb) => window.requestAnimationFrame(cb),
        cancel: (h) => window.cancelAnimationFrame(h)
      }
    )
    loop.start()
    return () => {
      loop.dispose()
      engineRef.current = null
      personalityRef.current = null
    }
  }, [target])

  useEffect(() => {
    engineRef.current?.setInput({ state: view.state, breathingBpm: breathing, pulseBpm: pulse })
    personalityRef.current?.setState(view.state)
  }, [view.state, breathing, pulse])

  const motion = useMemo(
    () => describeMotion({ state: view.state, breathingBpm: breathing, pulseBpm: pulse }),
    [view.state, breathing, pulse]
  )
  const pet = useCallback(() => personalityRef.current?.pet(), [])
  return { catState: view.state, motion, history: view.history, pet }
}
