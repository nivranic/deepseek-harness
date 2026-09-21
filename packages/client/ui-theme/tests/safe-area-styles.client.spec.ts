/** Safe-area token checks (spec §8): the token sheet owns the four inset variables. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sheet = readFileSync(fileURLToPath(new URL('../src/styles/base.css', import.meta.url)), 'utf8')

describe('safe-area inset tokens', () => {
  it('declares every safe-area edge over env() with a zero fallback', () => {
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(sheet).toMatch(new RegExp(`--dsw-safe-area-${edge}:\\s*env\\(safe-area-inset-${edge}, 0px\\)`))
    }
  })

  it('declares them on :root so every consumer resolves them', () => {
    const root = sheet.slice(sheet.indexOf(':root'), sheet.indexOf('}', sheet.indexOf(':root')))
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(root).toContain(`--dsw-safe-area-${edge}`)
    }
  })
})
