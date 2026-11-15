/** Personal desktop home resolution without filesystem or environment changes. */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDesktopPaths, resolvePersonalDshHome } from '../src/paths.ts'

describe('personal desktop paths', () => {
  it('keeps personal profile and lock paths separate from ordinary .dsh', () => {
    const home = resolve('test-user-home')
    const personalHome = resolvePersonalDshHome(home, undefined)
    const personal = resolveDesktopPaths(personalHome)
    const ordinary = resolveDesktopPaths(join(home, '.dsh'))
    expect(personalHome).toBe(join(home, '.dsh-personal'))
    expect(personal).toEqual({
      profile: join(home, '.dsh-personal', 'profiles', 'desktop'),
      lock: join(home, '.dsh-personal', 'profiles', 'desktop', 'lock'),
    })
    expect(personal.profile).not.toBe(ordinary.profile)
    expect(personal.lock).not.toBe(ordinary.lock)
  })

  it('uses an explicit absolute override for profile and lock paths', () => {
    const override = resolve('personal-data')
    const home = resolvePersonalDshHome(resolve('test-user-home'), override)
    expect(home).toBe(override)
    expect(resolveDesktopPaths(home)).toEqual({
      profile: join(override, 'profiles', 'desktop'),
      lock: join(override, 'profiles', 'desktop', 'lock'),
    })
  })

  it.each(['', ' ', '.', 'relative/home'])('rejects the nonabsolute override %j', (override) => {
    expect(() => resolvePersonalDshHome(resolve('test-user-home'), override))
      .toThrow('DSH_DESKTOP_USER_HOME must be a nonempty absolute path')
  })

  it('resolves default desktop paths from the personal home setting', () => {
    const home = resolvePersonalDshHome(homedir(), process.env.DSH_DESKTOP_USER_HOME)
    expect(resolveDesktopPaths()).toEqual(resolveDesktopPaths(home))
  })

  it('does not mutate the environment on success or failure', () => {
    const before = { ...process.env }
    resolvePersonalDshHome(resolve('test-user-home'), undefined)
    resolvePersonalDshHome(resolve('test-user-home'), resolve('personal-data'))
    expect(() => resolvePersonalDshHome(resolve('test-user-home'), '')).toThrow()
    resolveDesktopPaths(resolve('personal-data'))
    expect({ ...process.env }).toEqual(before)
  })
})
