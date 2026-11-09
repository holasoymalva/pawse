import { useEffect, useRef, useState } from 'react'
import type { SessionState } from '@shared/signal'
import { buildSimState, SCENARIOS, TIME_SCALES, updatesOverTime, type ScenarioId } from './simulation'

export interface SimulationOutput {
  state: SessionState
  /** Multiplies credited experience time (previews only). */
  timeScale: number
}

interface Props {
  onSimulation: (sim: SimulationOutput | null) => void
}

/** Irregular delay (ms) between simulated updates, like real SDK packets. */
const nextDelay = (): number => 1000 + Math.random() * 2500

/**
 * DEVELOPMENT-ONLY panel (not included in production builds). Lives in the normal
 * page flow, collapsed by default, so it can never cover the title or the cat.
 * Drives the cat with clearly labelled simulated states so visuals can be tested
 * without the camera, the SDK or any API credits.
 */
export default function DevTools({ onSimulation }: Props) {
  const [scenario, setScenario] = useState<ScenarioId | null>(null)
  const [timeScale, setTimeScale] = useState(1)
  const emit = useRef(onSimulation)
  const scale = useRef(timeScale)
  useEffect(() => {
    emit.current = onSimulation
    scale.current = timeScale
  })

  const startMs = useRef(0)
  const stateFor = (id: ScenarioId): SimulationOutput => ({
    state: buildSimState(id, { nowMs: Date.now(), startMs: startMs.current }),
    timeScale: scale.current
  })

  // Live scenarios keep producing updates at irregular intervals, like real SDK packets.
  useEffect(() => {
    if (!scenario || !updatesOverTime(scenario)) return
    let timer = window.setTimeout(function tick() {
      emit.current(stateFor(scenario))
      timer = window.setTimeout(tick, nextDelay())
    }, nextDelay())
    return () => window.clearTimeout(timer)
  }, [scenario])

  // Choosing a scenario emits its first state immediately (synchronously), so the UI is never
  // briefly "real" after selecting a simulation. Switching keeps the experience going; only
  // turning the simulation off clears it.
  const choose = (next: ScenarioId | null): void => {
    setScenario(next)
    if (next === null) {
      emit.current(null)
      return
    }
    startMs.current = Date.now()
    emit.current(stateFor(next))
  }

  return (
    <details className="devtools" aria-label="Development simulation">
      <summary>DEV ONLY · simulation{scenario ? ' · ON' : ''}</summary>
      <div className="devtools-body">
        <label>
          Scenario
          <select
            aria-label="Simulation scenario"
            value={scenario ?? ''}
            onChange={(e) => choose((e.target.value || null) as ScenarioId | null)}
          >
            <option value="">Off (use real session)</option>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label>
          Experience speed
          <select
            aria-label="Simulation speed"
            value={timeScale}
            onChange={(e) => setTimeScale(Number(e.target.value))}
          >
            {TIME_SCALES.map((n) => (
              <option key={n} value={n}>{n === 1 ? 'Real time (60 s)' : `×${n} faster`}</option>
            ))}
          </select>
        </label>
        <span className="muted small">Simulated data only. Never sent to the SDK; uses no credits.</span>
      </div>
    </details>
  )
}
