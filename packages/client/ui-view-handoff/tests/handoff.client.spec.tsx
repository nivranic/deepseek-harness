// @vitest-environment jsdom
/** §26 view-location handoff: capture-side link copy and receive-side one-shot open. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { HandoffAction, type HandoffActionInjected, type HandoffActionProps } from '../src/client/HandoffAction.tsx'
import { ViewHandoffController, VIEW_HANDOFF_FRAGMENT } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const SID = 's1' as SessionId
const HOST = {
  home: '/h', platform: 'linux', descriptor: { hostId: 'host-1', displayName: 'Work PC' },
} as unknown as ConnectionGeneration['host']

/** Pushable generation observable driving the controller's admission signal. */
function generationSource() {
  const listeners = new Set<() => void>()
  let snapshot: ConnectionGeneration | undefined
  const source = {
    getSnapshot: (): ConnectionGeneration | undefined => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (next: ConnectionGeneration | undefined): void => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
  return source
}

function chatConversation(lastTurnSeq: number | undefined) {
  const turns = new Map(lastTurnSeq === undefined ? [] : [[3, {
    turn: 3, status: 'closed' as const, steps: [],
    start: { seq: lastTurnSeq }, end: undefined, data: undefined,
  }]])
  return {
    views: { get: () => lastTurnSeq === undefined ? undefined : {
      timeline: { turnOrder: lastTurnSeq === undefined ? [] : [3], turns },
    } },
    activeTargets: new Set<string>(),
  }
}

function mountAction(options: {
  admitted: boolean
  lastTurnSeq?: number | undefined
  encode?: HandoffActionInjected['encode']
  copy?: (text: string) => Promise<boolean>
}) {
  const props = {
    sessionId: SID,
    useConversation: (select: (value: ReturnType<typeof chatConversation>) => unknown) =>
      select(chatConversation(options.lastTurnSeq)),
    useAdmitted: (select: (value: boolean) => unknown) => select(options.admitted),
    encode: options.encode ?? (() => 'dsh-session-view.v1.payload'),
    buildLink: (payload: string) => `https://desk.local:8787/app#${VIEW_HANDOFF_FRAGMENT}=${payload}`,
    copy: options.copy ?? (async () => true),
    t,
  } as unknown as HandoffActionProps
  return render(<HandoffAction {...props} />)
}

beforeEach(() => { document.documentElement.lang = 'en' })
afterEach(() => { cleanup() })

describe('view-handoff capture side', () => {
  it('stays hidden before admission or without a Turn anchor', () => {
    const { container, rerender } = mountAction({ admitted: false, lastTurnSeq: 41 })
    expect(container.firstChild).toBeNull()
    cleanup()
    const bare = mountAction({ admitted: true, lastTurnSeq: undefined })
    expect(bare.container.firstChild).toBeNull()
    void rerender
  })

  it('encodes the session and last Turn anchor, copies the fragment link, and dresses copied', async () => {
    const encode = vi.fn(() => 'dsh-session-view.v1.abc')
    const copied: string[] = []
    mountAction({ admitted: true, lastTurnSeq: 41, encode, copy: async (text) => { copied.push(text); return true } })
    fireEvent.click(screen.getByRole('button', { name: en.action }))
    await vi.waitFor(() => { expect(screen.getByText(en.copied)).toBeDefined() })
    expect(encode).toHaveBeenCalledWith(SID, 41)
    expect(copied).toEqual([`https://desk.local:8787/app#${VIEW_HANDOFF_FRAGMENT}=dsh-session-view.v1.abc`])
  })

  it('names the failure and keeps the link reachable when the clipboard refuses', async () => {
    const { container } = mountAction({ admitted: true, lastTurnSeq: 41, copy: async () => false })
    fireEvent.click(screen.getByRole('button', { name: en.action }))
    const button = container.querySelector('button')
    await vi.waitFor(() => { expect(button?.getAttribute('title')).toContain(en.copyFailed) })
    expect(button?.getAttribute('title')).toContain(VIEW_HANDOFF_FRAGMENT)
  })
})

describe('view-handoff QR popover', () => {
  it('opens on click and renders the portaled QR carrying the fragment link', async () => {
    mountAction({ admitted: true, lastTurnSeq: 41 })
    const button = screen.getByRole('button', { name: en.action })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    await vi.waitFor(() => { expect(document.querySelector('svg title')?.textContent).toBe(en.scan) })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.querySelector('[aria-label="' + en.scan + '"] svg')).not.toBeNull()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const { container } = mountAction({ admitted: true, lastTurnSeq: 41 })
    const button = screen.getByRole('button', { name: en.action })
    fireEvent.click(button)
    await vi.waitFor(() => { expect(document.querySelector('svg title')?.textContent).toBe(en.scan) })
    const root = container.firstChild as HTMLElement
    fireEvent.keyDown(root, { key: 'Escape' })
    expect(document.querySelector('svg title')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('dismisses on a pointer press outside the action and panel', async () => {
    mountAction({ admitted: true, lastTurnSeq: 41 })
    const button = screen.getByRole('button', { name: en.action })
    fireEvent.click(button)
    await vi.waitFor(() => { expect(document.querySelector('svg title')?.textContent).toBe(en.scan) })
    fireEvent.pointerDown(document.body)
    expect(document.querySelector('svg title')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('view-handoff controller', () => {
  it('derives admission from the generation descriptor and builds fragment links', () => {
    const source = generationSource()
    const controller = new ViewHandoffController(
      source,
      async () => {},
      { origin: 'https://desk.local:8787', pathname: '/app', hash: '' },
    )
    expect(controller.admitted.getSnapshot()).toBe(false)
    source.publish({ id: 1, host: HOST })
    expect(controller.admitted.getSnapshot()).toBe(true)
    expect(controller.buildLink('pay.load')).toBe(`https://desk.local:8787/app#${VIEW_HANDOFF_FRAGMENT}=pay.load`)
  })

  it('opens a received fragment exactly once, only after admission', async () => {
    const source = generationSource()
    const location = { origin: 'https://desk.local', pathname: '/', hash: `#${VIEW_HANDOFF_FRAGMENT}=pay.load` }
    const controller = new ViewHandoffController(source, async () => {}, location)
    const openViewLocation = vi.fn(async () => { throw new Error('targeting race') })
    const sessions = { openViewLocation } as unknown as ISessions
    const outcomes: string[] = []
    const attempt = controller.receive(sessions, (outcome) => { outcomes.push(outcome) })
    await Promise.resolve()
    expect(openViewLocation).not.toHaveBeenCalled()
    expect(location.hash).toBe('')
    source.publish({ id: 1, host: HOST })
    await attempt
    expect(openViewLocation).toHaveBeenCalledWith('pay.load')
    expect(outcomes).toEqual(['failed'])
    // One-shot: a second read of the consumed fragment does nothing.
    await controller.receive(sessions, (outcome) => { outcomes.push(outcome) })
    expect(openViewLocation).toHaveBeenCalledTimes(1)
    expect(outcomes).toEqual(['failed'])
  })
})
