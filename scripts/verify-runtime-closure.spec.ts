import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCordisYaml } from './cordis-yaml.ts'
import { verifyRuntimeClosure } from './verify-runtime-closure.ts'

const roots: string[] = []

function fixture(files: Record<string, string | Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-closure-'))
  roots.push(root)
  for (const [relative, value] of Object.entries(files)) {
    const preset = /^preset:(.+)$/.exec(relative)
    const path = join(root, preset === null ? relative : `packages/bundle/web-app/presets/${preset[1]}.patch.yml`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, preset === null ? (typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`) : JSON.stringify([{ insert: [{ name: '@deepseek-ai/dsh-agent-preset', config: { id: preset[1], plugins: typeof value === 'string' ? loadCordisYaml(value) : value } }] }]))
  }
  return root
}

const platforms = {
  'linux-x64': { tag: 'manylinux_2_28_x86_64', executable: 'runtime-linux-x64' },
  'linux-arm64': { tag: 'manylinux_2_28_aarch64', executable: 'runtime-linux-arm64' },
  'macos-arm64': { tag: 'macosx_14_0_arm64', executable: 'runtime-macos-arm64' },
  'macos-x64': { tag: 'macosx_14_0_x86_64', executable: 'runtime-macos-x64' },
  'win-x64': { tag: 'win_amd64', executable: 'runtime-win-x64.exe' },
}

function workspace(root: string, name: string, manifest: Record<string, unknown>): void {
  const packageName = name.replace('@scope/', '')
  const path = join(root, 'packages/core', packageName, 'package.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ name, ...manifest }, null, 2)}\n`)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('verifyRuntimeClosure', () => {
  it.each(['consumer', 'bundle'])('accepts a required peer declared by the %s on its dependency path', async (owner) => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/bundle': 'workspace:*' } },
      'python/sdk-runtime/platforms.json': platforms,
      'preset:minimal': '[]\n',
    })
    workspace(root, '@scope/bundle', { dependencies: {
      '@scope/consumer': 'workspace:*', ...owner === 'bundle' ? { '@scope/provider': 'workspace:*' } : {},
    } })
    workspace(root, '@scope/consumer', {
      peerDependencies: { '@scope/provider': 'workspace:*' },
      ...owner === 'consumer' ? { dependencies: { '@scope/provider': 'workspace:*' } } : {},
    })
    workspace(root, '@scope/provider', {})
    expect((await verifyRuntimeClosure(root)).failures).toEqual([])
  })

  it('rejects a shared consumer when only another dependency path supplies its peer', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: {
        '@scope/a': 'workspace:*', '@scope/b': 'workspace:*',
      } },
      'python/sdk-runtime/platforms.json': platforms,
      'preset:minimal': '[]\n',
    })
    workspace(root, '@scope/a', { dependencies: { '@scope/shared': 'workspace:*', '@scope/provider': 'workspace:*' } })
    workspace(root, '@scope/b', { dependencies: { '@scope/shared': 'workspace:*' } })
    workspace(root, '@scope/shared', { peerDependencies: { '@scope/provider': 'workspace:*' } })
    workspace(root, '@scope/provider', {})
    expect((await verifyRuntimeClosure(root)).failures).toEqual(['runtime -> @scope/b -> @scope/shared -> @scope/provider'])
  })

  it('does not accept an optional peer provider and terminates cyclic dependency traversal', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/bundle': 'workspace:*' } },
      'python/sdk-runtime/platforms.json': platforms,
      'preset:minimal': '[]\n',
    })
    workspace(root, '@scope/bundle', {
      dependencies: { '@scope/consumer': 'workspace:*' }, optionalDependencies: { '@scope/provider': 'workspace:*' },
    })
    workspace(root, '@scope/consumer', {
      dependencies: { '@scope/bundle': 'workspace:*' }, peerDependencies: { '@scope/provider': 'workspace:*' },
    })
    workspace(root, '@scope/provider', {})
    expect((await verifyRuntimeClosure(root)).failures).toEqual(['runtime -> @scope/bundle -> @scope/consumer -> @scope/provider'])
  })

  it.each(['apps/cli', 'native/system', 'native/system/packages/linux-x64'])(
    'traverses runtime dependencies declared by %s', async (directory) => {
      const manifest = { name: 'runtime', dependencies: { '@scope/application': 'workspace:^' } }
      const root = fixture({
        'python/sdk-runtime/package.json': manifest,
        'python/sdk-runtime/platforms.json': platforms,
        'packages/bundle/web-app/presets/minimal.patch.yml': '[]\n',
        [`${directory}/package.json`]: {
          name: '@scope/application', dependencies: { '@scope/provider': 'workspace:^' },
        },
      })
      workspace(root, '@scope/provider', { peerDependencies: { '@scope/required': 'workspace:^' } })
      workspace(root, '@scope/required', {})
      const missing = await verifyRuntimeClosure(root)
      expect(missing.workspacePackageCount).toBe(2)
      expect(missing.failures).toEqual(['runtime -> @scope/application -> @scope/provider -> @scope/required'])
      writeFileSync(join(root, 'python/sdk-runtime/package.json'), JSON.stringify({
        ...manifest, dependencies: { ...manifest.dependencies, '@scope/required': 'workspace:^' },
      }))
      expect((await verifyRuntimeClosure(root)).failures).toEqual([])
    },
  )
  it('supplies required workspace peers of the Electron production dependency tree', async () => {
    const root = resolve(import.meta.dirname, '..')
    expect((await verifyRuntimeClosure(root, 'apps/desktop/package.json', false)).failures).toEqual([])
  })
  it('checks a private worker closure without requiring application presets', async () => {
    const manifestPath = 'packages/ssh/ssh-helper-runtime/package.json'
    const root = fixture({ [manifestPath]: { name: 'helper', dependencies: { '@scope/worker': 'workspace:^' } } })
    workspace(root, '@scope/worker', { peerDependencies: { '@scope/peer': 'workspace:^' } })
    workspace(root, '@scope/peer', {})
    expect((await verifyRuntimeClosure(root, manifestPath, false)).failures).toEqual(['helper -> @scope/worker -> @scope/peer'])
    writeFileSync(join(root, manifestPath), JSON.stringify({ name: 'helper', dependencies: { '@scope/worker': 'workspace:^', '@scope/peer': 'workspace:^' } }))
    expect(await verifyRuntimeClosure(root, manifestPath, false)).toMatchObject({ failures: [], presetCount: 0 })
  })

  it('requires only plugins active for each published target', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/shared': 'workspace:^' } },
      'python/sdk-runtime/platforms.json': platforms,
      'preset:standard': `
- id: tools
  name: cordis:group
  group: true
  config:
    - id: shared
      name: '@scope/shared'
    - id: linux
      name: '@scope/linux'
      disabled: !!js process.platform !== 'linux'
    - id: macos
      name: '@scope/macos'
      disabled: !!js process.platform !== 'darwin'
    - id: windows
      name: '@scope/windows'
      disabled: !!js process.platform !== 'win32'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.presetCount).toBe(1)
    expect(result.failures).toEqual([
      'standard preset -> @scope/linux (linux-arm64, linux-x64)',
      'standard preset -> @scope/macos (macos-arm64, macos-x64)',
      'standard preset -> @scope/windows (win-x64)',
    ])
  })

  it('treats an unsupported disabled expression as active on every target', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: {} },
      'python/sdk-runtime/platforms.json': platforms,
      'preset:standard': `
- id: conditional
  name: '@scope/conditional'
  disabled: !!js process.env.DSH_DISABLE_CONDITIONAL === '1'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'standard preset -> @scope/conditional (linux-arm64, linux-x64, macos-arm64, macos-x64, win-x64)',
    ])
  })

  it('does not interpret an ordinary plugin array config as nested Loader entries', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/plugin': 'workspace:^' } },
      'python/sdk-runtime/platforms.json': platforms,
      'preset:standard': `
- id: plugin
  name: '@scope/plugin'
  config:
    - name: '@scope/config-value'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([])
  })

  it('requires preset plugins to be linked from the workspace', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/plugin': '1.2.3' } },
      'python/sdk-runtime/platforms.json': platforms,
      'preset:standard': `
- id: plugin
  name: '@scope/plugin'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'standard preset -> @scope/plugin [runtime dependency is "1.2.3"; expected workspace:] (linux-arm64, linux-x64, macos-arm64, macos-x64, win-x64)',
    ])
  })

  it('fails when no shipped preset is discovered', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: {} },
      'python/sdk-runtime/platforms.json': platforms,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.presetCount).toBe(0)
    expect(result.failures).toEqual([
      'no agent presets matched packages/bundle/web-app/presets/*.patch.yml',
    ])
  })

  it('fails when the runtime platform manifest has no targets', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: {} },
      'python/sdk-runtime/platforms.json': {},
      'preset:standard': '[]\n',
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'python/sdk-runtime/platforms.json defines no runtime targets',
    ])
  })

  it('retains the required workspace-peer closure check', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/root': 'workspace:^' } },
      'python/sdk-runtime/platforms.json': platforms,
      'preset:minimal': '[]\n',
    })
    workspace(root, '@scope/root', {
      peerDependencies: { '@scope/required': 'workspace:^', '@scope/optional': 'workspace:^' },
      peerDependenciesMeta: { '@scope/optional': { optional: true } },
    })
    workspace(root, '@scope/required', {})
    workspace(root, '@scope/optional', {})

    const result = await verifyRuntimeClosure(root)

    expect(result.workspacePackageCount).toBe(1)
    expect(result.failures).toEqual(['runtime -> @scope/root -> @scope/required'])
  })
})
