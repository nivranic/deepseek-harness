// @vitest-environment jsdom
/** §10 phone-tier header overflow: the ⋮ affordance aggregates the header's secondary controls. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import {
  bindSnapshotSelector, makeTranslate, sessionSnapshot as sessionFixture,
} from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConnectionHostInfo } from '@deepseek-ai/dsh-client-connection/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ConversationSessionHeader } from '../src/client/skeleton/ConversationSession.tsx'
import type { ConversationSessionHeaderSlotProps } from '../src/client/contract/slots.ts'
import { EMPTY_CONVERSATION_SNAPSHOT } from '../src/client/contract/snapshot.ts'

const t = makeTranslate(zh, commonZh)
const SID = 's1' as SessionId
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

/** Controllable matchMedia stub: flip the tier and notify the live subscription. */
function stubPhoneTier(initial: boolean): { setMatches: (value: boolean) => void } {
  const listeners = new Set<() => void>()
  const query = {
    matches: initial,
    addEventListener: (_event: 'change', listener: () => void) => { listeners.add(listener) },
    removeEventListener: (_event: 'change', listener: () => void) => { listeners.delete(listener) },
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return {
    setMatches: (value: boolean) => {
      query.matches = value
      for (const listener of [...listeners]) listener()
    },
  }
}

function mountHeader(options: { headerSlots?: boolean } = {}) {
  const showSlots = options.headerSlots ?? true
  const session = createSnapshotStore(sessionFixture(SID))
  const conversation = createSnapshotStore(EMPTY_CONVERSATION_SNAPSHOT)
  const sessions = createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'S1', running: false, blank: false, updatedAt: 1, cwd: '/p' } },
    current: SID,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const workspaces = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  const hostFacts: ConnectionHostInfo = { home: '/h', platform: 'linux' }
  const renderSlot = ((key: string) => {
    if (!showSlots) return null
    if (key === 'conversation.session.header.actions') return <div data-testid="slot-actions" />
    if (key === 'conversation.session.header.utilities') return <div data-testid="slot-utilities" />
    if (key === 'conversation.session.header.corner') return <div data-testid="slot-corner" />
    if (key === 'conversation.session.header.leading') return <div data-testid="slot-leading" />
    return null
  })
  const props = {
    sessionId: SID,
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
    useSession: bindSnapshotSelector(session),
    useConversation: bindSnapshotSelector(conversation),
    useConversationViews: (select: (value: never[]) => unknown) => select([]),
    useHostFacts: (select: (value: ConnectionHostInfo) => unknown) => select(hostFacts),
    useConnectionState: (select: (value: undefined) => unknown) => select(undefined),
    useChat: () => { throw new Error('unused') },
    useTrajectory: () => { throw new Error('unused') },
    useSessions: bindSnapshotSelector(sessions),
    usePanelInfo: (select: (value: { activePanelId: string | null }) => unknown) => select({ activePanelId: null }),
    useResource,
    useSessionPendingInteraction: bindSnapshotSelector(createSnapshotStore(new Map<string, never>())),
    useWorkspaces: bindSnapshotSelector(workspaces),
    useProjection: () => undefined,
    useInput: () => ({}) as never,
    inputActions: {} as never,
    useStore: () => 'chat' as never,
    actions: {} as never,
    renderSlot: renderSlot as never,
    open: vi.fn(),
    selectView: vi.fn(),
    t,
  } as unknown as ConversationSessionHeaderSlotProps
  return render(<ConversationSessionHeader {...props} />)
}

beforeEach(() => { document.documentElement.lang = 'zh' })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('phone-tier header overflow (§10)', () => {
  it('keeps the wide tier exactly as before: inline rows, no ⋮ affordance', () => {
    stubPhoneTier(false)
    const view = mountHeader()
    expect(screen.queryByRole('button', { name: zh['session.overflow.aria'] })).toBeNull()
    expect(view.container.querySelector('[data-testid="slot-actions"]')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="slot-utilities"]')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="slot-corner"]')).not.toBeNull()
  })

  it('aggregates actions and utilities behind the ⋮ trigger while the chip and corner stay in the bar', () => {
    stubPhoneTier(true)
    const view = mountHeader()
    const header = view.container.querySelector('header') as HTMLElement
    // The wireframe's phone bar: the running-location chip and the corner stay
    // inline; the secondary rows are gone from the bar and wait behind ⋮.
    expect(within(header).getByText(/linux/)).toBeDefined()
    expect(within(header).getByTestId('slot-corner')).toBeDefined()
    expect(within(header).queryByTestId('slot-actions')).toBeNull()
    expect(within(header).queryByTestId('slot-utilities')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh['session.overflow.aria'] }))
    const panel = screen.getByLabelText(zh['session.overflow.aria'], { selector: 'div' })
    expect(within(panel).getByTestId('slot-actions')).toBeDefined()
    expect(within(panel).getByTestId('slot-utilities')).toBeDefined()
    // The panel is portaled past the header; the bar itself keeps no second copy.
    expect(within(header).queryByTestId('slot-actions')).toBeNull()
  })

  it('closes on Escape and returns focus to the trigger', () => {
    stubPhoneTier(true)
    mountHeader()
    const trigger = screen.getByRole('button', { name: zh['session.overflow.aria'] })
    fireEvent.click(trigger)
    expect(screen.getByTestId('slot-actions')).toBeDefined()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByTestId('slot-actions')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('names the empty panel while no header list renders anything', () => {
    stubPhoneTier(true)
    mountHeader({ headerSlots: false })
    fireEvent.click(screen.getByRole('button', { name: zh['session.overflow.aria'] }))
    expect(screen.getByText(zh['session.overflow.empty'])).toBeDefined()
  })

  it('follows a live tier change back to the inline rows', async () => {
    const tier = stubPhoneTier(true)
    const view = mountHeader()
    expect(screen.getByRole('button', { name: zh['session.overflow.aria'] })).toBeDefined()
    await act(async () => { tier.setMatches(false) })
    expect(screen.queryByRole('button', { name: zh['session.overflow.aria'] })).toBeNull()
    expect(view.container.querySelector('[data-testid="slot-actions"]')).not.toBeNull()
  })
})
