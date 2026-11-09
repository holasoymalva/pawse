import { readFileSync } from 'node:fs'

/** Minimal .env parser: KEY=VALUE lines, # comments, optional surrounding quotes. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const PLACEHOLDER = 'YOUR_API_KEY_HERE'

/**
 * Resolve the API key from the process environment first, then from a local
 * `.env` file. Returns null if absent or still the placeholder.
 */
export function loadApiKey(envFilePath: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let key = env.SMARTSPECTRA_API_KEY?.trim()
  if (!key) {
    try {
      key = parseEnv(readFileSync(envFilePath, 'utf8')).SMARTSPECTRA_API_KEY?.trim()
    } catch {
      key = undefined
    }
  }
  return key && key !== PLACEHOLDER ? key : null
}
