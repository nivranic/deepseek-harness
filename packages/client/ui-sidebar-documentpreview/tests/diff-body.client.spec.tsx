// @vitest-environment jsdom
/** Diff row rendering: gutters, hunk headers, added/removed marks, and the empty state. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DiffBody, type DiffBodyProps } from '../src/client/diff/DiffBody.tsx'
import { en } from '../src/client/diff/locales.ts'

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  cleanup()
  if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', originalClipboard)
})

function installClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

function props(text: string, eof = true): DiffBodyProps {
  return {
    resourceAddress: 'dsh-resource://file/session/d1/changes.diff',
    content: { kind: 'text', text, pages: [{ offset: 1, text, lines: text.split('\n').length }], eof },
    wrap: false,
    sessionId: 'd1' as SessionId,
    useTabInfo: () => ({ tab: { signal: new AbortController().signal } }),
    useResource: () => ({ value: undefined }),
    scrollportRef: () => {},
    t: key => translations.get(key) ?? key,
  } as DiffBodyProps
}

describe('DiffBody', () => {
  it('renders both gutters and the section heading for one hunk', () => {
    const view = render(<DiffBody {...props('--- a/x\n+++ b/x\n@@ -3,7 +3,8 @@ function run() {\n keep')} />)
    const root = view.container.querySelector('[data-diff-preview]') as HTMLElement
    expect(root.getAttribute('data-diff-eof')).toBe('true')
    const rows = root.querySelectorAll('[data-diff-row]').length
    expect(rows).toBe(4)
    const hunk = root.querySelector('[data-diff-row="hunk"]') as HTMLElement
    expect(hunk.textContent).toContain('@@ -3,7 +3,8 @@ function run() {')
    const context = root.querySelector('[data-diff-row="context"]') as HTMLElement
    expect(context.textContent).toBe('33 keep')
  })

  it('marks added rows with only the new gutter and removed rows with only the old gutter', () => {
    const view = render(<DiffBody {...props('@@ -10,2 +12,2 @@\n ctx\n-gone\n+fresh')} />)
    const root = view.container.querySelector('[data-diff-preview]') as HTMLElement
    const add = root.querySelector('[data-diff-row="add"]') as HTMLElement
    expect(add.textContent).toBe('13+fresh')
    const del = root.querySelector('[data-diff-row="del"]') as HTMLElement
    expect(del.textContent).toBe('11-gone')
  })

  it('carries the streaming flag while pages are still loading', () => {
    const view = render(<DiffBody {...props('@@ -1 +1 @@\n a', false)} />)
    const root = view.container.querySelector('[data-diff-preview]') as HTMLElement
    expect(root.getAttribute('data-diff-eof')).toBe('false')
  })

  it('renders the localized empty state for a file with no rows', () => {
    render(<DiffBody {...props('')} />)
    expect(screen.getByText(en.empty)).toBeDefined()
  })
})


describe('DiffBody clipboard', () => {
  it('copies the raw patch without display gutters or added marker spacing', async () => {
    const write = vi.fn(async (_text: string) => {})
    installClipboard(write)
    const patch = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new'
    render(<DiffBody {...props(patch)} />)
    fireEvent.click(screen.getByRole('button', { name: en.copy }))
    await screen.findByRole('button', { name: en.copied })
    expect(write).toHaveBeenCalledExactlyOnceWith(patch)
  })

  it('names partial copying and clears feedback when another page arrives', async () => {
    const write = vi.fn(async (_text: string) => {})
    installClipboard(write)
    const view = render(<DiffBody {...props('@@ -1 +1 @@\n-old', false)} />)
    fireEvent.click(screen.getByRole('button', { name: en.copyLoaded }))
    await screen.findByRole('button', { name: en.copied })
    view.rerender(<DiffBody {...props('@@ -1 +1 @@\n-old\n+new')} />)
    expect(screen.getByRole('button', { name: en.copy })).toBeDefined()
    expect(screen.queryByRole('button', { name: en.copied })).toBeNull()
  })

  it('reports denied clipboard permission without claiming success', async () => {
    installClipboard(async () => { throw new Error('denied') })
    render(<DiffBody {...props('patch')} />)
    fireEvent.click(screen.getByRole('button', { name: en.copy }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en.copyFailed) })
    expect(screen.queryByRole('button', { name: en.copied })).toBeNull()
  })

  it('does not publish old clipboard failure over a replacement file success', async () => {
    const old = Promise.withResolvers<undefined>()
    const next = Promise.withResolvers<undefined>()
    installClipboard(vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise))
    const view = render(<DiffBody {...props('old patch')} />)
    fireEvent.click(screen.getByRole('button', { name: en.copy }))
    view.rerender(<DiffBody {...props('new patch')} />)
    fireEvent.click(screen.getByRole('button', { name: en.copy }))
    await act(async () => { next.resolve(undefined); await next.promise })
    expect(screen.getByRole('button', { name: en.copied })).toBeDefined()
    await act(async () => { old.reject(new Error('old permission failure')); await old.promise.catch(() => {}) })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: en.copied })).toBeDefined()
  })

  it('disables copying for empty text and renders no body for bytes', () => {
    const view = render(<DiffBody {...props('')} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.copy }).disabled).toBe(true)
    view.rerender(<DiffBody {...props('')} content={{ kind: 'bytes', data: new Uint8Array() }} />)
    expect(view.container.textContent).toBe('')
  })
})
