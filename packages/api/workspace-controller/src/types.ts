/**
 * Browser-safe request, result, and state-stream vocabulary for the Workspace
 * and directory-picking Remote namespaces this package owns. The picking seam
 * declares its own listing types, so they are re-exported here rather than
 * restated: a browser consumer reads the very declaration the backend answers.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionActivity, WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
export type {
  SessionActivity, SessionActivityItem, SessionActivityKind, SessionActivityKindMap,
} from '@deepseek-ai/dsh-workspace/types'
export type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'

/** One durable Workspace projected for browser consumers. */
export interface WorkspaceView {
  readonly workspaceId: WorkspaceId
  /** Canonical host directory path. */
  readonly path: string
  /** User-visible title. */
  readonly title: string
  /** Sessions accounted to this Workspace in manual order. */
  readonly sessionIds: readonly SessionId[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested directory cannot back a Workspace. */
    'workspace/invalid-path': { readonly path: string }
    /** Another Workspace already uses the requested name. */
    'workspace/name-conflict': { readonly name: string }
    /**
     * The Session still has running work — its own turn, a subagent, a
     * background job, or an active schedule — so archiving was refused
     * without a write; `activity` names what must stop first.
     */
    'workspace/session-active': {
      readonly sessionId: SessionId
      readonly activity: readonly SessionActivity[]
    }
    /** The Session or its anchor is not in the Workspace's manual order. */
    'workspace/move-invalid': {
      readonly workspaceId: WorkspaceId
      readonly sessionId: SessionId
      readonly beforeSessionId?: SessionId
    }
    /** The verb needs an interaction the composed backend does not serve. */
    'directory-picker/unavailable': { readonly capability: string }
    /** The target is not fully qualified, or the backend cannot list it. */
    'directory-picker/unreadable': { readonly path: string }
    /** A child of that name is already there. */
    'directory-picker/exists': { readonly path: string }
    /** The parent is not fully qualified, the name is not one segment, or creation failed. */
    'directory-picker/create-failed': { readonly path: string }
  }
}

/** Existing directory requested for Workspace adoption. */
export interface WorkspaceCreateRequest {
  readonly path: string
}

/** Created or previously registered Workspace. */
export interface WorkspaceCreateValue {
  readonly workspace: WorkspaceView
  readonly created: boolean
}

/** Workspace title mutation. */
export interface WorkspaceRenameRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

/** Workspace mutation returning the complete changed row. */
export interface WorkspaceValue {
  readonly workspace: WorkspaceView
}

/** Workspace registration deletion. */
export interface WorkspaceDeleteRequest {
  readonly workspaceId: WorkspaceId
}

/** Receipt after one Workspace registration is deleted. */
export interface WorkspaceDeleteValue {
  readonly deleted: true
}

/** DOM-insertBefore-like Workspace order mutation. */
export interface WorkspaceInsertBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly beforeWorkspaceId?: WorkspaceId
}

/** Complete Workspace registry order after a mutation. */
export interface WorkspaceOrderValue {
  readonly workspaceIds: readonly WorkspaceId[]
}

/** DOM-insertBefore-like Session membership order mutation. */
export interface WorkspaceInsertSessionBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly beforeSessionId?: SessionId
}

/** Session requested for archival from Workspace grouping surfaces. */
export interface WorkspaceArchiveSessionRequest {
  readonly sessionId: SessionId
  /**
   * Stop the Session's running work — its turn, subagent descendants, owned
   * background jobs, and active schedules — instead of refusing the archive
   * as `workspace/session-active`. The stops are requested before the
   * archive write and are not awaited; the response arrives once the archive
   * set is durable.
   */
  readonly stopActivity?: boolean
}

/** Session requested for restoration from the archived Session list. */
export interface WorkspaceUnarchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Complete archived Session set after a mutation. */
export interface WorkspaceArchiveValue {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Session requested for pinning ahead of unpinned Sessions on grouping surfaces. */
export interface WorkspacePinSessionRequest {
  readonly sessionId: SessionId
}

/** Session requested for removal from the pin set. */
export interface WorkspaceUnpinSessionRequest {
  readonly sessionId: SessionId
}

/** Complete pinned Session set after a mutation, most recently pinned first. */
export interface WorkspacePinValue {
  readonly pinnedSessionIds: readonly SessionId[]
}

/** Complete reconnect baseline for Workspace browser state. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
  /** Registry-global pin set, most recently pinned first. */
  readonly pinnedSessionIds: readonly SessionId[]
}

/**
 * One ordered Workspace change after a generation's baseline. `replace`
 * carries the complete state that supersedes everything delivered before it
 * in the generation; it is a change, not a new generation's opening frame.
 */
export type WorkspaceFollowIncrement =
  | { readonly type: 'replace'; readonly value: WorkspaceBaseline }
  | { readonly type: 'upsert'; readonly workspace: WorkspaceView }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }
  | { readonly type: 'pinned'; readonly pinnedSessionIds: readonly SessionId[] }

/** Workspace state stream; every generation starts with exactly one baseline. */
export type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkspaceBaseline }
  | WorkspaceFollowIncrement

/** One child row of a workspace directory listing. */
export interface WorkspaceFileEntry {
  /** Basename of the child inside the listed directory. */
  readonly name: string
  /** Whether the child is a regular file, a directory, or something else. */
  readonly type: 'file' | 'directory' | 'other'
  /** Byte size of a regular file, when the backend reports it. */
  readonly size?: number
}

/** Read-only browse of one registered Workspace's directory tree. */
export interface WorkspaceFilesListRequest {
  readonly workspaceId: WorkspaceId
  /** Directory path relative to the Workspace root; empty or absent lists the root. */
  readonly path?: string
}

/** One listed directory level. */
export interface WorkspaceFilesListValue {
  /** The normalized relative path that was listed; '' names the root. */
  readonly path: string
  /** Direct children in stable name order, never their contents. */
  readonly entries: readonly WorkspaceFileEntry[]
}

/** Read one text file inside a registered Workspace with a UTF-16 range. */
export interface WorkspaceFilesReadRequest {
  readonly workspaceId: WorkspaceId
  /** File path relative to the Workspace root. */
  readonly path: string
  /** Start of the returned range in UTF-16 code units; defaults to 0. */
  readonly offset?: number
  /** Maximum returned code units; omitted reads through the end. */
  readonly limit?: number
}

/** One decoded text range. */
export interface WorkspaceFilesReadValue {
  /** The requested UTF-16 code-unit range of the decoded text. */
  readonly content: string
  /** Whether `limit` cut the range before the file's end. */
  readonly truncated: boolean
  /** Total content length in UTF-16 code units. */
  readonly size: number
  /** Best-effort media type by file extension; `text/plain` when unknown. */
  readonly mediaType: string
}

/** Stable read-only file-browse failure details returned by the `workspaceFiles` verbs. */
export interface WorkspaceFilesErrorDetailsMap {
  'bad-request': { readonly issues: ReadonlyArray<{ readonly message: string }> }
  'workspace-not-found': { readonly workspaceId: WorkspaceId }
  'path-outside-workspace': { readonly workspaceId: WorkspaceId; readonly path: string }
  'file-not-found': { readonly path: string }
  'not-a-directory': { readonly path: string }
  'not-a-regular-file': { readonly path: string }
  'file-too-large': { readonly path: string; readonly size?: number; readonly maxBytes: number }
  'file-binary': { readonly path: string }
  internal: Record<never, never>
}
