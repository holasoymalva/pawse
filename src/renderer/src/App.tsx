import { useEffect, useRef, useState } from 'react'
import type { Availability } from '@shared/signal'
import { CAT_STATE_LABEL } from '@shared/animation/catState'
import { CatPlaceholder } from './components/CatPlaceholder'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { Readout } from './components/Readout'
import { useCatAnimation } from './useCatAnimation'
import { useSession } from './useSession'

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

const BREATH_LABEL = {
  live: 'live reading',
  held: 'last reading (paused)',
  decorative: 'decorative, not a measurement'
} as const
const HEART_LABEL = { live: 'live reading', none: 'off' } as const

export function App() {
  const { state, nowMs, busy, start, stop } = useSession()
  const [consent, setConsent] = useState(false)
  const catRef = useRef<SVGSVGElement>(null)
  const { catState, motion, history } = useCatAnimation(
    catRef,
    state ?? { phase: 'idle', signal: { pulse: null, breathing: null } }
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

  return (
    <main className="app">
      <header className="brand">
        <h1>PAWSE</h1>
        <p className="muted">a tiny cat that breathes with you</p>
      </header>

      <section className="stage">
        <div className="cat-wrap">
          <CatPlaceholder state={catState} svgRef={catRef} />
          <span className={`cat-state cat-state-${catState}`} role="status">{CAT_STATE_LABEL[catState]}</span>
          <div className="chips" aria-label="What the motion is based on">
            <span className={`chip chip-${motion.breath}`} data-testid="chip-breath">
              Breathing · {BREATH_LABEL[motion.breath]}
            </span>
            <span className={`chip chip-${motion.heart}`} data-testid="chip-heart">
              Heartbeat · {HEART_LABEL[motion.heart]}
            </span>
          </div>
        </div>
        <div className="readouts">
          <Readout label="Breathing" unit="br/min" reading={state.signal.breathing} nowMs={nowMs} running={running} />
          <Readout label="Pulse" unit="bpm" reading={state.signal.pulse} nowMs={nowMs} running={running} />
        </div>
      </section>

      {sessionOn && (
        <div className="status" role="status">
          <span className={`dot ${running ? 'on' : ''}`} />
          {starting && state.recoveryAttempt > 0 && `Reconnecting to SmartSpectra… (attempt ${state.recoveryAttempt})`}
          {starting && state.recoveryAttempt === 0 && 'Starting camera and SmartSpectra…'}
          {running && 'Camera is on · measuring'}
          {stopping && 'Stopping and releasing the camera…'}
        </div>
      )}

      {running && (
        <p className="muted small">
          The cat follows your measured breathing and pulse <em>rate</em>. It is not synchronised to
          each individual breath or heartbeat.
        </p>
      )}

      {sessionOn && state.validation && !state.validation.ok && (
        <p className="hint" role="status">{state.validation.hint}</p>
      )}

      {sessionOn && state.notice && (
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

      {!sessionOn && !blocked && (
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

      {diagOpen && <DiagnosticsPanel session={state} history={history} catState={catState} />}

      <footer className="disclaimer">
        For general wellness and informational purposes only. PAWSE is not a medical device and
        does not diagnose, treat, or monitor any condition.
      </footer>
    </main>
  )
}
