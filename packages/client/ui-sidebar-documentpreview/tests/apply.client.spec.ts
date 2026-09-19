/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The registry is real, because "registered" means what it says a type is; the
 * slot, locale, and Remote faces are recorders, because what matters here is
 * what was handed to them — one body seat under the type's kind with its store
 * and face — and that every registration is gone after dispose, which is what
 * makes a reload safe.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { TEXTPREVIEW_ID, TEXTPREVIEW_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { TextPreview } from '../src/client/TextPreview.tsx'
import { TextTitle } from '../src/client/TextTitle.tsx'
import { TextBody } from '../src/client/text/TextBody.tsx'
import { PLAIN_BODY_ID } from '../src/client/text/index.ts'
import { MarkdownBody } from '../src/client/markdown/MarkdownBody.tsx'
import { MARKDOWN_BODY_ID } from '../src/client/markdown/index.ts'
import { HtmlBody } from '../src/client/html/HtmlBody.tsx'
import { HTML_BODY_ID } from '../src/client/html/index.ts'
import { ImageBody } from '../src/client/image/ImageBody.tsx'
import { IMAGE_BODY_ID } from '../src/client/image/index.ts'
import { PdfBody } from '../src/client/pdf/PdfBody.tsx'
import { PDF_BODY_ID } from '../src/client/pdf/index.ts'
import { CodeBody } from '../src/client/code/CodeBody.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { textFace } from '../src/client/face.ts'
import type { TextStore } from '../src/client/store.ts'
import { FILE, SESSION, TAB_ID, page } from './fixtures.client.ts'
import type { TextPreviewInjected } from '../src/client/TextPreview.tsx'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

interface Recorded {
  name: string
  key: string
  locale?: string
  store?: unknown
  inject?: unknown
  component: unknown
}

async function boot(capabilities = ['workspace-files.stat.v1', 'workspace-files.read-text.v1', 'workspace-files.read-all.v1', 'workspace-files.read-related.v1']) {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    bind: () => (key: string) => key,
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const workspaceFiles = {
    read: vi.fn().mockResolvedValue(page(1, ['first'], true)),
    readAll: vi.fn().mockResolvedValue({
      ok: true, value: { absolutePath: '/workspace/notes.md', version: 'v1', offset: 0, data: 'AAH/', eof: true },
    }),
  }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  const remote = { workspaceFiles, $host: { capabilities, home: undefined, isLoopback: false } }
  ctx.provide('remote', remote as never)
  ctx.provide('remote.workspaceFiles', workspaceFiles as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  onTestFinished(async () => { await fiber.dispose() })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, workspaceFiles, ctx, remote }
}

describe('ui-sidebar-documentpreview apply', () => {
  it.each([
    [[], [], []],
    [['workspace-files.read-text.v1'], [], []],
    [['workspace-files.stat.v1'], [], []],
    [['workspace-files.stat.v1', 'workspace-files.read-text.v1'], ['unknown', 'png', 'html', 'md'], [PLAIN_BODY_ID, MARKDOWN_BODY_ID, '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code']],
    [['workspace-files.stat.v1', 'workspace-files.read-all.v1'], ['png'], [IMAGE_BODY_ID, PDF_BODY_ID]],
    [['workspace-files.stat.v1', 'workspace-files.read-all.v1', 'workspace-files.read-related.v1'], ['png', 'html'], [HTML_BODY_ID, IMAGE_BODY_ID, PDF_BODY_ID]],
  ])('admits file types and renderer choices for %j', async (capabilities, suffixes, ids) => {
    const h = await boot(capabilities)
    for (const suffix of ['unknown', 'png', 'html', 'md']) {
      expect(h.tabs.candidates(sessionFileAddress(SESSION, 'file.' + suffix)).length > 0).toBe(suffixes.includes(suffix))
    }
    const registration = h.registered.find(entry => entry.component === TextPreview)
    if (ids.length === 0) {
      expect(registration).toBeUndefined()
      return
    }
    if (registration === undefined) throw new Error('missing preview registration')
    const store = (registration.store as TextStore).create()
    const face = (registration.inject as (id: typeof SESSION, actions: typeof store.actions) => TextPreviewInjected)(SESSION, store.actions)
    expect(face.hooks.documentPreviews.getSnapshot().map(item => item.id)).toEqual(ids)
  })

  it('aborts pending content and refuses retained readers when the admitted Host changes', async () => {
    const h = await boot()
    const registration = h.registered.find(entry => entry.component === TextPreview)!
    const store = (registration.store as TextStore).create()
    const face = (registration.inject as ReturnType<typeof textFace>)(SESSION, store.actions)
    const pending = Promise.withResolvers<ReturnType<typeof page>>()
    h.workspaceFiles.read.mockReturnValueOnce(pending.promise)
    face.loadPage(TAB_ID, FILE, 1, new AbortController().signal)
    const signal = h.workspaceFiles.read.mock.calls[0]![3] as AbortSignal
    h.remote.$host = { ...h.remote.$host, capabilities: [] }
    h.ctx.emit('connection/reset')
    expect(signal.aborted).toBe(true)
    expect(h.tabs.get(TEXTPREVIEW_KIND)).toBeUndefined()
    pending.resolve(page(1, ['late content'], true))
    await pending.promise
    expect(store.getSnapshot().byTab[TAB_ID]).toBeUndefined()
    face.loadPage(TAB_ID, FILE, 1, new AbortController().signal)
    face.loadAll(TAB_ID, FILE, new AbortController().signal)
    expect(h.workspaceFiles.read).toHaveBeenCalledOnce()
    expect(h.workspaceFiles.readAll).not.toHaveBeenCalled()
    h.remote.$host = { ...h.remote.$host, capabilities: ['workspace-files.stat.v1', 'workspace-files.read-text.v1'] }
    h.ctx.emit('connection/reset')
    expect(h.tabs.get(TEXTPREVIEW_KIND)).toBeDefined()
    expect(h.registered.find(entry => entry.component === TextPreview)?.store).not.toBe(registration.store)
  })

  it('notifies file entry consumers when a renderer adds or removes an admitted suffix', async () => {
    const h = await boot(['workspace-files.stat.v1', 'workspace-files.read-all.v1'])
    const address = sessionFileAddress(SESSION, 'custom.bin')
    expect(h.tabs.candidates(address)).toEqual([])
    const changed = vi.fn()
    const stop = h.tabs.subscribe(changed)
    const release = h.ctx.documentPreviews.register({
      id: 'custom-binary', extensions: ['bin'], loading: 'bytes-complete', title: () => 'custom',
    })
    expect(changed).toHaveBeenCalledOnce()
    expect(h.tabs.candidates(address).map(item => item.kind)).toEqual(['text'])
    release()
    expect(changed).toHaveBeenCalledTimes(2)
    expect(h.tabs.candidates(address)).toEqual([])
    stop()
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body and title seats under the type\'s id, the body with a store and a face', async () => {
    const { tabs, registered, dictionaries } = await boot()
    expect(tabs.get(TEXTPREVIEW_KIND)?.priority).toBe('fallback')
    expect(tabs.get(TEXTPREVIEW_KIND)?.id).toBe(TEXTPREVIEW_ID)
    expect(dictionaries.get('sidebarDocumentPreview')).toEqual({ zh, en })
    // The seat key is the implementation's id, not the kind: an extension may
    // take the kind over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', TEXTPREVIEW_ID, 'sidebarDocumentPreview', TextPreview],
      ['sidebar.right.pane.tab.title', TEXTPREVIEW_ID, undefined, TextTitle],
      ['sidebar.right.tab.document', PLAIN_BODY_ID, undefined, TextBody],
      ['sidebar.right.tab.document', MARKDOWN_BODY_ID, 'documentMarkdown', MarkdownBody],
      ['sidebar.right.tab.document', HTML_BODY_ID, 'documentHtml', HtmlBody],
      ['sidebar.right.tab.document', IMAGE_BODY_ID, 'sidebarImage', ImageBody],
      ['sidebar.right.tab.document', PDF_BODY_ID, 'sidebarPdf', PdfBody],
      ['sidebar.right.tab.document', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code', 'sidebarCodePreview', CodeBody],
    ])
    expect(registered[0]?.store).toBeDefined()
    expect(typeof registered[0]?.inject).toBe('function')
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(TEXTPREVIEW_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })

  it('injects ordinary Remote reads without requiring a Resource service', async () => {
    const { registered, workspaceFiles } = await boot()
    const registration = registered.find(entry => entry.component === TextPreview)
    if (registration === undefined) throw new Error('missing preview registration')
    const instance = (registration.store as TextStore).create()
    const face = (registration.inject as ReturnType<typeof textFace>)(SESSION, instance.actions)
    const controller = new AbortController()
    onTestFinished(() => { controller.abort() })
    face.loadPage(TAB_ID, FILE, 1, controller.signal, 'v1')
    await workspaceFiles.read.mock.results[0]?.value
    expect(workspaceFiles.read).toHaveBeenCalledExactlyOnceWith(FILE.sessionId, FILE.path, { offset: 1 }, expect.any(AbortSignal))
    expect(instance.getSnapshot().byTab[TAB_ID]?.pages[1]?.text).toBe('first')
    face.loadAll(TAB_ID, FILE, controller.signal, 'v1')
    await workspaceFiles.readAll.mock.results[0]?.value
    expect(workspaceFiles.readAll).toHaveBeenCalledExactlyOnceWith(FILE.sessionId, FILE.path, expect.any(AbortSignal))
    expect(instance.getSnapshot().byTab[TAB_ID]?.complete?.data).toEqual(new Uint8Array([0, 1, 255]))
  })
})
