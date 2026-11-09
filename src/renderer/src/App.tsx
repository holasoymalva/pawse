import { useState } from 'react'
import type { Availability } from '@shared/signal'
import { CatPlaceholder } from './components/CatPlaceholder'
import { Readout } from './components/Readout'
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

export function App() {
  const { state, nowMs, busy, start, stop } = useSession()
  const [consent, setConsent] = useState(false)

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
        <CatPlaceholder active={running} />
        <div className="readouts">
          <Readout label="Breathing" unit="br/min" reading={state.signal.breathing} nowMs={nowMs} running={running} />
          <Readout label="Pulse" unit="bpm" reading={state.signal.pulse} nowMs={nowMs} running={running} />
        </div>
      </section>

      {sessionOn && (
        <div className="status" role="status">
          <span className={`dot ${running ? 'on' : ''}`} />
          {starting && 'Starting camera and SmartSpectra…'}
          {running && 'Camera is on · measuring'}
          {stopping && 'Stopping and releasing the camera…'}
        </div>
      )}

      {sessionOn && state.validation && !state.validation.ok && (
        <p className="hint" role="status">{state.validation.hint}</p>
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
            <li>SmartSpectra contacts Presage&apos;s servers to validate the API key. Optional usage telemetry is turned off in PAWSE.</li>
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

      <footer className="disclaimer">
        For general wellness and informational purposes only. PAWSE is not a medical device and
        does not diagnose, treat, or monitor any condition.
      </footer>
    </main>
  )
}
