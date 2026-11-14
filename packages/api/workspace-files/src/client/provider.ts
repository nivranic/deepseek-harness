/**
 * The `file` protocol's provider: a workspace file's metadata as a stream of
 * `RemoteResult` frames.
 *
 * An address names the file in one of two scopes. A `session` address,
 * `dsh-resource://file/session/<sessionId>/<path>`, carries an absolute path or one
 * relative to that Session's workspace root: the Host receives the path as-is and
 * resolves it against the root it holds. Only the Host's `stat.absolutePath`
 * selects the change-feed key; no Client Session summary is needed.
 * An `absolute` address, `dsh-resource://file/absolute/<path>`, carries no
 * Session and cannot authorize a Host call. An address neither scope
 * resolves yields one failure frame — `workspace-file/unsupported-address` for
 * a string outside the grammar, `workspace-file/unknown-workspace` when the
 * address carries no Session — and ends.
 *
 * The first frame is the file's `stat`; subsequent invalidations run `stat`
 * again unless their version or absence is already known. Reconnection also
 * restats the file. Failures travel as `ok: false` frames, never as thrown errors: the
 * Remote face does not reject, and anything thrown inside the stream is a
 * programming error the resource model lets surface. A failed stat does not end
 * the stream: the next write stats again. One {@link ChangeFeed}
 * serves every open file of the Client.
 */
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceFileStat } from '../types.ts'
import type { ChangeFeed } from './change-feed.ts'
import type { WorkspaceFilesRemote } from './remote.ts'

/** The Session and unmodified path submitted to the Host. */
interface HostFile {
  readonly sessionId: SessionId
  /** The path the Host receives: absolute or workspace-relative. */
  readonly path: string
}

/**
 * The Host admission a registration was built from: the capabilities the
 * Host's `describe` answer advertised, plus the registration's lifetime.
 */
export interface HostAdmission {
  /** Capability ids the admitted Host advertised through `host.describe`. */
  readonly capabilities: readonly string[]
  /** Registration cancellation, independent from individual resource holders. */
  readonly signal?: AbortSignal
}

/**
 * Build the `file` provider over one Remote face and one change feed.
 * @param remote - the Remote face carrying `workspaceFiles.stat`.
 * @param changes - target-scoped change streams shared by file resources.
 * @param admission - the Host admission snapshot this registration is bound to;
 *   without `workspace-files.stat.v1` every open ends at once, and the change
 *   feed is followed only while `workspace-files.changes.v1` is advertised. An
 *   omitted snapshot serves every call.
 * @returns the provider to register into `ctx.resources`.
 */
export function createFileResourceProvider(
  remote: WorkspaceFilesRemote,
  changes: ChangeFeed,
  admission?: HostAdmission,
): ResourceProvider<'file'> {
  const capabilities = admission?.capabilities
  return {
    protocol: 'file',
    async *open(address, { signal }): AsyncIterable<RemoteResult<WorkspaceFileStat>> {
      signal = admission?.signal === undefined ? signal : AbortSignal.any([signal, admission.signal])
      const retired = (): boolean => signal.aborted
      // An explicit admission snapshot gates registration-level support; a
      // provider built without one serves every call.
      if (retired() || capabilities !== undefined && !capabilities.includes('workspace-files.stat.v1')) return
      const resolved = resolve(address)
      if (!resolved.ok) {
        yield resolved
        return
      }
      const { sessionId, path } = resolved.value
      // Queue changes delivered to this Client while stat is pending. The feed
      // is followed whenever support is unknown; an admission without
      // `workspace-files.changes.v1` pays for no stream.
      const notices = capabilities === undefined || capabilities.includes('workspace-files.changes.v1')
        ? changes.follow(sessionId, path, signal) : undefined
      const stat = (): Promise<RemoteResult<WorkspaceFileStat>> => remote.workspaceFiles.stat(sessionId, path, signal)
      // Undefined while the last stat failed: the follow is on the address, not
      // on the file, so a write can still bring the file live.
      let current: WorkspaceFileStat | undefined
      try {
        if (notices !== undefined && !await notices.ready) {
          // Observation ended before ready, including `watch-unsupported`: one
          // fallback stat unless the holder already left.
          if (retired()) return
          const result = await stat()
          if (!retired()) yield result
          return
        }
        if (retired()) return
        const first = await stat()
        if (retired()) return
        if (first.ok) {
          notices?.bind(first.value.absolutePath)
          current = first.value
          yield { ok: true, value: current }
        } else {
          yield first
        }
        if (notices === undefined) return
        for await (const notice of notices) {
          if (retired()) return
          if (current === undefined) {
            // Still gone: nothing new to report.
            if (notice.kind === 'absent') continue
          } else if (notice.kind === 'changed') {
            // Frames report observations: holding this version already means the
            // consumer learns nothing new. A different version always re-stats:
            // the refresh rebinds the canonical path a misrouted frame could
            // otherwise hide behind notice versions.
            if (notice.version === current.version) continue
          }
          // A Host notice may mean stale content.
          const again = await stat()
          if (retired()) return
          if (!again.ok) {
            current = undefined
            yield again
            continue
          }
          notices.bind(again.value.absolutePath)
          current = again.value
          yield { ok: true, value: current }
        }
      } finally {
        notices?.dispose()
      }
    },
  }
}

/**
 * Resolve one address to the Host call it stands for, or to the failure frame it earns.
 * @param address - the full address, scheme included.
 * @returns the Host file, or the `unsupported-address` / `unknown-workspace` failure.
 */
function resolve(address: string): RemoteResult<HostFile> {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) return { ok: false, error: unsupportedAddress(address) }
  if (parsed.scope === 'session') {
    // The address is a string boundary: its id segment is the Session id it names.
    const sessionId = parsed.sessionId as SessionId
    return { ok: true, value: { sessionId, path: parsed.path } }
  }
  return { ok: false, error: unknownWorkspace(address) }
}

/**
 * The failure frame's error for an address this provider does not serve.
 * @param address - the offending address.
 * @returns the typed error.
 */
function unsupportedAddress(address: string): RemoteError<'workspace-file/unsupported-address'> {
  return new RemoteError(
    'workspace-file/unsupported-address',
    `${address} is not a dsh-resource://file/session/<sessionId>/<path> or dsh-resource://file/absolute/<path> address`,
    { address },
  )
}

/**
 * The failure frame's error for an absolute address with no Session.
 * @param address - the offending address.
 * @returns the typed error.
 */
function unknownWorkspace(address: string): RemoteError<'workspace-file/unknown-workspace'> {
  return new RemoteError(
    'workspace-file/unknown-workspace',
    `${address} requires a dsh-resource://file/session/<sessionId>/<path> address`,
    { address },
  )
}
