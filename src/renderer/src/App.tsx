import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CAT_STATE_LABEL } from '@shared/animation/catState'
import { connectionMessage, friendlyError, pauseMessage } from '@shared/experience/copy'
import type { Availability, SessionState } from '@shared/signal'
import { CatScene } from './components/CatScene'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { Readout } from './components/Readout'
import { BREATH_LABEL, COPY, DESCRIPTION, formatClock, HEART_LABEL, SIMULATED_LABEL } from './catCopy'
import type { SimulationOutput } from './dev/DevTools'
import { useCatAnimation } from './useCatAnimation'
import { useExperience } from './useExperience'
import { useSession } from './useSession'

// Development-only visual simulation. `import.meta.env.DEV` is replaced by `false` in
// production builds, so this module is not part of the shipped bundle.
const DevTools = import.meta.env.DEV ? lazy(() => import('./dev/DevTools')) : null

function availabilityMessage(a: Availability): { title: string; body: string } | null {
  switch (a.kind) {
    case 'ready':
      return null
    case 'missing-key':
      return {
        title: 'API key missing',
        body: 'Copy .env.example to .env, add your SmartSpectra API key as SMARTSPECTRA_API_KEY, then restart PAWSE.'
      }
    case 'unsupported-platform':
      return {
        title: 'This platform is not supported',
        body: `The SmartSpectra native runtime could not be loaded. Supported: macOS Apple Silicon, Windows x64, Linux x64/arm64. (${a.detail})`
      }
    case 'sdk-load-failed':
      return { title: 'SmartSpectra failed to load', body: a.detail }
  }
}

const IDLE_SIGNAL = { pulse: null, breathing: null } as const
const isActivePhase = (p: SessionState['phase']): boolean => p === 'starting' || p === 'running' || p === 'stopping'

export function App() {
  const { state: realState, nowMs, busy, start, stop } = useSession()
  const [sim, setSim] = useState<SimulationOutput | null>(null)
  const simulated = sim !== null
  const state = sim?.state ?? realState

  const [consent, setConsent] = useState(false)
  const catRef = useRef<SVGSVGElement>(null)
  const session = state ?? { phase: 'idle' as const, signal: IDLE_SIGNAL }
  const experience = useExperience(session, simulated, sim?.timeScale ?? 1)
  const { stage } = experience
  const { catState, motion, history, pet } = useCatAnimation(catRef, session, stage)
  const [diagOpen, setDiagOpen] = useState(false)

  // Turning the simulation on or off resets the experience. A real session still
  // running is stopped first, so the camera never stays on behind a simulation.
  const wasSimulated = useRef(false)
  const realPhase = realState?.phase
  const onSimulation = useCallback(
    (next: SimulationOutput | null) => {
      setSim(next)
      if ((next !== null) !== wasSimulated.current) {
        wasSimulated.current = next !== null
        experience.reset()
        if (next !== null && realPhase && isActivePhase(realPhase)) void stop()
      }
    },
    [experience, realPhase, stop]
  )

  // The camera is released as soon as the 60 seconds are complete (saves credits too).
  const prevStage = useRef(stage)
  useEffect(() => {
    if (stage === 'peace' && prevStage.current !== 'peace' && !simulated) void stop()
    prevStage.current = stage
  }, [stage, simulated, stop])

  // Development diagnostics: Cmd/Ctrl+Shift+D. Main returns null in packaged builds.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== 'd') return
      e.preventDefault()
      void window.pawse.getDiagnostics().then((d) => {
        if (d) setDiagOpen((open) => !open)
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!state) return <main className="app"><p className="muted">Loading…</p></main>

  const blocked = availabilityMessage(state.availability)
  const starting = state.phase === 'starting'
  const running = state.phase === 'running'
  const stopping = state.phase === 'stopping'
  const live = stage === 'connecting' || stage === 'breathing' || stage === 'paused'
  const showVitals = stage === 'breathing' || stage === 'paused'
  const pause = pauseMessage(state, nowMs)
  const breathing = state.signal.breathing
  // A live breathing reading the SDK has not flagged stable yet is labelled as such.
  const unsteadyLive = motion.breath === 'live' && breathing !== null && !breathing.stable
  const breathLabel =
    simulated && motion.breath === 'live'
      ? SIMULATED_LABEL
      : unsteadyLive
        ? 'live reading, still settling'
        : BREATH_LABEL[motion.breath]
  const heartLabel = simulated && motion.heart === 'live' ? SIMULATED_LABEL : HEART_LABEL[motion.heart]
  const error = state.error ? friendlyError(state.error) : null
  const secondsLeft = Math.ceil(experience.remainingMs / 1000)

  const wake = async (): Promise<void> => {
    experience.begin()
    if (!simulated) await start()
  }
  const stopSession = async (): Promise<void> => {
    experience.cancel()
    if (!simulated) await stop()
  }

  return (
    <main className="app" data-stage={stage} data-state={catState}>
      <header className="brand">
        <h1>PAWSE</h1>
        <p className="tagline">A little companion that breathes with you</p>
      </header>

      {simulated && (
        <div className="sim-banner" role="alert">
          <strong>SIMULATION</strong> Development-only preview. These numbers are not measured from you.
        </div>
      )}

      <section className="stage" aria-label="PAWSE the cat">
        <button
          type="button"
          className="cat-btn"
          onClick={pet}
          aria-label={`Pet PAWSE. ${DESCRIPTION[catState]}`}
          title="Pet PAWSE"
        >
          <CatScene
            state={catState}
            svgRef={catRef}
            description={DESCRIPTION[catState]}
            stage={stage}
            progress={experience.progress}
          />
        </button>

        <div className="stage-copy" key={stage}>
          {stage === 'meet' && (
            <>
              <h2 className="hero">{COPY.meetTitle}</h2>
              <p className="lede">{COPY.meetLede}</p>
            </>
          )}

          {stage === 'connecting' && (
            <>
              <h2 className="hero">{COPY.connectingTitle}</h2>
              <p className="lede" role="status">{connectionMessage(state, catState)}</p>
            </>
          )}

          {stage === 'breathing' && (
            <>
              <h2 className="hero">{COPY.breathingTitle}</h2>
              <p className="lede">{COPY.breathingLede}</p>
              <p
                className="timer"
                role="progressbar"
                aria-label="Breathe Together progress"
                aria-valuemin={0}
                aria-valuemax={60}
                aria-valuenow={60 - secondsLeft}
              >
                {formatClock(experience.remainingMs)} left
              </p>
            </>
          )}

          {stage === 'paused' && (
            <>
              <h2 className="hero">{pause.title}</h2>
              <p className="lede">{pause.lede}</p>
              <p className="timer dim" aria-label="Timer paused">{formatClock(experience.remainingMs)} left · paused</p>
            </>
          )}

          {stage === 'peace' && (
            <>
              <h2 className="hero peace">{COPY.peaceTitle}</h2>
              <p className="lede">{COPY.peaceLede}</p>
            </>
          )}

          {live && (
            <span className={`state-pill state-pill-${stage === 'paused' ? 'stale' : catState}`} role="status">
              {stage === 'paused' ? pause.pill : CAT_STATE_LABEL[catState]}
            </span>
          )}

          {showVitals && (
            <>
              <div className="vitals">
                <Readout label="Breathing" unit="br/min" reading={state.signal.breathing} nowMs={nowMs} running={running} simulated={simulated} />
                <Readout label="Pulse" unit="bpm" reading={state.signal.pulse} nowMs={nowMs} running={running} simulated={simulated} />
              </div>
              <div className="chips" aria-label="What the motion is based on">
                <span className={`chip chip-${motion.breath}`} data-testid="chip-breath">Breathing · {breathLabel}</span>
                <span className={`chip chip-${motion.heart}`} data-testid="chip-heart">Heartbeat · {heartLabel}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {live && !simulated && (
        <div className="status" role="status">
          <span className={`dot ${running ? 'on' : ''}`} />
          {starting && state.recoveryAttempt > 0 && `Reconnecting to SmartSpectra… (attempt ${state.recoveryAttempt})`}
          {starting && state.recoveryAttempt === 0 && 'Starting camera and SmartSpectra…'}
          {running && 'Camera is on · measuring'}
          {stopping && 'Stopping and releasing the camera…'}
        </div>
      )}

      {stage === 'breathing' && !simulated && (
        <p className="muted small center">
          The cat follows your measured breathing and pulse <em>rate</em>. It is not synchronised to
          each individual breath or heartbeat.
        </p>
      )}

      {live && !simulated && state.validation && !state.validation.ok && (
        <p className="hint" role="status">{state.validation.hint}</p>
      )}

      {live && !simulated && state.notice && (
        <div className="notice" role="status">
          <strong>SDK notice · {state.notice.name}</strong>
          <p>{state.notice.message} The session is still running.</p>
        </div>
      )}

      {error && (
        <div className="notice error" role="alert">
          <strong>{error.title}</strong>
          <p>{error.body}{state.error?.retryable ? ' You can try again.' : ''}</p>
        </div>
      )}

      {blocked && (
        <div className="notice error" role="alert">
          <strong>{blocked.title}</strong>
          <p>{blocked.body}</p>
        </div>
      )}

      {stage === 'meet' && !blocked && !simulated && (
        <section className="consent">
          <h2>Before we start</h2>
          <ul>
            <li>PAWSE uses your camera to read breathing and pulse from your face and upper body, using Presage SmartSpectra.</li>
            <li>Video is processed on this computer by the SDK. PAWSE does not save frames or measurements.</li>
            <li>SmartSpectra connects to Presage&apos;s servers to authorise the API key and may download its analysis model. PAWSE turns off the SDK&apos;s optional usage telemetry. The README explains what is and is not verified.</li>
            <li>Nothing is measured until you press the button, and the camera is released when you stop or finish.</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I agree to turn on my camera for this session.
          </label>
        </section>
      )}

      <div className="actions">
        {stage === 'meet' && (
          <button
            className="primary"
            disabled={(!consent && !simulated) || busy || !!blocked}
            onClick={() => void wake()}
          >
            {COPY.wake}
          </button>
        )}
        {live && (
          <button className="secondary" disabled={stopping || busy} onClick={() => void stopSession()}>
            Stop Session
          </button>
        )}
        {stage === 'peace' && (
          <button className="primary" onClick={() => experience.reset()}>
            {COPY.another}
          </button>
        )}
      </div>

      {diagOpen && !simulated && <DiagnosticsPanel session={state} history={history} catState={catState} />}

      <footer className="disclaimer">
        For general wellness and informational purposes only. PAWSE is not a medical device and
        does not diagnose, treat, or monitor any condition.
      </footer>

      {DevTools && (
        <Suspense fallback={null}>
          <DevTools onSimulation={onSimulation} />
        </Suspense>
      )}
    </main>
  )
}
