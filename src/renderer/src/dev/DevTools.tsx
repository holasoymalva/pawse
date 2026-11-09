import { useEffect, useRef, useState } from 'react'
import type { SessionState } from '@shared/signal'
import { buildSimState, SCENARIOS, updatesOverTime, type ScenarioId } from './simulation'

interface Props {
  onSimulation: (state: SessionState | null) => void
}

/** Irregular delay (ms) between simulated updates, like real SDK packets. */
const nextDelay = (): number => 1000 + Math.random() * 2500

/**
 * DEVELOPMENT-ONLY panel (not included in production builds). Drives the cat with
 * clearly labelled simulated states so visuals can be tested without the camera,
 * the SDK or any API credits.
 */
export default function DevTools({ onSimulation }: Props) {
  const [scenario, setScenario] = useState<ScenarioId | null>(null)
  const emit = useRef(onSimulation)
  useEffect(() => {
    emit.current = onSimulation
  })

  useEffect(() => {
    if (!scenario) return
    const startMs = Date.now()
    const push = (): void => emit.current(buildSimState(scenario, { nowMs: Date.now(), startMs }))
    let timer = window.setTimeout(function tick() {
      push()
      if (updatesOverTime(scenario)) timer = window.setTimeout(tick, nextDelay())
    }, 0)
    return () => {
      window.clearTimeout(timer)
      emit.current(null)
    }
  }, [scenario])

  return (
    <details className="devtools" aria-label="Development simulation" open={scenario !== null}>
      <summary>DEV ONLY · simulation</summary>
      <select
        aria-label="Simulation scenario"
        value={scenario ?? ''}
        onChange={(e) => setScenario((e.target.value || null) as ScenarioId | null)}
      >
        <option value="">Off (use real session)</option>
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <span className="muted small">Simulated data only. Never sent to the SDK; uses no credits.</span>
    </details>
  )
}
