/** Profile plugin commands keep pnpm's root-package allowance local to the selected profile. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runPlugin } from '../src/plugin.ts'

const mocks = vi.hoisted(() => ({
  execaSync: vi.fn<(...args: unknown[]) => { exitCode?: number; code?: string }>(() => ({ exitCode: 0 })),
}))
vi.mock('execa', async importOriginal => ({ ...await importOriginal<typeof import('execa')>(), execaSync: mocks.execaSync }))

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it.each(['sdk', 'custom'])('adds plugins to the %s profile workspace root', (profile) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cli-plugin-'))
  roots.push(home)
  vi.stubEnv('DSH_HOME', home)
  const directory = join(home, 'profiles', profile)
  const argument = './plugin with spaces'

  expect(runPlugin(profile, ['add', argument])).toBe(0)

  expect(mocks.execaSync).toHaveBeenCalledWith('pnpm', [
    '--config.ignore-workspace-root-check=true', 'add', resolve(argument),
  ], { cwd: directory, stdio: 'inherit', reject: false })
  expect(readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8')).not.toContain('ignoreWorkspaceRootCheck')
})

it.each([
  [Object.assign(new Error('pnpm missing'), { code: 'ENOENT' }), 127],
  [{ exitCode: 23 }, 23],
  [{}, 1],
] as const)('preserves missing-command, child-exit and signal outcomes: %j', (result, code) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cli-plugin-exit-'))
  roots.push(home)
  vi.stubEnv('DSH_HOME', home)
  mocks.execaSync.mockReturnValueOnce(result)
  expect(runPlugin('sdk', ['--version'])).toBe(code)
})

it('propagates process-start failures other than a missing pnpm command', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cli-plugin-error-'))
  roots.push(home)
  vi.stubEnv('DSH_HOME', home)
  const error = Object.assign(new Error('process start denied'), { code: 'EPERM' })
  mocks.execaSync.mockReturnValueOnce(error)
  expect(() => runPlugin('sdk', ['--version'])).toThrow(error)
})
