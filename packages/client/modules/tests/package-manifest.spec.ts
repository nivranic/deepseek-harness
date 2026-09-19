import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { locateModulePackage } from '../src/package-manifest.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-module-manifest-'))
  roots.push(root)
  const name = '@fixture/resources'
  const original = join(root, 'original', 'package.json')
  const entry = join(dirname(original), 'lib', 'host.js')
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(original, JSON.stringify({ name }))
  writeFileSync(entry, 'export const original = true\n')
  function proxy(directory: string, target: string, extra: Record<string, unknown> = {}) {
    const manifest = join(root, directory, 'package.json')
    const proxyEntry = join(dirname(manifest), 'entry.js')
    mkdirSync(dirname(manifest), { recursive: true })
    writeFileSync(manifest, JSON.stringify({
      name, exports: { '.': './entry.js' }, dsh: { moduleFallback: { targets: { '.': target } } }, ...extra,
    }))
    writeFileSync(proxyEntry, 'export {}\n')
    return pathToFileURL(proxyEntry).href
  }
  return { root, name, original, entry, proxy }
}

it('finds the resource owner through multiple proxies without copying metadata', () => {
  const f = fixture()
  const inner = f.proxy('inner', pathToFileURL(f.entry).href)
  const outer = f.proxy('outer', inner)
  expect(locateModulePackage(outer, f.name)).toEqual({ path: f.original, packageName: f.name })
})

it.each(['broken', 'null', '{"name":12}', '{"name":"unrelated"}'])(
  'skips an intermediate manifest that cannot own the requested module: %s', (text) => {
    const f = fixture()
    writeFileSync(join(dirname(f.entry), 'package.json'), text)
    expect(locateModulePackage(pathToFileURL(f.entry).href, f.name)).toEqual({ path: f.original, packageName: f.name })
  },
)

it.each([undefined, null, 'metadata', { unrelated: true }])('accepts an ordinary package without proxy metadata: %j', (dsh) => {
  const f = fixture()
  writeFileSync(f.original, JSON.stringify({ name: f.name, dsh }))
  expect(locateModulePackage(pathToFileURL(f.entry).href)).toEqual({ path: f.original, packageName: f.name })
})

it('ignores non-file modules and modules without a matching package owner', () => {
  const f = fixture()
  expect(locateModulePackage('node:fs')).toBeUndefined()
  expect(locateModulePackage(pathToFileURL(f.entry).href, '@fixture/missing')).toBeUndefined()
})

it.each([null, {}, { targets: [] }, { targets: null }])('rejects malformed managed target maps: %j', (moduleFallback) => {
  const f = fixture()
  const proxy = f.proxy('proxy', pathToFileURL(f.entry).href, { dsh: { moduleFallback } })
  expect(() => locateModulePackage(proxy)).toThrow('export and target maps')
})

it.each([null, [], './entry.js'])('rejects managed exports without an explicit map: %j', (exports) => {
  const f = fixture()
  const proxy = f.proxy('proxy', pathToFileURL(f.entry).href, { exports })
  expect(() => locateModulePackage(proxy)).toThrow('export and target maps')
})

it.each(['https://example.test/host.js', ''])('rejects a non-file proxy target: %s', (target) => {
  const f = fixture()
  const proxy = f.proxy('proxy', target)
  expect(() => locateModulePackage(proxy)).toThrow('no file target')
})

it.each([
  { '.': './other.js' },
  { '.': './entry.js', './also': './entry.js' },
  { '.': { default: './entry.js' } },
])('requires one matching managed export: %j', (exports) => {
  const f = fixture()
  const proxy = f.proxy('proxy', pathToFileURL(f.entry).href, { exports })
  expect(() => locateModulePackage(proxy)).toThrow('no file target')
})

it('rejects missing target owners and cycles instead of omitting the client package', () => {
  const f = fixture()
  const missing = f.proxy('missing', pathToFileURL(join(f.root, 'unowned', 'host.js')).href)
  expect(() => locateModulePackage(missing)).toThrow('target has no owning package')
  const a = f.proxy('a', pathToFileURL(join(f.root, 'b', 'entry.js')).href)
  f.proxy('b', a)
  expect(() => locateModulePackage(a)).toThrow('fallback cycle')
})
