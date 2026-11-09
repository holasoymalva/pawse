import { describe, expect, it } from 'vitest'
import { loadApiKey, parseEnv } from './config'

describe('parseEnv', () => {
  it('parses keys, comments and quotes', () => {
    expect(parseEnv('# c\nA=1\nB="two"\n C = \'three\' \nbad\n')).toEqual({ A: '1', B: 'two', C: 'three' })
  })
})

describe('loadApiKey', () => {
  it('prefers the environment', () => {
    expect(loadApiKey('/nonexistent', { SMARTSPECTRA_API_KEY: ' abc ' })).toBe('abc')
  })
  it('returns null when missing or placeholder', () => {
    expect(loadApiKey('/nonexistent', {})).toBeNull()
    expect(loadApiKey('/nonexistent', { SMARTSPECTRA_API_KEY: 'YOUR_API_KEY_HERE' })).toBeNull()
  })
})
