import { useEffect, useRef, type RefObject } from 'react'
import { AnimationEngine } from '@shared/animation/engine'
import { AnimationLoop } from '@shared/animation/loop'
import { frameToCssVars } from '@shared/animation/cssVars'
import { deriveCatState, type CatState } from '@shared/animation/catState'
import type { SessionState } from '@shared/signal'

/**
 * Runs the deterministic animation engine on requestAnimationFrame and writes the
 * result straight to CSS variables on `target` (no React re-render per frame).
 * Returns the derived cat state for labelling.
 */
export function useCatAnimation(
  target: RefObject<SVGSVGElement | null>,
  session: Pick<SessionState, 'phase' | 'signal'>,
  nowMs: number
): CatState {
  const catState = deriveCatState(session, nowMs)
  const engineRef = useRef<AnimationEngine | null>(null)
  const breathing = session.signal.breathing?.value ?? null
  const pulse = session.signal.pulse?.value ?? null

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const engine = new AnimationEngine({
      seed: Math.floor(Math.random() * 0xffffffff),
      motionScale: reduced ? 0.4 : 1
    })
    engineRef.current = engine
    const loop = new AnimationLoop(
      engine,
      (frame) => {
        const el = target.current
        if (!el) return
        for (const [name, value] of Object.entries(frameToCssVars(frame))) {
          el.style.setProperty(name, value)
        }
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
    }
  }, [target])

  useEffect(() => {
    engineRef.current?.setInput({ state: catState, breathingBpm: breathing, pulseBpm: pulse })
  }, [catState, breathing, pulse])

  return catState
}
