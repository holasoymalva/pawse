/**
 * Development diagnostics. These types intentionally carry timing, counts and
 * stability flags only: never pulse/breathing values, camera frames, or keys.
 */
export interface IntervalStats {
  count: number
  minMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

export interface SignalDiagnostics {
  /** Readings received (one per packet that carried a usable sample for this signal). */
  readings: number
  /** Receive-time gaps between consecutive readings. */
  receiveIntervals: IntervalStats | null
  /** Gaps between the SDK's own sample timestamps of consecutive *new* readings. */
  sdkSampleIntervals: IntervalStats | null
  /** ms from session start to the first reading. */
  firstReadingAfterMs: number | null
  /** Times the SDK `stable` flag flipped. */
  stabilityFlips: number
  stableReadings: number
  /** Times no new reading arrived for the stale threshold. */
  staleTransitions: number
  /** Longest gap (ms) between readings seen so far. */
  longestGapMs: number | null
}

export interface DiagnosticsSnapshot {
  sessionActive: boolean
  sessionUptimeMs: number
  packets: {
    total: number
    withBreathing: number
    withPulse: number
    /** Decoded fine but no usable breathing/pulse sample. */
    withoutReadings: number
    malformed: number
    intervals: IntervalStats | null
    sinceLastMs: number | null
  }
  breathing: SignalDiagnostics
  pulse: SignalDiagnostics
  /** SDK validation codes seen, by name. */
  validation: Record<string, number>
  /** SDK errors seen, by name. */
  errors: Record<string, number>
  recoveries: number
  processingTransitions: { status: string; atMs: number }[]
}
