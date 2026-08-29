/**
 * Boot-manifest wire parsing for the version and runtime fields (present,
 * absent, invalid) and the client wrapper's appInfo enrollment from the
 * kernel-parsed manifest.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, createClientModuleSystem } from '../src/client/index.ts'
import type { ClientModuleLoaderTarget } from '../src/client/index.ts'
import { parseBootManifest } from '../src/client/manifest.ts'

const validGraph = {
  rev: 'r',
  entries: [{ id: 'p', url: '/plugins/p/client.js?rev=1', rev: '1' }],
  batches: [{ phase: 'application', url: '/plugins/??p/client.js&rev=1', rev: '1', entries: ['p'] }],
}

describe('parseBootManifest version', () => {
  it('carries a present version through', () => {
    expect(parseBootManifest({ ...validGraph, version: '0.1.0-rc.7' }).version).toBe('0.1.0-rc.7')
  })

  it('is undefined when the document omits it', () => {
    expect(parseBootManifest(validGraph).version).toBeUndefined()
  })

  it('rejects a non-string version', () => {
    expect(() => parseBootManifest({ ...validGraph, version: 7 })).toThrow('boot manifest version must be a string')
  })
})

describe('parseBootManifest runtime', () => {
  const runtime = { node: '22.19.0', chrome: '142.0.7379.128', electron: '39.2.6', os: 'Windows_NT x64 10.0.26200' }

  it('carries a present runtime block through', () => {
    expect(parseBootManifest({ ...validGraph, runtime }).runtime).toEqual(runtime)
  })

  it('leaves chrome/electron undefined under a plain-Node host document', () => {
    const parsed = parseBootManifest({ ...validGraph, runtime: { node: '22.19.0', os: 'Linux x64 6.1' } }).runtime
    expect(parsed).toMatchObject({ node: '22.19.0', os: 'Linux x64 6.1' })
    expect(parsed!.chrome).toBeUndefined()
    expect(parsed!.electron).toBeUndefined()
  })

  it('is undefined when the document omits it', () => {
    expect(parseBootManifest(validGraph).runtime).toBeUndefined()
  })

  it('rejects a non-object runtime', () => {
    expect(() => parseBootManifest({ ...validGraph, runtime: 7 })).toThrow('boot manifest runtime must be an object')
  })

  it('rejects a null runtime', () => {
    expect(() => parseBootManifest({ ...validGraph, runtime: null })).toThrow('boot manifest runtime must be an object')
  })

  it('rejects non-string node/os', () => {
    expect(() => parseBootManifest({ ...validGraph, runtime: { node: 22, os: 'x' } }))
      .toThrow('runtime.node and runtime.os must be strings')
    expect(() => parseBootManifest({ ...validGraph, runtime: { node: '22', os: 1 } }))
      .toThrow('runtime.node and runtime.os must be strings')
  })

  it('rejects non-string chrome/electron', () => {
    expect(() => parseBootManifest({ ...validGraph, runtime: { node: '22', os: 'x', chrome: 142 } }))
      .toThrow('runtime.chrome must be a string')
    expect(() => parseBootManifest({ ...validGraph, runtime: { node: '22', os: 'x', electron: 39 } }))
      .toThrow('runtime.electron must be a string')
  })
})

describe('client wrapper enrollment', () => {
  it('provides appInfo from the kernel-parsed boot document', () => {
    const target: ClientModuleLoaderTarget = {
      mode: 'queue',
      pendingQueue: [],
      load: () => {},
      create: options => createClientModuleSystem(target, {
        id: '@deepseek-ai/dsh-client-modules',
        exports: {},
      }, options),
    }
    target.create({
      boot: {
        ...validGraph,
        version: '0.2.0',
        runtime: { node: '22.19.0', os: 'Windows_NT x64 10.0.26200' },
      },
      staticModules: {},
    })
    const ctx = new Context()
    apply(ctx)
    expect(ctx.appInfo).toEqual({
      version: '0.2.0',
      runtime: { node: '22.19.0', os: 'Windows_NT x64 10.0.26200' },
    })
  })
})
