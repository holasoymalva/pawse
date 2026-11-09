import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static guards on the renderer source and stylesheet:
 * - the development simulation can never be reached in a production build
 * - every animation is disabled under prefers-reduced-motion
 */
const root = join(__dirname, '../renderer/src')
const css = readFileSync(join(root, 'styles.css'), 'utf8')

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })

describe('production builds cannot enable the simulation', () => {
  const appFiles = files(root).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !f.includes('/dev/') && !/\.test\.tsx?$/.test(f)
  )

  it('only App.tsx and main.tsx reference the dev modules, and only behind import.meta.env.DEV', () => {
    let referencing = 0
    for (const f of appFiles) {
      const text = readFileSync(f, 'utf8')
      if (!/from ['"]\.\/dev\/|import\(['"]\.\/dev\/|from ['"]\.\.\/dev\//.test(text)) continue
      referencing++
      expect(f.endsWith('App.tsx') || f.endsWith('main.tsx'), `${f} imports dev code`).toBe(true)
      if (f.endsWith('App.tsx')) {
        expect(text).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/dev\/DevTools'\)\)/)
        // the only other dev import is a type (erased at build time)
        expect(text).toMatch(/import type \{ SimulationOutput \} from '\.\/dev\/DevTools'/)
        expect(text.match(/from '\.\/dev\//g)?.length).toBe(1)
      }
      if (f.endsWith('main.tsx')) {
        expect(text).toMatch(/import\.meta\.env\.DEV && !\('pawse' in window\)\) await import\('\.\/dev\/browserStub'\)/)
      }
    }
    expect(referencing).toBe(2)
  })

  it('shared and main code never import renderer dev code', () => {
    for (const dir of ['../shared', '../main', '../preload']) {
      for (const f of files(join(__dirname, dir)).filter((x) => /\.tsx?$/.test(x))) {
        expect(readFileSync(f, 'utf8'), f).not.toMatch(/renderer\/src\/dev|\.\/dev\/(DevTools|simulation|browserStub)/)
      }
    }
  })

  it('the dev panel is collapsible and lives in the page flow (never fixed over the UI)', () => {
    expect(css).not.toMatch(/position:\s*fixed/)
    const rule = css.match(/\.devtools\s*\{[^}]*\}/)![0]
    expect(rule).not.toMatch(/position/)
    const tools = readFileSync(join(root, 'dev/DevTools.tsx'), 'utf8')
    expect(tools).toMatch(/<details/)
    expect(tools).toMatch(/<summary>/)
  })

  it('simulation modules declare themselves development-only', () => {
    for (const f of ['dev/DevTools.tsx', 'dev/simulation.ts', 'dev/browserStub.ts']) {
      expect(readFileSync(join(root, f), 'utf8')).toMatch(/DEVELOPMENT-ONLY|DEV ONLY/)
    }
  })
})

describe('reduced motion', () => {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
  const reduced = css.slice(at)
  const normal = css.slice(0, at)

  /** Selectors of every rule that starts a CSS animation outside the reduced-motion block. */
  function animatedSelectors(): string[] {
    const out: string[] = []
    const re = /([^{}]+)\{([^{}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(normal))) {
      const [, selector, body] = m
      if (/(^|;|\s)animation(-name)?\s*:/.test(body!) && !/@keyframes/.test(selector!)) out.push(selector!.trim())
    }
    return out
  }

  it('is present', () => {
    expect(at).toBeGreaterThan(0)
  })

  it('every rule that starts an animation is switched off for reduced motion', () => {
    const selectors = animatedSelectors()
    expect(selectors.length).toBeGreaterThanOrEqual(7)
    for (const sel of selectors) {
      // match on the final class of the selector, e.g. ".scene[data-stage='peace'] .celebrate .heart" → ".heart"
      const cls = sel.match(/\.[\w-]+(?![\w-]*[\s\S]*\.[\w-]+)/)?.[0] ?? sel
      expect(reduced, `${sel} must be disabled for reduced motion (${cls})`).toContain(cls)
    }
  })

  it('celebration is reduced to a static, gentle glow', () => {
    expect(reduced).toMatch(/celebrate \.heart \{ animation: none/)
  })
})
