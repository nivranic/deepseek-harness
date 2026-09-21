/** Safe-area shell checks (spec §8): the frame keeps content inside the four insets. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sheet = readFileSync(fileURLToPath(new URL('../src/client/AppFrame.module.css', import.meta.url)), 'utf8')

const rule = (name: string): string => {
  const at = sheet.indexOf(name)
  expect(at).toBeGreaterThanOrEqual(0)
  return sheet.slice(at, sheet.indexOf('}', at))
}

describe('safe-area shell adaptation', () => {
  it('pads the frame with all four safe-area edges, each with a zero fallback', () => {
    const padding = new RegExp(
      'padding:\\s*var\\(--dsw-safe-area-top, 0px\\) var\\(--dsw-safe-area-right, 0px\\)'
      + '\\s*\\n?\\s*var\\(--dsw-safe-area-bottom, 0px\\) var\\(--dsw-safe-area-left, 0px\\)',
    )
    expect(sheet).toMatch(padding)
  })

  it('keeps the phone overlay drawer inside the safe area on its three anchored edges', () => {
    const drawer = rule('.frame[data-sidebar-overlay] .sidebarCol')
    expect(drawer).toMatch(/top:\s*var\(--dsw-safe-area-top, 0px\)/)
    expect(drawer).toMatch(/bottom:\s*var\(--dsw-safe-area-bottom, 0px\)/)
    expect(drawer).toMatch(/left:\s*var\(--dsw-safe-area-left, 0px\)/)
  })

  it('bounds the drag handles by the vertical safe areas', () => {
    const handle = rule('.handle')
    expect(handle).toMatch(/top:\s*var\(--dsw-safe-area-top, 0px\)/)
    expect(handle).toMatch(/bottom:\s*var\(--dsw-safe-area-bottom, 0px\)/)
  })
})
