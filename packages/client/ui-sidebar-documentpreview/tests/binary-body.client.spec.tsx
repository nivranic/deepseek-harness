// @vitest-environment jsdom
/** Binary fact card: size heading, hex window rows, remaining-bytes note, and the zero-byte state. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BinaryBody, type BinaryBodyProps } from '../src/client/binary/BinaryBody.tsx'
import { en } from '../src/client/binary/locales.ts'

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))

afterEach(() => { cleanup() })

function props(data: Uint8Array<ArrayBuffer>): BinaryBodyProps {
  return {
    resourceAddress: 'dsh-resource://file/session/b1/asset.zip',
    content: { kind: 'bytes', data },
    wrap: false,
    sessionId: 'b1' as SessionId,
    useTabInfo: () => ({ tab: { signal: new AbortController().signal } }),
    useResource: () => ({ value: undefined }),
    scrollportRef: () => {},
    t: (key, params) => {
      const value = translations.get(key) ?? key
      return params === undefined ? value : value.replace('{count}', String(params.count))
    },
  } as BinaryBodyProps
}

describe('BinaryBody', () => {
  it('states the byte count beside the not-text notice and renders hex rows', () => {
    const view = render(<BinaryBody {...props(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))} />)
    const root = view.container.querySelector('[data-binary-preview]') as HTMLElement
    expect(root.getAttribute('data-binary-bytes')).toBe('4')
    expect(screen.getByText(`${en.binaryFile} · ${en.bytes.replace('{count}', '4')}`)).toBeDefined()
    const row = root.querySelector('[data-binary-hex-row="0"]') as HTMLElement
    expect(row.textContent).toBe('0000000050 4b 03 04')
    expect(root.querySelector('[data-binary-empty]')).toBeNull()
  })

  it('adds the unshown remainder to the heading past the display bound', () => {
    render(<BinaryBody {...props(new Uint8Array(300))} />)
    expect(screen.getByText(`${en.binaryFile} · ${en.bytes.replace('{count}', '300')} · +44`)).toBeDefined()
  })

  it('presents the zero-byte file as an explicit empty state with no hex rows', () => {
    const view = render(<BinaryBody {...props(new Uint8Array(0))} />)
    const root = view.container.querySelector('[data-binary-preview]') as HTMLElement
    expect(root.getAttribute('data-binary-bytes')).toBe('0')
    expect(screen.getByText(en.emptyFile)).toBeDefined()
    expect(root.querySelector('[data-binary-hex-row="0"]')).toBeNull()
  })
})
