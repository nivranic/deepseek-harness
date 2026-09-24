// @vitest-environment jsdom
/** Diff row rendering: gutters, hunk headers, added/removed marks, and the empty state. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DiffBody, type DiffBodyProps } from '../src/client/diff/DiffBody.tsx'
import { en } from '../src/client/diff/locales.ts'

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))

afterEach(() => { cleanup() })

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
    expect(context.textContent).toBe('33keep')
  })

  it('marks added rows with only the new gutter and removed rows with only the old gutter', () => {
    const view = render(<DiffBody {...props('@@ -10 +12 @@\n ctx\n-gone\n+fresh')} />)
    const root = view.container.querySelector('[data-diff-preview]') as HTMLElement
    const add = root.querySelector('[data-diff-row="add"]') as HTMLElement
    expect(add.textContent).toBe('13fresh')
    const del = root.querySelector('[data-diff-row="del"]') as HTMLElement
    expect(del.textContent).toBe('11gone')
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
