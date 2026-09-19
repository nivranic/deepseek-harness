/**
 * The verify-cordis-config metadata contract: `disabled` is the one entry
 * metadata field whose `!!js` expression the Loader interpolates; every other
 * metadata field must stay static, and a disabled expression must parse.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundleManifestPaths,
  bundlePluginDependencyErrors,
  metadataExpressionErrors,
  packageTestFixtureDependencyErrors,
  packageTestPluginDependencyErrors,
  validateShippedProfileCompositions,
} from './verify-cordis-config.ts'

describe('verify-cordis-config metadata expressions', () => {
  it('accepts a disabled !!js expression', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: { __jsExpr: "process.platform === 'win32'" } },
      '[0]',
    )
    expect(problems).toEqual([])
  })

  it('rejects an expression in a static metadata field', () => {
    const problems = metadataExpressionErrors({ id: { __jsExpr: 'process.platform' }, name: 'pkg' }, '[0]')
    expect(problems).toContain('[0].id: !!js is not interpolated here')
  })

  it('rejects an expression nested below disabled (only the field itself interpolates)', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: 'pkg', disabled: { when: { __jsExpr: 'process.platform' } } },
      '[0]',
    )
    expect(problems).toContain('[0].disabled.when: !!js is not interpolated here')
  })

  it('rejects a disabled expression that does not parse (the loader would fail the boot)', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: 'pkg', disabled: { __jsExpr: 'process.platform ===' } },
      '[0]',
    )
    expect(problems.some(problem => problem.includes('[0].disabled: disabled expression does not parse'))).toBe(true)
  })
})

describe('shipped profile composition ids', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'dsh-profile-compositions-'))
    roots.push(root)
    const write = (path: string, content: string): void => {
      const segments = path.split('/')
      mkdirSync(join(root, ...segments.slice(0, -1)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    const bundle = (name: string, patch: string): void => {
      write(`packages/example/${name}/package.json`, JSON.stringify({
        name, dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
      write(`packages/example/${name}/cordis.patch.yml`, patch)
    }
    bundle('base', '- insert:\n    - id: shared\n      name: service\n')
    bundle('mode', '- id: shared\n  config: { enabled: true }\n')
    bundle('standalone', '- insert:\n    - id: shared\n      name: standalone-service\n')
    write('packages/boot/app-boot/src/profile.ts', `
      export const PROFILE_TEMPLATES = {
        web: { bundles: ['base', 'mode'], patchReload: 'live' },
        'sdk-minimal': { bundles: ['standalone'], patchReload: 'startup' },
      } as const
    `)
    write('apps/desktop/src/project-manager.ts', "const DESKTOP_PROFILE_BUNDLES = ['base', 'mode'] as const")
    write('apps/desktop-host/config/desktop.cordis.patch.yml', '- id: shared\n  disabled: true\n')
    return { root, write, bundle }
  }

  it('allows id restatements and a standalone profile reusing an id from another composition', () => {
    const { root } = fixture()
    expect(validateShippedProfileCompositions(root)).toEqual([])
  })

  it.each([
    '- insert:\n    - id: shared\n      name: other\n',
    '- insert:\n    - id: shared\n      name: other\n      disabled: true\n',
    '- insert:\n    - id: nested\n      group: true\n      config:\n        - id: shared\n          name: other\n',
    "- insert:\n    - id: nested\n      name: '@deepseek-ai/cordis-plugin-group'\n      config:\n        - id: shared\n          name: other\n",
  ])('rejects repeated tree ids after applying bundle layers: %s', (patch) => {
    const { root, bundle } = fixture()
    bundle('mode', patch)
    expect(validateShippedProfileCompositions(root)).toEqual([
      'profile web: duplicate loader entry id "shared"',
      'Desktop profile: duplicate loader entry id "shared"',
    ])
  })

  it('detects repetition within one insert list', () => {
    const { root, bundle } = fixture()
    bundle('mode', '- insert:\n    - { id: repeated, name: first }\n    - { id: repeated, name: second }\n')
    expect(validateShippedProfileCompositions(root)).toContain('profile web: duplicate loader entry id "repeated"')
  })

  it('includes the private Desktop patch after its actual core bundles', () => {
    const { root, write } = fixture()
    write('apps/desktop/src/project-manager.ts', "const DESKTOP_PROFILE_BUNDLES = ['standalone'] as const")
    write('apps/desktop-host/config/desktop.cordis.patch.yml', '- insert:\n    - { id: shared, name: desktop-service }\n')
    expect(validateShippedProfileCompositions(root)).toEqual(['Desktop profile: duplicate loader entry id "shared"'])
  })

  it('does not inspect ordinary config arrays as groups or execute plugin expressions', () => {
    const { root, bundle } = fixture()
    bundle('mode', [
      '- insert:',
      '    - id: consumer',
      '      name: consumer',
      '      config: [{ id: shared }, { id: shared }]',
      '    - id: dynamic',
      '      name: dynamic',
      '      config: !!js (() => { throw new Error("must stay data") })()',
    ].join('\n'))
    expect(validateShippedProfileCompositions(root)).toEqual([])
  })

  it('discovers another declared profile and preserves literal type wrappers', () => {
    const { root, write, bundle } = fixture()
    bundle('mode', '- insert:\n    - { id: shared, name: other }\n')
    write('packages/boot/app-boot/src/profile.ts', `
      export const PROFILE_TEMPLATES = ({ auxiliary: { bundles: (['base', 'mode'] as const) } }) satisfies Record<string, unknown>
    `)
    expect(validateShippedProfileCompositions(root)).toContain('profile auxiliary: duplicate loader entry id "shared"')
  })

  it.each([
    ['export const OTHER = {}', /expected one initialized PROFILE_TEMPLATES/],
    ['export const PROFILE_TEMPLATES = {}', /profile roster is empty/],
    ['export const PROFILE_TEMPLATES = createTemplates()', /expected a literal object/],
    ['export const PROFILE_TEMPLATES = { ...other }', /without spreads or computed keys/],
    ['export const PROFILE_TEMPLATES = { web: { bundles: [] } }', /nonempty literal bundle list/],
    ['export const PROFILE_TEMPLATES = { web: { bundles: [name] } }', /nonempty string literals/],
    ['export const PROFILE_TEMPLATES = { web: {}, web: {} }', /duplicate property/],
  ])('refuses an unreadable or empty source roster: %s', (source, error) => {
    const { root, write } = fixture()
    write('packages/boot/app-boot/src/profile.ts', source)
    expect(() => validateShippedProfileCompositions(root)).toThrow(error)
  })

  it('reports a missing bundle declaration instead of dropping that profile', () => {
    const { root, write } = fixture()
    write('packages/boot/app-boot/src/profile.ts', "export const PROFILE_TEMPLATES = { extra: { bundles: ['missing'] } }")
    expect(validateShippedProfileCompositions(root)).toEqual([
      'profile extra: bundle "missing" has no workspace patch declaration',
    ])
  })

  it('reports malformed patch input instead of accepting an empty composition', () => {
    const { root, write } = fixture()
    write('apps/desktop-host/config/desktop.cordis.patch.yml', 'not-a-patch-list')
    expect(validateShippedProfileCompositions(root)).toEqual([
      expect.stringMatching(/Desktop profile: .*must be a top-level YAML array/),
    ])
  })

  it('checks the final group config after later patches replace earlier inserts', () => {
    const { root, bundle } = fixture()
    bundle('mode', [
      '- insert:',
      '    - id: group',
      '      group: true',
      '      config: [{ id: shared, name: initially-repeated }]',
      '- id: group',
      '  config: [{ id: distinct, name: final-service }]',
    ].join('\n'))
    expect(validateShippedProfileCompositions(root)).toEqual([])
  })

  function presetFixture() {
    const value = fixture()
    value.bundle('mode', [
      '- id: shared',
      '  disabled: true',
      '- insert:',
      '    - id: presets',
      "      name: '@deepseek-ai/dsh-agent-presets'",
    ].join('\n'))
    value.write('packages/preset/agent-presets/presets/standard/agent.cordis.yml', '- id: shared\n  name: session-service\n')
    return value
  }

  it('allows the preset to own a row disabled by the composed Host layers', () => {
    expect(validateShippedProfileCompositions(presetFixture().root)).toEqual([])
  })

  it('rejects a preset row re-enabled only by the final Desktop layer', () => {
    const { root, write } = presetFixture()
    write('apps/desktop-host/config/desktop.cordis.patch.yml', '- id: shared\n  disabled: false\n')
    expect(validateShippedProfileCompositions(root)).toEqual([
      'Desktop profile: packages/preset/agent-presets/presets/standard/agent.cordis.yml: '
      + 'row "shared" is also active in the host composition; a row belongs to exactly one plane',
    ])
  })

  it('does not count children of disabled Host or preset groups as active', () => {
    const { root, write, bundle } = presetFixture()
    bundle('base', '- insert:\n    - id: services\n      group: true\n      disabled: true\n      config: [{ id: shared, name: host-service }]\n')
    bundle('mode', "- insert:\n    - id: presets\n      name: '@deepseek-ai/dsh-agent-presets'\n")
    write('apps/desktop-host/config/desktop.cordis.patch.yml', '[]\n')
    expect(validateShippedProfileCompositions(root)).toEqual([])
    write('apps/desktop-host/config/desktop.cordis.patch.yml', '- id: services\n  disabled: false\n')
    write('packages/preset/agent-presets/presets/standard/agent.cordis.yml',
      '- id: session-services\n  group: true\n  disabled: true\n  config: [{ id: shared, name: session-service }]\n')
    expect(validateShippedProfileCompositions(root)).toEqual([])
  })

  it('treats expression-controlled rows as potentially active', () => {
    const { root, write } = presetFixture()
    write('apps/desktop-host/config/desktop.cordis.patch.yml', '- id: shared\n  disabled: !!js process.platform === "darwin"\n')
    expect(validateShippedProfileCompositions(root)).toEqual([
      expect.stringMatching(/Desktop profile: .*row "shared" is also active/),
    ])
  })

  it('refuses an empty preset corpus when the Host mounts its provider', () => {
    const { root, write } = presetFixture()
    write('apps/desktop-host/config/desktop.cordis.patch.yml', '[]\n')
    rmSync(join(root, 'packages/preset/agent-presets/presets/standard/agent.cordis.yml'))
    expect(validateShippedProfileCompositions(root)).toEqual([
      'profile web: shipped preset roster is empty',
      'Desktop profile: shipped preset roster is empty',
    ])
  })

  it('reports malformed preset data', () => {
    const { root, write } = presetFixture()
    write('packages/preset/agent-presets/presets/standard/agent.cordis.yml', '{ not: an-entry-list }')
    expect(validateShippedProfileCompositions(root)).toEqual([
      expect.stringMatching(/profile web: .*preset must be a Loader entry array/),
      expect.stringMatching(/Desktop profile: .*preset must be a Loader entry array/),
    ])
  })
})

describe('workspace Bundle discovery and product dependency closures', () => {
  it('discovers a Bundle outside packages/bundle from its manifest declaration', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-bundle-discovery-'))
    try {
      const bundleDir = join(fixture, 'packages/subagent/example')
      const plainDir = join(fixture, 'packages/bundle/plain')
      mkdirSync(bundleDir, { recursive: true })
      mkdirSync(plainDir, { recursive: true })
      writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
        name: '@deepseek-ai/dsh-subagent-example',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
      writeFileSync(join(plainDir, 'package.json'), JSON.stringify({
        name: '@deepseek-ai/dsh-plain',
      }))

      expect(bundleManifestPaths(fixture)).toEqual([
        'packages/subagent/example/package.json',
      ])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('allows a Bundle to mount itself but rejects an undeclared plugin package', () => {
    const manifestPath = 'packages/subagent/example/package.json'
    const file = 'packages/subagent/example/cordis.patch.yml'
    const manifest = {
      name: '@deepseek-ai/dsh-subagent-example',
      dependencies: {},
    }
    const self = { file, name: '@deepseek-ai/dsh-subagent-example' }
    expect(bundlePluginDependencyErrors(manifestPath, manifest, [self])).toEqual([])
    expect(bundlePluginDependencyErrors(manifestPath, manifest, [
      self,
      { file, name: '@deepseek-ai/dsh-missing-plugin' },
    ])).toEqual([
      `${file}: @deepseek-ai/dsh-missing-plugin must be declared in ${manifestPath} dependencies`,
    ])
  })
})

describe('package-owned Loader test dependency closures', () => {
  it('requires package test configs to declare each named plugin they load', () => {
    const manifestPath = 'packages/example/owner/package.json'
    const file = 'packages/example/owner/tests/fixtures/cordis.yml'
    const manifest = {
      name: '@deepseek-ai/dsh-owner',
      dependencies: {},
      devDependencies: {
        '@deepseek-ai/dsh-declared': 'workspace:^',
      },
    }
    expect(packageTestPluginDependencyErrors(manifestPath, manifest, [
      { file, name: '@deepseek-ai/dsh-owner' },
      { file, name: '@deepseek-ai/dsh-declared' },
      { file, name: '@deepseek-ai/dsh-missing' },
    ])).toEqual([
      `${file}: @deepseek-ai/dsh-missing must be declared in ${manifestPath} dependencies or devDependencies`,
    ])
  })

  it('requires executable package test fixtures to declare their bare imports', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-package-test-entrypoint-'))
    try {
      const packageDir = join(fixture, 'packages/example/owner')
      const driverDir = join(packageDir, 'tests/fixtures/loader')
      mkdirSync(driverDir, { recursive: true })
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
        name: '@deepseek-ai/dsh-owner',
        devDependencies: {
          '@deepseek-ai/dsh-declared': 'workspace:^',
        },
      }))
      writeFileSync(join(driverDir, 'driver.ts'), [
        "import '@deepseek-ai/dsh-owner'",
        "import '@deepseek-ai/dsh-declared'",
        "import '@deepseek-ai/dsh-missing'",
      ].join('\n'))
      writeFileSync(join(driverDir, 'cordis.yml'), '[]\n')
      writeFileSync(join(driverDir, 'fixture.mjs'), "import '@deepseek-ai/dsh-declared'\n")
      const unrelatedDir = join(packageDir, 'tests/fixtures/unrelated')
      mkdirSync(unrelatedDir, { recursive: true })
      writeFileSync(join(unrelatedDir, 'driver.ts'), "import '@deepseek-ai/dsh-unrelated'\n")

      expect(packageTestFixtureDependencyErrors(fixture)).toEqual([
        'packages/example/owner/tests/fixtures/loader/driver.ts: '
        + '@deepseek-ai/dsh-missing must be declared in '
        + 'packages/example/owner/package.json dependencies or devDependencies',
      ])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('fails loud when package-owned Loader fixtures disappear from the scan', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-empty-package-test-entrypoint-'))
    try {
      expect(packageTestFixtureDependencyErrors(fixture)).toEqual([
        'package test fixture dependency scan found no package-owned Loader configs',
      ])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
