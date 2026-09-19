/** Workspace archive and directory UI capability. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Select a Session and show its Conversation as one UI navigation action.
   * @param sessionId - listed or retained Session to display.
   */
  openSession(sessionId: SessionId): void
  /**
   * Connect a Workspace and open its Session unless a later navigation supersedes it.
   * @param workspaceId - target Workspace.
   * @param beforeOpen - optional synchronous preparation for the selected Session, skipped after supersession.
   * @returns completion; supersession or capability withdrawal may leave a created Session unselected.
   * @throws a capability failure before navigation when Session management is unavailable.
   */
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  /**
   * Fork a Session and open the child unless a later navigation supersedes it.
   * @param sessionId - source Session.
   * @returns completion; supersession or capability withdrawal leaves its child available without selecting it.
   * @throws a capability failure before navigation when Session management is unavailable.
   */
  forkSession(sessionId: SessionId): Promise<void>
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   * @throws a capability failure when Session management is unavailable.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session; unavailable management leaves selection unchanged.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
  /**
   * Bind directory operations to the current admitted Host and an optional owner lifetime.
   * @param signal - registration lifetime; cancellation invalidates callbacks and aborts directory reads or a native chooser.
   * @returns operations that require their advertised capability and reject late results after replacement or disposal.
   */
  captureDirectoryOperations(signal?: AbortSignal): Pick<UiWorkspace, 'pickDirectory' | 'listDirectory' | 'createDirectory'>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()
  private readonly lifetime = new AbortController()

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => this.watchNavigation(), 'ui-workspace: Workspace navigation policy')
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    this.requireSessionManagement()
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight

    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary !== undefined && summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(summary.id)
        && !archived.includes(summary.id)) return summary.id
    }

    const attempt = this.sessions.create({ workspaceId })
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  openSession(sessionId: SessionId): void {
    this.sessions.open(sessionId)
    this.ctx.layout.selectPanel(null)
  }

  async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    this.requireSessionManagement()
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const isCurrent = (): boolean => !navigation.aborted && this.canManageSessions()
    const sessionId = await this.connectWorkspace(workspaceId)
    if (!isCurrent()) return
    beforeOpen?.(sessionId)
    if (isCurrent()) this.openSession(sessionId)
  }

  async forkSession(sessionId: SessionId): Promise<void> {
    this.requireSessionManagement()
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const childId = await this.sessions.fork({ sessionId, increaseTitle: true })
    if (!navigation.aborted && this.canManageSessions()) this.openSession(childId)
  }

  startSession(workspaceId?: WorkspaceId): void {
    if (!this.canManageSessions()) return
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = sessions.current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined) {
      this.sessions.clear()
      this.ctx.layout.selectPanel(null)
      return
    }
    void this.openWorkspace(target).catch(
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    if (this.ctx.remote.$host.capabilities?.includes('workspace.sessions.v1') !== true) {
      throw new RemoteError('host/capability-unavailable', 'Host cannot organize Workspace Sessions', { capability: 'workspace.sessions.v1' })
    }
    await this.workspaces.archiveSession(sessionId)
  }

  async pickDirectory(): Promise<string | null> {
    return this.captureDirectoryOperations().pickDirectory()
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    return this.captureDirectoryOperations().listDirectory(path, signal)
  }

  async createDirectory(path: string, name: string): Promise<string> {
    return this.captureDirectoryOperations().createDirectory(path, name)
  }

  captureDirectoryOperations(signal?: AbortSignal): Pick<UiWorkspace, 'pickDirectory' | 'listDirectory' | 'createDirectory'> {
    const host = this.ctx.remote.$host
    const requireCurrent = (): void => {
      if (host !== this.ctx.remote.$host || signal?.aborted === true) {
        throw new RemoteError('gateway/cancelled', 'Directory interaction belongs to a replaced or disposed owner', {})
      }
    }
    const run = async <T>(
      capability: string,
      operation: () => Promise<RemoteResult<T>>,
      failure: (error: RemoteFailure) => Error = error => new DirectoryBrowseError(error),
    ): Promise<T> => {
      requireCurrent()
      if (host.capabilities?.includes(capability) !== true) {
        throw new RemoteError('host/capability-unavailable', 'Host does not support this directory operation', { capability })
      }
      const result = await operation()
      requireCurrent()
      if (!result.ok) throw failure(result.error)
      return result.value
    }
    return {
      pickDirectory: () => run('directory-picker.native.v1', () => this.directoryPicker.pick(signal),
        error => new Error(`directory picker failed: ${error.message}`)),
      listDirectory: (path, requestSignal) => run('directory-picker.browse.v1', () => this.directoryPicker.list(path,
        signal === undefined ? requestSignal : requestSignal === undefined ? signal : AbortSignal.any([signal, requestSignal]))),
      createDirectory: (path, name) => run('directory-picker.create.v1', () => this.directoryPicker.createDirectory(path, name)),
    }
  }

  private canManageSessions(): boolean {
    return this.ctx.remote.$host.capabilities?.includes('session.manage.v1') === true
  }

  private requireSessionManagement(): void {
    if (!this.canManageSessions()) {
      throw new RemoteError('host/capability-unavailable', 'Host cannot manage Sessions', { capability: 'session.manage.v1' })
    }
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    const reconcile = (): void => {
      if (this.lifetime.signal.aborted) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting' || !this.canManageSessions()) return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (sessions.current !== undefined) {
        initial = 'done'
        return
      }
      const target = recentWorkspace(workspace.items, sessions.byId)
      if (target === undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      const host = this.ctx.remote.$host
      void this.connectWorkspace(target).then(
        (sessionId) => {
          if (this.lifetime.signal.aborted) return
          if (!this.canManageSessions()) {
            initial = 'waiting'
            return
          }
          if (this.sessions.list.getSnapshot().current === undefined) {
            this.sessions.open(sessionId)
          }
          initial = 'done'
        },
        (reason: unknown) => {
          if (this.lifetime.signal.aborted) return
          initial = 'waiting'
          if (this.ctx.remote.$host !== host) {
            reconcile()
            return
          }
          console.warn('initial workspace selection failed:', reason)
        },
      )
    }
    const disposeConnection = this.ctx.on('connection/reset', reconcile)
    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      this.lifetime.abort()
      disposeConnection()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.sessions.clear()
    return true
  }

}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
