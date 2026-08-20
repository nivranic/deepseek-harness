/** Copy bundles: complete, mutually aligned, and distinct between locales. */

import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('desktop row copy', () => {
  it('covers every key in both locales', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const value of [...Object.values(en), ...Object.values(zh)]) {
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('names the two behaviors distinctly within each locale', () => {
    expect(en.tray).not.toBe(en.quit)
    expect(zh.tray).not.toBe(zh.quit)
  })
})
