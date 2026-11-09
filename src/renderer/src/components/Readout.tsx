import { freshnessOf, type Reading } from '@shared/signal'

interface Props {
  label: string
  unit: string
  reading: Reading | null
  nowMs: number
  running: boolean
}

export function Readout({ label, unit, reading, nowMs, running }: Props) {
  const freshness = freshnessOf(reading, nowMs)
  const note =
    freshness === 'none'
      ? running
        ? 'Waiting for a measurement…'
        : 'Not measuring'
      : freshness === 'stale'
        ? 'No recent update'
        : reading && !reading.stable
          ? 'Settling…'
          : 'Live'
  const dim = freshness !== 'fresh' || (reading !== null && !reading.stable)
  return (
    <div className={`readout ${dim ? 'dim' : ''}`}>
      <span className="readout-label">{label}</span>
      <span className="readout-value">
        {reading && freshness !== 'none' ? Math.round(reading.value) : '–'}
        <small>{unit}</small>
      </span>
      <span className="readout-note">{note}</span>
    </div>
  )
}
