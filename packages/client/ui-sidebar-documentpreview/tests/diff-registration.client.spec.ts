/** Diff metadata, keyed slot, dictionary, and disposal registration. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentPreviewRegistry } from '../src/client/document/registry.ts'
import { DiffBody } from '../src/client/diff/DiffBody.tsx'
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
    const register = vi.fn((options: { key: string }, body: unknown) => {
      bodies.set(options.key, body)
      return () => { bodies.delete(options.key) }
    })
    ctx.provide('documentPreviews', registry)
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
    expect(register).toHaveBeenCalledExactlyOnceWith(
      { name: 'sidebar.right.tab.document', key: DIFF_BODY_ID, locale: 'sidebarDiffPreview' },
      DiffBody,
    )
    await dispose()
    expect(registry.getSnapshot()).toEqual([])
    expect(bodies.size).toBe(0)
    expect(dictionaries.size).toBe(0)
  })
})
