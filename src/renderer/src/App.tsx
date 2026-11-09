import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CAT_STATE_LABEL } from '@shared/animation/catState'
import type { Availability, SessionState } from '@shared/signal'
import { CatScene } from './components/CatScene'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { Readout } from './components/Readout'
import { BREATH_LABEL, DESCRIPTION, HEADLINE, HEART_LABEL, SIMULATED_LABEL } from './catCopy'
import { useCatAnimation } from './useCatAnimation'
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

export function App() {
  const { state: realState, nowMs, busy, start, stop } = useSession()
  const [simState, setSimState] = useState<SessionState | null>(null)
  const simulated = simState !== null
  const state = simState ?? realState

  const [consent, setConsent] = useState(false)
  const catRef = useRef<SVGSVGElement>(null)
  const { catState, motion, history, pet } = useCatAnimation(
    catRef,
    state ?? { phase: 'idle', signal: IDLE_SIGNAL }
  )
  const [diagOpen, setDiagOpen] = useState(false)

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
  const sessionOn = starting || running || stopping
  const breathLabel = simulated && motion.breath === 'live' ? SIMULATED_LABEL : BREATH_LABEL[motion.breath]
  const showVitals = sessionOn || simulated
  const heartLabel = simulated && motion.heart === 'live' ? SIMULATED_LABEL : HEART_LABEL[motion.heart]

  return (
    <main className="app" data-state={catState}>
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
          <CatScene state={catState} svgRef={catRef} description={DESCRIPTION[catState]} />
        </button>

        <p className="headline">{HEADLINE[catState]}</p>
        <span className={`state-pill state-pill-${catState}`} role="status">{CAT_STATE_LABEL[catState]}</span>

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
      </section>

      {sessionOn && !simulated && (
        <div className="status" role="status">
          <span className={`dot ${running ? 'on' : ''}`} />
          {starting && state.recoveryAttempt > 0 && `Reconnecting to SmartSpectra… (attempt ${state.recoveryAttempt})`}
          {starting && state.recoveryAttempt === 0 && 'Starting camera and SmartSpectra…'}
          {running && 'Camera is on · measuring'}
          {stopping && 'Stopping and releasing the camera…'}
        </div>
      )}

      {running && !simulated && (
        <p className="muted small center">
          The cat follows your measured breathing and pulse <em>rate</em>. It is not synchronised to
          each individual breath or heartbeat.
        </p>
      )}

      {sessionOn && !simulated && state.validation && !state.validation.ok && (
        <p className="hint" role="status">{state.validation.hint}</p>
      )}

      {sessionOn && !simulated && state.notice && (
        <div className="notice" role="status">
          <strong>SDK notice · {state.notice.name}</strong>
          <p>{state.notice.message} The session is still running.</p>
        </div>
      )}

      {state.error && (
        <div className="notice error" role="alert">
          <strong>{state.error.name}</strong>
          <p>{state.error.message}{state.error.retryable ? ' You can try again.' : ''}</p>
        </div>
      )}

      {blocked && (
        <div className="notice error" role="alert">
          <strong>{blocked.title}</strong>
          <p>{blocked.body}</p>
        </div>
      )}

      {!sessionOn && !blocked && !simulated && (
        <section className="consent">
          <h2>Before we start</h2>
          <ul>
            <li>PAWSE uses your camera to read breathing and pulse from your face and upper body, using Presage SmartSpectra.</li>
            <li>Video is processed on this computer by the SDK. PAWSE does not save frames or measurements.</li>
            <li>SmartSpectra connects to Presage&apos;s servers to authorise the API key and may download its analysis model. PAWSE turns off the SDK&apos;s optional usage telemetry. The README explains what is and is not verified.</li>
            <li>Nothing is measured until you press Start, and the camera is released when you press Stop.</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I agree to turn on my camera for this session.
          </label>
        </section>
      )}

      {!simulated && (
        <div className="actions">
          {!sessionOn ? (
            <button className="primary" disabled={!consent || busy || !!blocked} onClick={() => void start()}>
              Start Session
            </button>
          ) : (
            <button className="secondary" disabled={stopping || busy} onClick={() => void stop()}>
              Stop Session
            </button>
          )}
        </div>
      )}

      {diagOpen && !simulated && <DiagnosticsPanel session={state} history={history} catState={catState} />}

      {DevTools && (
        <Suspense fallback={null}>
          <DevTools onSimulation={setSimState} />
        </Suspense>
      )}

      <footer className="disclaimer">
        For general wellness and informational purposes only. PAWSE is not a medical device and
        does not diagnose, treat, or monitor any condition.
      </footer>
    </main>
  )
}
