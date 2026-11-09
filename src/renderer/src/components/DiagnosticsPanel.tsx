import { useEffect, useState } from 'react'
import type { DiagnosticsSnapshot, IntervalStats, SignalDiagnostics } from '@shared/diagnostics'
import type { StateTransition } from '@shared/animation/catStateTracker'
import { breathPeriodSeconds, heartPeriodSeconds } from '@shared/animation/signalMapping'
import type { SessionState } from '@shared/signal'

const sec = (ms: number | null | undefined): string => (ms == null ? '–' : `${(ms / 1000).toFixed(2)} s`)

function stats(s: IntervalStats | null): string {
  return s
    ? `n=${s.count} · min ${sec(s.minMs)} · p50 ${sec(s.p50Ms)} · p95 ${sec(s.p95Ms)} · max ${sec(s.maxMs)}`
    : '–'
}

function Signal({ name, d }: { name: string; d: SignalDiagnostics }) {
  return (
    <>
      <h4>{name}</h4>
      <dl>
        <dt>readings</dt><dd>{d.readings} ({d.stableReadings} stable)</dd>
        <dt>first reading after</dt><dd>{sec(d.firstReadingAfterMs)}</dd>
        <dt>receive gaps</dt><dd>{stats(d.receiveIntervals)}</dd>
        <dt>SDK sample gaps</dt><dd>{stats(d.sdkSampleIntervals)}</dd>
        <dt>stable flips</dt><dd>{d.stabilityFlips}</dd>
        <dt>stale transitions</dt><dd>{d.staleTransitions} (longest gap {sec(d.longestGapMs)})</dd>
      </dl>
    </>
  )
}

interface Props {
  session: SessionState
  history: StateTransition[]
  catState: string
}

/**
 * Development-only. Shows SDK stream timing and stability. The copied report
 * contains counts and timings only: no vital-sign values, frames or credentials.
 */
export function DiagnosticsPanel({ session, history, catState }: Props) {
  const [snap, setSnap] = useState<DiagnosticsSnapshot | null>(null)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle')

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.pawse.getDiagnostics().then((s) => alive && setSnap(s))
    }
    load()
    const id = window.setInterval(load, 1000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  if (!snap) return null

  const b = session.signal.breathing
  const p = session.signal.pulse
  const report = JSON.stringify(
    {
      app: 'pawse',
      sdkVersion: session.sdkVersion,
      diagnostics: snap,
      catStateNow: catState,
      catStateHistory: history.map((h, i) => ({
        from: h.from,
        to: h.to,
        secondsSincePrevious: i === 0 ? null : +((h.atMs - history[i - 1]!.atMs) / 1000).toFixed(2)
      }))
    },
    null,
    2
  )

  return (
    <aside className="diag" aria-label="Development diagnostics">
      <h3>Diagnostics <small>development build only · ⌘/Ctrl+Shift+D</small></h3>
      <dl>
        <dt>session</dt><dd>{snap.sessionActive ? 'active' : 'ended'} · {sec(snap.sessionUptimeMs)}</dd>
        <dt>packets</dt>
        <dd>
          {snap.packets.total} (breathing {snap.packets.withBreathing}, pulse {snap.packets.withPulse}, none{' '}
          {snap.packets.withoutReadings}, malformed {snap.packets.malformed})
        </dd>
        <dt>packet gaps</dt><dd>{stats(snap.packets.intervals)}</dd>
        <dt>since last packet</dt><dd>{sec(snap.packets.sinceLastMs)}</dd>
        <dt>errors / recoveries</dt><dd>{JSON.stringify(snap.errors)} / {snap.recoveries}</dd>
        <dt>validation seen</dt><dd>{JSON.stringify(snap.validation)}</dd>
      </dl>
      <Signal name="Breathing" d={snap.breathing} />
      <Signal name="Pulse" d={snap.pulse} />
      <h4>Animation mapping (on screen only)</h4>
      <dl>
        <dt>cat state</dt><dd>{catState}</dd>
        <dt>breath cycle</dt><dd>{b ? `${sec(breathPeriodSeconds(b.value) * 1000)} (= 60 / ${b.value.toFixed(1)})` : '–'}</dd>
        <dt>heartbeat period</dt><dd>{p ? `${sec(heartPeriodSeconds(p.value) * 1000)} (= 60 / ${p.value.toFixed(1)})` : '–'}</dd>
        <dt>state changes</dt>
        <dd>{history.slice(-6).map((h) => `${h.from}→${h.to}`).join(', ') || '–'}</dd>
      </dl>
      <button
        className="diag-copy"
        onClick={() => {
          void navigator.clipboard
            .writeText(report)
            .then(() => setCopied('ok'))
            .catch(() => setCopied('failed'))
        }}
      >
        Copy report (no vitals)
      </button>
      {copied === 'ok' && <span className="muted small"> copied</span>}
      {copied === 'failed' && (
        <textarea className="diag-json" readOnly value={report} onFocus={(e) => e.currentTarget.select()} />
      )}
    </aside>
  )
}
