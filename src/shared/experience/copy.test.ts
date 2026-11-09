import { describe, expect, it } from 'vitest'
import { EMPTY_SIGNAL, type Reading, type SessionError } from '../signal'
import { connectionMessage, friendlyError, pauseMessage } from './copy'

const reading = (stable = true): Reading => ({ value: 14, measuredAtMs: 1, receivedAtMs: 1, confidence: 80, stable })
const base = { phase: 'running' as const, signal: EMPTY_SIGNAL, validation: null, recoveryAttempt: 0 }

describe('connectionMessage (reflects real state only)', () => {
  it('walks through honest, friendly messages', () => {
    expect(connectionMessage({ ...base, phase: 'starting' }, 'searching')).toMatch(/camera/i)
    expect(connectionMessage(base, 'searching')).toMatch(/face the camera/i)
    expect(connectionMessage({ ...base, signal: { breathing: reading(false), pulse: null } }, 'settling')).toMatch(/almost there/i)
    expect(connectionMessage({ ...base, signal: { breathing: null, pulse: reading() } }, 'settling')).toMatch(/pulse/i)
  })
  it('shows SDK validation hints and recovery progress first', () => {
    const hint = { code: 5, name: 'kTooDark', hint: 'Add more light.', ok: false, atMs: 1 }
    expect(connectionMessage({ ...base, validation: hint }, 'searching')).toBe('Add more light.')
    expect(connectionMessage({ ...base, recoveryAttempt: 2 }, 'searching')).toMatch(/Reconnecting.*2/)
  })
  it('never says it is connected before a stable breathing reading', () => {
    const msgs = [
      connectionMessage(base, 'searching'),
      connectionMessage({ ...base, signal: { breathing: reading(false), pulse: null } }, 'settling')
    ]
    for (const m of msgs) expect(m.toLowerCase()).not.toContain('connected')
  })
})

describe('friendlyError', () => {
  const err = (name: string, message = 'x'): SessionError => ({ code: null, name, message, retryable: false })
  it('explains camera permission denial using the guidance from main', () => {
    const f = friendlyError(err('CameraPermission', 'Enable the camera in System Settings.'))
    expect(f.title).toMatch(/camera/i)
    expect(f.body).toContain('System Settings')
  })
  it('explains exhausted credits (code name or HTTP 402 text)', () => {
    expect(friendlyError(err('kCreditExhausted')).title).toMatch(/credits/i)
    expect(friendlyError(err('Error', 'Status: 402 Insufficient credits')).body).toMatch(/physiology\.presagetech\.com/)
  })
  it('covers auth, network, recovery failure and missing camera', () => {
    expect(friendlyError(err('kAuthenticationFailed')).title).toMatch(/key/i)
    for (const n of ['kNetworkError', 'kServerError', 'RecoveryFailed']) expect(friendlyError(err(n)).title).toMatch(/reach/i)
    expect(friendlyError(err('kInputUnavailable')).title).toMatch(/unavailable/i)
  })
  it('falls back to the raw error for anything else', () => {
    expect(friendlyError(err('Weird', 'details'))).toEqual({ title: 'Weird', body: 'details' })
  })
})

describe('pauseMessage (why the timer paused)', () => {
  const fresh = (stable: boolean): Reading => ({ value: 10, measuredAtMs: Date.now(), receivedAtMs: Date.now(), confidence: 30, stable })
  const sess = (breathing: Reading | null) => ({ phase: 'running' as const, signal: { breathing, pulse: null } })

  it('says breathing is settling when a fresh reading is just not stable yet', () => {
    const m = pauseMessage(sess(fresh(false)), Date.now())
    expect(m.title).toBe('Breathing is settling')
    expect(m.lede).toMatch(/steadies/)
    expect(m.title.toLowerCase()).not.toContain('lost')
    expect(m.pill).toBe('Signal unstable')
  })

  it('says the signal is lost only when there is no fresh reading', () => {
    expect(pauseMessage(sess(null), Date.now()).title).toBe('Lost your signal')
    expect(pauseMessage(sess(null), Date.now()).pill).toBe('Signal lost')
    const old = { ...fresh(true), receivedAtMs: Date.now() - 60_000 }
    expect(pauseMessage(sess(old), Date.now()).title).toBe('Lost your signal')
    expect(pauseMessage({ phase: 'starting', signal: { breathing: fresh(false), pulse: null } }, Date.now()).title).toBe('Lost your signal')
  })

  it('never shows "Connected" while the timer is paused', () => {
    for (const m of [pauseMessage(sess(fresh(false)), Date.now()), pauseMessage(sess(null), Date.now())]) {
      expect(m.pill.toLowerCase()).not.toContain('connected')
    }
  })

  it('never blames the user or scores them', () => {
    for (const m of [pauseMessage(sess(fresh(false)), Date.now()), pauseMessage(sess(null), Date.now())]) {
      expect(`${m.title} ${m.lede}`.toLowerCase()).not.toMatch(/fail|wrong|bad|score|stress/)
    }
  })
})
