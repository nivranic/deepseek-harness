/**
 * Boot-manifest wire parsing for the version field (present, absent, invalid)
 * and the client wrapper's appInfo enrollment from the parsed document.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { DshWindow } from '../src/client/manifest.ts'
import { parseBootManifest } from '../src/client/manifest.ts'

const validGraph = { rev: 'r', entries: [{ id: 'p', url: '/plugins/p/client.js?rev=1', rev: '1' }] }

afterEach(() => {
  delete (globalThis as DshWindow).__DSH_BOOT__
  delete (globalThis as DshWindow).__DSH_MODULES__
})

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

describe('client wrapper enrollment', () => {
  it('provides appInfo from the parsed boot document', () => {
    (globalThis as DshWindow).__DSH_MODULES__ = {} as never
    ;(globalThis as DshWindow).__DSH_BOOT__ = { ...validGraph, version: '0.2.0' }
    const ctx = new Context()
    apply(ctx)
    expect(ctx.appInfo).toEqual({ version: '0.2.0' })
  })

  it('is loud when the kernel slot is missing', () => {
    (globalThis as DshWindow).__DSH_BOOT__ = validGraph
    expect(() => { apply(new Context()) }).toThrow('__DSH_MODULES__ missing')
  })
})
