// Fails if the production renderer bundle contains development-only simulation code.
// Run after `npm run build` (see `npm run check:prod`).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Optional argument: another assets directory (used to test that the check can fail).
const dir = process.argv[2] ?? new URL('../out/renderer/assets/', import.meta.url).pathname
const forbidden = [
  'buildSimState',
  'DEV ONLY',
  'Simulation scenario',
  'Simulation speed',
  'Simulated data only',
  'browser-preview',
  'simulated error for visual testing',
  'Simulated: Insufficient'
]

let files
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.js'))
} catch {
  console.error('out/renderer/assets not found. Run `npm run build` first.')
  process.exit(2)
}
if (files.length === 0) {
  console.error('No renderer bundle found.')
  process.exit(2)
}

const bad = []
for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8')
  for (const needle of forbidden) if (text.includes(needle)) bad.push(`${f}: contains "${needle}"`)
}
// control: the real UI must be in the bundle, so an empty/mismatched scan can't pass silently
const all = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
if (!all.includes('Wake up PAWSE')) bad.push('control string "Wake up PAWSE" missing: scanned the wrong bundle?')

if (bad.length) {
  console.error('Production bundle check FAILED:\n- ' + bad.join('\n- '))
  process.exit(1)
}
console.log(`Production bundle check passed (${files.length} file(s), ${forbidden.length} forbidden strings absent).`)
