import { useCallback, useEffect, useState } from 'react'
import type { SessionState } from '@shared/signal'

/** Mirrors main-process session state; also ticks so freshness can be recomputed. */
export function useSession() {
  const [state, setState] = useState<SessionState | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.pawse.getState().then((s) => alive && setState(s))
    const off = window.pawse.onState((s) => setState(s))
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => {
      alive = false
      off()
      window.clearInterval(tick)
    }
  }, [])

  const start = useCallback(async () => {
    setBusy(true)
    try {
      setState(await window.pawse.start({ consent: true }))
    } finally {
      setBusy(false)
    }
  }, [])

  const stop = useCallback(async () => {
    setBusy(true)
    try {
      setState(await window.pawse.stop())
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, nowMs, busy, start, stop }
}
