/** Exercise real Windows pnpm shims with literal argv, without installing a package. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runPlugin } from '../src/plugin.ts'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it.skipIf(process.platform !== 'win32').each(['global bin', 'node_modules/.bin'])(
  'preserves literal arguments through the %s Windows shim', (location) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-windows-'))
    roots.push(root)
    const shim = join(root, location)
    mkdirSync(shim, { recursive: true })
    const receiver = join(root, 'receive.mjs')
    const receipt = join(root, 'argv.json')
    writeFileSync(receiver, "import fs from 'node:fs';fs.writeFileSync(process.env.DSH_PLUGIN_ARGV_RECEIPT,JSON.stringify(process.argv.slice(2)));\n")
    writeFileSync(join(shim, 'pnpm.cmd'), `@echo off\n"${process.execPath}" "${receiver}" %*\n`)
    const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
    vi.stubEnv(pathKey, `${shim};${process.env[pathKey] ?? ''}`)
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_PLUGIN_ARGV_RECEIPT', receipt)
    vi.stubEnv('DSH_PLUGIN_LITERAL', 'unexpected expansion')
    const path = 'file:./plugin with spaces'
    const literals = ['中文 & punctuation', 'embedded"quote', '', 'C:\\trailing\\',
      '%DSH_PLUGIN_LITERAL%', '!DSH_PLUGIN_LITERAL!', 'literal&echo unexpected>argument-marker.txt']

    expect(runPlugin('sdk', ['add', path, ...literals])).toBe(0)

    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual([
      '--config.ignore-workspace-root-check=true', 'add', `file:${resolve('./plugin with spaces')}`, ...literals,
    ])
    expect(existsSync(join(root, 'profiles/sdk/argument-marker.txt'))).toBe(false)
  },
)
