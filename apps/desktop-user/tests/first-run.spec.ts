/** First-run personal desktop profile initialization through the real loader. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { composeEntries, loadProfile, PROFILE_PATCH_FILENAME } from '@deepseek-ai/dsh-app-boot'
import { createDesktopProfile } from '../src/first-run.ts'
import { resolveDesktopPaths, resolvePersonalDshHome } from '../src/paths.ts'

/** The bundle list the desktop apps give the `desktop` profile: the shared web composition. */
const DESKTOP_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** The repository's dsh installation, the same anchor the shell's launcher resolves against. */
const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))

it('boots the desktop profile from an empty personal home', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-user-first-run-'))
  try {
    createDesktopProfile(resolveDesktopPaths(home).profile)
    // The exact resolution the shell's runProfile performs: before first-run
    // initialization this threw, because no shipped template carries the
    // `desktop` name.
    const profile = loadProfile('dsh desktop-user', 'desktop', installAnchor, home)
    expect(profile.layers.map(layer => layer.packageName)).toEqual(DESKTOP_BUNDLES)
    const warnings: string[] = []
    const rows = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
    ], message => warnings.push(message))
    expect(rows.find(row => row.id === 'webserver')?.name).toBe('@deepseek-ai/dsh-host-webserver')
    expect(warnings).toEqual([])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

it('initializes under a DSH_DESKTOP_USER_HOME override through the same entry', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-user-first-run-'))
  const override = join(home, 'override-home')
  try {
    const personalHome = resolvePersonalDshHome(home, override)
    createDesktopProfile(resolveDesktopPaths(personalHome).profile)
    const profile = loadProfile('dsh desktop-user', 'desktop', installAnchor, personalHome)
    expect(profile.layers.map(layer => layer.packageName)).toEqual(DESKTOP_BUNDLES)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

it('never rewrites an initialized profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-user-first-run-'))
  try {
    const profileDir = resolveDesktopPaths(home).profile
    createDesktopProfile(profileDir)
    const manifestPath = join(profileDir, 'package.json')
    const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    writeFileSync(patchPath, '# personal layer kept\n[]\n')
    const manifest = readFileSync(manifestPath, 'utf8')
    const workspace = readFileSync(workspacePath, 'utf8')
    createDesktopProfile(profileDir)
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifest)
    expect(readFileSync(patchPath, 'utf8')).toBe('# personal layer kept\n[]\n')
    expect(readFileSync(workspacePath, 'utf8')).toBe(workspace)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
