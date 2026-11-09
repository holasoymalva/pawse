import type { DiagnosticsSnapshot, IntervalStats, SignalDiagnostics } from '../shared/diagnostics'
import { STALE_AFTER_MS, type Reading } from '../shared/signal'

const MAX_SAMPLES = 1000
const MAX_TRANSITIONS = 40

export function intervalStats(values: readonly number[]): IntervalStats | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    count: sorted.length,
    minMs: Math.round(sorted[0]!),
    meanMs: Math.round(sum / sorted.length),
    p50Ms: Math.round(at(0.5)),
    p95Ms: Math.round(at(0.95)),
    maxMs: Math.round(sorted[sorted.length - 1]!)
  }
}

function push(arr: number[], v: number): void {
  arr.push(v)
  if (arr.length > MAX_SAMPLES) arr.shift()
}

class SignalTracker {
  readings = 0
  receiveGaps: number[] = []
  sdkGaps: number[] = []
  firstReadingAfterMs: number | null = null
  stabilityFlips = 0
  stableReadings = 0
  staleTransitions = 0
  longestGapMs: number | null = null
  private lastReceivedAt: number | null = null
  private lastSdkAt: number | null = null
  private lastStable: boolean | null = null
  private stale = false

  record(r: Reading, startedAt: number): void {
    if (this.lastReceivedAt === null) this.firstReadingAfterMs = r.receivedAtMs - startedAt
    else {
      const gap = r.receivedAtMs - this.lastReceivedAt
      push(this.receiveGaps, gap)
      this.longestGapMs = Math.max(this.longestGapMs ?? 0, gap)
    }
    if (this.lastSdkAt !== null && r.measuredAtMs !== this.lastSdkAt) {
      push(this.sdkGaps, r.measuredAtMs - this.lastSdkAt)
    }
    this.lastSdkAt = r.measuredAtMs
    this.lastReceivedAt = r.receivedAtMs
    if (this.lastStable !== null && this.lastStable !== r.stable) this.stabilityFlips++
    this.lastStable = r.stable
    if (r.stable) this.stableReadings++
    this.readings++
    this.stale = false
  }

  tick(nowMs: number): void {
    if (this.lastReceivedAt === null || this.stale) return
    if (nowMs - this.lastReceivedAt > STALE_AFTER_MS) {
      this.stale = true
      this.staleTransitions++
    }
  }

  snapshot(): SignalDiagnostics {
    return {
      readings: this.readings,
      receiveIntervals: intervalStats(this.receiveGaps),
      sdkSampleIntervals: intervalStats(this.sdkGaps),
      firstReadingAfterMs: this.firstReadingAfterMs,
      stabilityFlips: this.stabilityFlips,
      stableReadings: this.stableReadings,
      staleTransitions: this.staleTransitions,
      longestGapMs: this.longestGapMs
    }
  }
}

/**
 * Collects timing and stability statistics about the live SDK stream.
 * It never stores vital-sign values, confidence values, frames or credentials.
 */
export class Diagnostics {
  private startedAt: number | null = null
  private endedAt: number | null = null
  private total = 0
  private withBreathing = 0
  private withPulse = 0
  private withoutReadings = 0
  private malformed = 0
  private packetGaps: number[] = []
  private lastPacketAt: number | null = null
  private breathing = new SignalTracker()
  private pulse = new SignalTracker()
  private validation: Record<string, number> = {}
  private errors: Record<string, number> = {}
  private recoveries = 0
  private transitions: { status: string; atMs: number }[] = []

  begin(nowMs: number): void {
    this.startedAt = nowMs
    this.endedAt = null
    this.total = this.withBreathing = this.withPulse = this.withoutReadings = this.malformed = 0
    this.packetGaps = []
    this.lastPacketAt = null
    this.breathing = new SignalTracker()
    this.pulse = new SignalTracker()
    this.validation = {}
    this.errors = {}
    this.recoveries = 0
    this.transitions = []
  }

  end(nowMs: number): void {
    if (this.startedAt !== null && this.endedAt === null) this.endedAt = nowMs
  }

  packet(
    nowMs: number,
    result: { breathing: Reading | null; pulse: Reading | null } | 'malformed'
  ): void {
    if (this.startedAt === null) return
    this.total++
    if (this.lastPacketAt !== null) push(this.packetGaps, nowMs - this.lastPacketAt)
    this.lastPacketAt = nowMs
    if (result === 'malformed') {
      this.malformed++
      return
    }
    if (result.breathing) {
      this.withBreathing++
      this.breathing.record(result.breathing, this.startedAt)
    }
    if (result.pulse) {
      this.withPulse++
      this.pulse.record(result.pulse, this.startedAt)
    }
    if (!result.breathing && !result.pulse) this.withoutReadings++
  }

  validationSeen(name: string): void {
    this.validation[name] = (this.validation[name] ?? 0) + 1
  }

  errorSeen(name: string): void {
    this.errors[name] = (this.errors[name] ?? 0) + 1
  }

  recovery(): void {
    this.recoveries++
  }

  status(status: string, nowMs: number): void {
    if (this.startedAt === null) return
    const last = this.transitions.at(-1)
    if (last?.status === status) return
    this.transitions.push({ status, atMs: nowMs - this.startedAt })
    if (this.transitions.length > MAX_TRANSITIONS) this.transitions.shift()
  }

  tick(nowMs: number): void {
    this.breathing.tick(nowMs)
    this.pulse.tick(nowMs)
  }

  snapshot(nowMs: number): DiagnosticsSnapshot {
    const end = this.endedAt ?? nowMs
    return {
      sessionActive: this.startedAt !== null && this.endedAt === null,
      sessionUptimeMs: this.startedAt === null ? 0 : end - this.startedAt,
      packets: {
        total: this.total,
        withBreathing: this.withBreathing,
        withPulse: this.withPulse,
        withoutReadings: this.withoutReadings,
        malformed: this.malformed,
        intervals: intervalStats(this.packetGaps),
        sinceLastMs: this.lastPacketAt === null || this.endedAt !== null ? null : nowMs - this.lastPacketAt
      },
      breathing: this.breathing.snapshot(),
      pulse: this.pulse.snapshot(),
      validation: { ...this.validation },
      errors: { ...this.errors },
      recoveries: this.recoveries,
      processingTransitions: [...this.transitions]
    }
  }
}
