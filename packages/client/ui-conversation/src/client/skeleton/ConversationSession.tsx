/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useEffect } from 'react'
import clsx from 'clsx'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHostInfo, ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'
import { permissionTierLabel } from './PermissionSelect.tsx'
import { HeaderOverflowMenu, usePhoneTier } from './HeaderOverflowMenu.tsx'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/** Connection states that keep retrying; the chip dot marks them as transient. */
const TRANSIENT_LOCATION_STATES: ReadonlySet<ConnectionState> = new Set(['connecting', 'authenticating', 'reconnecting'])

/** Blocked states the dot flags until recovery or re-pairing intervenes. */
const BLOCKED_LOCATION_STATES: ReadonlySet<ConnectionState> = new Set([
  'offline', 'host-not-ready', 'auth-expired', 'device-revoked', 'identity-changed', 'incompatible', 'fatal',
])

/** Last path segment of a workspace location; blank when the path carries none. */
function workspaceNameOf(cwd: string | undefined): string | undefined {
  return cwd?.split(/[\\/]/u).filter(Boolean).at(-1)
}

/**
 * Section 29's lean running-location chip. Visible text stays Host, platform, workspace
 * name, permission tier, and any non-ready state word; the title additionally publishes
 * the runtime mode and the full workspace path so every location fact is reachable.
 * @param props - Host facts, workspace path, permission projection, online state, locale.
 * @returns the chip element, or nothing while no Host generation exists.
 */
function RunningLocationChip({ host, workspacePath, permissions, connectionState, t }: {
  host: ConnectionHostInfo
  workspacePath: string | undefined
  permissions: { readonly currentValue: string } | undefined
  connectionState: ConnectionState | undefined
  t: ConversationSessionHeaderProps['t']
}) {
  const workspaceName = workspaceNameOf(workspacePath)
  const stateWord = connectionState !== undefined && connectionState !== 'ready'
    ? t(`session.locationState.${connectionState}`)
    : undefined
  const visible = [
    host.descriptor !== undefined
      ? t('session.runningLocationNamed', { name: host.descriptor.displayName, platform: host.platform })
      : t('session.runningLocation', { platform: host.platform }),
    ...workspaceName !== undefined ? [workspaceName] : [],
    ...permissions !== undefined ? [permissionTierLabel(permissions.currentValue, t)] : [],
    ...stateWord !== undefined ? [stateWord] : [],
  ].join(' · ')
  const detail = [
    visible,
    ...host.descriptor !== undefined ? [t('session.runtimeMode.full')] : [],
    ...workspacePath !== undefined ? [workspacePath] : [],
  ].join(' · ')
  const dot = connectionState !== undefined && BLOCKED_LOCATION_STATES.has(connectionState) ? css.headerHostDotBlocked
    : connectionState !== undefined && TRANSIENT_LOCATION_STATES.has(connectionState) ? css.headerHostDotTransient
      : css.headerHostDot
  return (
    <span className={css.headerHost} data-conversation-running-location="" title={detail}>
      <span className={dot} aria-hidden="true" />
      {visible}
    </span>
  )
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useConversation, useConversationViews, useHostFacts, useConnectionState, useProjection, useStore,
  renderSlot, open, selectView, t,
}: ConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const host = useHostFacts(value => value)
  // Section 29 keeps the chip lean but publishes every location fact: the
  // workspace rides the visible text, and runtime mode plus the full workspace
  // path ride the title alongside the live online state.
  const workspacePath = useSessions(s => s.byId[sessionId]?.cwd)
  const connectionState = useConnectionState(value => value)
  // Section 10's running-location chip carries the current permission tier;
  // a permission-less Host or Draft leaves the chip as Host facts alone.
  const permissions = useProjection('permissions')
  const phoneTier = usePhoneTier()
  const hideChrome = session.blank && conversationPhase(session, conversation) === 'blank'

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className={css.titleRow}>
            <div className={css.headerLeading}>
              {renderSlot('conversation.session.header.leading', {})}
            </div>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  const title = (
                    <button
                      type="button"
                      className={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {!phoneTier && renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {host !== undefined && <RunningLocationChip host={host} workspacePath={workspacePath}
                permissions={permissions} connectionState={connectionState} t={t} />}
              {phoneTier
                ? <HeaderOverflowMenu t={t}
                  actions={renderSlot('conversation.session.header.actions', {})}
                  utilities={renderSlot('conversation.session.header.utilities', {})} />
                : renderSlot('conversation.session.header.utilities', {})}
            </div>
            <div className={css.headerCorner} data-conversation-header-corner="">
              {renderSlot('conversation.session.header.corner', {})}
            </div>
          </div>
          {tabs.length > 1 && (
            <div className={css.tabs} role="tablist">
              {tabs.map(viewTab => (
                <button
                  key={viewTab.id}
                  type="button"
                  role="tab"
                  aria-selected={viewTab.id === active?.id}
                  className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                  onClick={() => { selectView(viewTab.id) }}
                >
                  {viewTab.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  useSession, useConversation, useConversationViews, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror, openView, useHistoryAvailable, t,
}: ConversationSessionProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const historyAvailable = useHistoryAvailable(value => value)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  const viewRequest = useStore(s => s.viewRequest ?? null)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  const blank = session.blank && conversationPhase(session, conversation) === 'blank'
  if (historyAvailable && blank) return null
  return (
    <div className={css.viewArea}>
      {!historyAvailable && <div role="status" className={css.historyUnavailable}>{t('session.historyUnavailable')}</div>}
      {!blank && active !== undefined && renderSlot('conversation.view', {
        historyAvailable,
        viewRequest,
        openView,
        completeViewRequest: actions.completeViewRequest,
      }, { only: active.id })}
    </div>
  )
}
