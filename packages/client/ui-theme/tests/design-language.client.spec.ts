/** Design-language audit (specification §9): component CSS consumes the shared
 * token layer instead of forking per-platform values; raw color literals stay
 * confined to files that document why a literal is load-bearing. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Files whose raw literals carry a documented reason to bypass tokens. */
const DOCUMENTED_EXCEPTIONS = new Set([
  // The hover-card surface is fixed-dark in both themes (figma 169:16903):
  // its light-on-dark text values must not follow the theme aliases.
  'packages/client/ui-workspace/src/client/rows/Rows.module.css',
  // Same fixed-surface rationale for the primitives hover card (figma value,
  // light/dark identical).
  'packages/client/ui-primitives/src/HoverCard.module.css',
  // The send arrow stays white on the blue fill in both themes (design
  // 34:10465), documented inline at the declaration.
  'packages/client/ui-conversation/src/client/skeleton/InputBar.module.css',
  // JSON token colors are a code-highlighting theme, not theme-semantic UI
  // color (header comment in the file).
  'packages/client/ui-primitives/src/JsonTree.module.css',
  // The framework-free boot page renders before theme delivery can be
  // assumed; it defines its own --dsh-boot-* literals (header comment).
  'packages/client/web/src/boot-page.module.css',
])

const repoRoot = resolve(import.meta.dirname, '../../../..')

/** CSS under each client package's src tree; the token layer (ui-theme)
 * defines the literal values every consumer shares and is walked separately. */
function clientCssFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.css')) found.push(full.replaceAll('\\', '/'))
    }
  }
  for (const name of readdirSync(join(repoRoot, 'packages/client'))) {
    if (name === 'ui-theme') continue
    const src = join(repoRoot, 'packages/client', name, 'src')
    if (statSync(src, { throwIfNoEntry: false })?.isDirectory() === true) walk(src)
  }
  return found
}

/** CSS with comments, url(...) spans, var(...) references, and mask-image
 * declarations removed; data-URI palettes, design notes, token fallback
 * values, and mask alpha ramps are not consumer-side color choices. */
function declarationsOnly(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/url\([^)]*\)/g, ' ')
    .replace(/var\([^)]*\)/g, ' ')
    .replace(/mask-image:[^;]*;/g, ' ')
}

describe('design language (specification §9)', () => {
  it('keeps raw hex color literals out of component CSS', () => {
    const offenders: string[] = []
    for (const path of clientCssFiles()) {
      const relative = path.slice(path.indexOf('packages/client/'))
      if (DOCUMENTED_EXCEPTIONS.has(relative)) continue
      if (/#[0-9a-fA-F]{3,8}\b/u.test(declarationsOnly(readFileSync(path, 'utf8')))) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })

  it('confines the documented literal exceptions to their named files', () => {
    for (const relative of DOCUMENTED_EXCEPTIONS) {
      const css = readFileSync(join(repoRoot, relative), 'utf8')
      // The exception stays load-bearing: the file still names its literal
      // values in declarations, not only in prose.
      expect(/#[0-9a-fA-F]{3,8}\b/u.test(declarationsOnly(css))).toBe(true)
    }
  })
})
