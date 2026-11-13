// @vitest-environment jsdom
/** §26 view-location handoff: capture-side link copy and receive-side one-shot open. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { GlobalStandardProps, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot, ConversationViewSnapshotStore, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HostId } from '@deepseek-ai/dsh-api-remotes/client'
import { EMPTY_CHAT_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-chat/src/client/contract/snapshot.ts'
import { HandoffAction, type HandoffActionInjected, type HandoffActionProps } from '../src/client/HandoffAction.tsx'
import { VIEW_HANDOFF_FRAGMENT, type HandoffAdmission } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

const t = makeTranslate(en)
const SID = SessionId('s1')

function chatConversation(lastTurnSeq: number | undefined): ConversationSnapshot {
  const turns = new Map<number, TurnLocation>(lastTurnSeq === undefined ? [] : [[3, {
    turn: 3, status: 'open', steps: [],
    start: { type: 'turn/start', seq: SessionSeq(lastTurnSeq), time: 0, data: { turn: 3 } }, end: undefined,
    data: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
  }]])
  const chat = { ...EMPTY_CHAT_SNAPSHOT, timeline: { turnOrder: lastTurnSeq === undefined ? [] : [3], turns } }
  return {
    views: { get: ((target: string) => target === 'chat' ? chat : undefined) as ConversationViewSnapshotStore['get'], grouped: () => undefined },
    activeTargets: new Set<string>(),
  }
}

function mountAction(options: {
  admitted: boolean
  lastTurnSeq?: number | undefined
  encode?: HandoffActionInjected['encode']
  copy?: (text: string) => Promise<boolean>
}) {
  const admission = createSnapshotStore<HandoffAdmission>(options.admitted
    ? { status: 'ready', hostId: 'host-1' as HostId }
    : { status: 'waiting' })
  const props: HandoffActionProps = {
    ...({} as GlobalStandardProps & SessionStandardProps),
    sessionId: SID,
    useConversation: bindSnapshotSelector(createSnapshotStore(chatConversation(options.lastTurnSeq))),
    useAdmission: bindSnapshotSelector(admission),
    encode: options.encode ?? (() => 'dsh-session-view.v1.payload'),
    buildLink: (payload: string) => `https://desk.local:8787/app#${VIEW_HANDOFF_FRAGMENT}=${payload}`,
    copy: options.copy ?? (async () => true),
    t,
  }
  return { ...render(<HandoffAction {...props} />), admission }
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

  it('clears an old generation link and ignores its late clipboard completion', async () => {
    const copied = Promise.withResolvers<boolean>()
    const h = mountAction({ admitted: true, lastTurnSeq: 41, copy: () => copied.promise })
    fireEvent.click(screen.getByRole('button', { name: en.action }))
    expect(screen.getByRole('dialog', { name: en.scan })).toBeDefined()
    act(() => { h.admission.set({ status: 'waiting' }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { h.admission.set({ status: 'ready', hostId: 'next-host' as HostId }) })
    await act(async () => { copied.resolve(true); await copied.promise })
    expect(screen.queryByText(en.copied)).toBeNull()
    expect(screen.getByRole('button', { name: en.action }).getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a disposed capture absent when clipboard work settles', async () => {
    const copied = Promise.withResolvers<boolean>()
    const h = mountAction({ admitted: true, lastTurnSeq: 41, copy: () => copied.promise })
    fireEvent.click(screen.getByRole('button', { name: en.action }))
    h.unmount()
    await act(async () => { copied.resolve(true); await copied.promise })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(en.copied)).toBeNull()
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
