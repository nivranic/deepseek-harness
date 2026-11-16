import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'scripts/build-exe-for-python-sdk.ts')

describe('Python runtime executable assets', () => {
  it('packages the dynamically resolved web frontend distribution', () => {
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx/esm',
      script,
      '--skip-build',
      '--dry-run',
      '--targets=node24-macos-arm64',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_execpath: 'C:\\tools\\pnpm.cjs' },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('node_modules/@deepseek-ai/dsh-web-frontend/dist/**/*')
    expect(result.stdout).toContain('node_modules/@deepseek-ai/dsh-*/**/*.{svg,png,jpg,jpeg,webp}')
    expect(result.stdout).not.toContain('skill-badge/assets/**/*')
    expect(result.stdout).toContain('node_modules/@deepseek-ai/dsh-sandbox-windows-acl/assets/**/*')
    expect(result.stdout).not.toContain('node_modules/**/*.py')
    // skill-office reads its SKILL.md files from the package's assets directory.
    expect(result.stdout).toContain('"node_modules/**/*.md"')

    const configLine = result.stdout.split('\n').find(line => line.includes('[dry-run] patch ') && line.includes(' with '))
    expect(configLine).toBeDefined()
    const config = JSON.parse(String(configLine).split(' with ').slice(1).join(' with ')) as { pkg: { ignore: string[] } }
    // Use the packager's matcher so its handling of hidden checkout directories is covered.
    const pkgRequire = createRequire(import.meta.resolve('@yao-pkg/pkg'))
    const { isMatch } = pkgRequire('picomatch') as {
      isMatch: (file: string, patterns: string[], options: { windows: boolean }) => boolean
    }
    const hiddenRoot = join(root, '.checkout').replaceAll('\\', '/')
    const ignores = config.pkg.ignore.map(pattern => pattern.replace(root.replaceAll('\\', '/'), hiddenRoot))
    const staging = `${hiddenRoot}/python/sdk-runtime/src/deepseek_harness_runtime/runtime/node`
    for (const file of [
      'node_modules/@deepseek-ai/libreoffice-kit-wasm/assets/dsoffice.wasm',
      'node_modules/@deepseek-ai/libreoffice-kit/dist/worker.js',
      'node_modules/@deepseek-ai/dsh-client-ui-settings-account/src/client/assets/welcome.webp',
      'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index.js.map',
    ]) {
      expect(isMatch(`${staging}/${file}`, ignores, { windows: process.platform === 'win32' }), file).toBe(true)
    }
    expect(isMatch(`${staging}/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index.js`, ignores,
      { windows: process.platform === 'win32' })).toBe(false)
  })
})
