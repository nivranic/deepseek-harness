/** Viewport checks (spec §8): the shell page extends under the system insets. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')

describe('viewport meta', () => {
  it('opts into viewport-fit=cover so env(safe-area-inset-*) is non-zero on notched devices', () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*" \/>/)
  })
})
