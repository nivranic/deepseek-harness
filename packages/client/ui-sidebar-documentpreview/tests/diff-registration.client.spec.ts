/** Diff metadata, keyed slot, dictionary, and disposal registration. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentPreviewRegistry } from '../src/client/contract/registry.ts'
import { DiffBody, type DiffBodyInjected } from '../src/client/diff/DiffBody.tsx'
import { apply, DIFF_BODY_ID, DIFF_EXTENSIONS, diffBodyDefinition } from '../src/client/diff/index.ts'
import { en, zh } from '../src/client/diff/locales.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(async () => { await dispose?.(); dispose = undefined })

describe('diff registration', () => {
  it('claims .diff and .patch as a builtin text-page renderer without wrap', () => {
    const title = vi.fn(() => 'localized diff')
    const definition = diffBodyDefinition(title)
    expect(definition).toEqual({
      id: DIFF_BODY_ID,
      extensions: DIFF_EXTENSIONS,
      priority: 'builtin',
      title,
      loading: 'text-pages',
    })
    expect(title).not.toHaveBeenCalled()
    expect(definition.title()).toBe('localized diff')
  })

  it('registers its dictionary and matching keyed body, then removes every contribution', async () => {
    const ctx = new Context()
    const registry = new DocumentPreviewRegistry()
    const dictionaries = new Map<string, unknown>()
    const bodies = new Map<string, unknown>()
    const register = vi.fn((options: { key: string; inject: () => DiffBodyInjected }, body: unknown) => {
      bodies.set(options.key, body)
      return () => { bodies.delete(options.key) }
    })
    ctx.provide('documentPreviews', registry)
    const remote = { $host: {} }
    ctx.provide('remote', remote)
    const candidates = vi.fn(() => [{}])
    ctx.provide('sidebarRightTabs', { entries: () => [], subscribe: () => () => {}, candidates })
    ctx.provide('slots', { inject: (_key: string, callback: () => () => void) => callback(), register } as never)
    ctx.provide('locale', {
      bind: () => (key: keyof typeof en) => en[key],
      register: (name: string, value: unknown) => {
        dictionaries.set(name, value)
        return () => { dictionaries.delete(name) }
      },
    } as never)
    const fiber = ctx.plugin({ apply })
    dispose = async () => { await fiber.dispose() }
    await fiber.await()
    for (const extension of DIFF_EXTENSIONS) {
      expect(registry.candidates(`changes.${extension}`).map(entry => entry.id)).toEqual([DIFF_BODY_ID])
    }
    expect(registry.getSnapshot()[0]?.title()).toBe(en.title)
    expect(dictionaries.get('sidebarDiffPreview')).toEqual({ zh, en })
    expect(register).toHaveBeenCalledOnce()
    const [registration, component] = register.mock.calls[0]!
    const { inject: injectFace, ...metadata } = registration
    expect(metadata).toEqual({ name: 'sidebar.right.tab.document', key: DIFF_BODY_ID, locale: 'sidebarDiffPreview' })
    expect(component).toBe(DiffBody)
    const face = injectFace()
    expect(face.hooks.grammars.getSnapshot()).toBeGreaterThanOrEqual(0)
    expect(face.canOpenFile('file')).toBe(true)
    const capturedHost = remote.$host
    remote.$host = {}
    expect(face.canOpenFile('file')).toBe(false)
    remote.$host = capturedHost
    await dispose()
    expect(face.canOpenFile('file')).toBe(false)
    expect(registry.getSnapshot()).toEqual([])
    expect(bodies.size).toBe(0)
    expect(dictionaries.size).toBe(0)
  })
})
