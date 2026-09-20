/** Client presentation semantics for the merge-extensible Remote failure vocabulary. */

import { remoteErrorOf } from './remote-error.ts'

/**
 * Recovery semantics every Client surface agrees on for one failure code.
 * Classes describe what the Client may do next, never Host-side authority;
 * acceptance of an envelope grants no capability, permission, or retry policy.
 */
export type RemoteFailureClass =
  /** Authentication is required before an explicit retry of the same call. */
  | 'authentication'
  /** The Host refused the caller; retrying the unchanged request cannot succeed. */
  | 'permission'
  /** The Host is not ready for this request; the connection generation stays recoverable. */
  | 'host-state'
  /** Version or capability mismatch; terminal for the current connection generation. */
  | 'compatibility'
  /** Discovery or stream contract violation; the carrier cannot recover this generation. */
  | 'carrier-invalid'
  /** The transport was interrupted; mutation acceptance may be unknown on retry. */
  | 'transport'
  /** A stale revision conflicts with Host state; refresh local state before retrying. */
  | 'conflict'
  /** The addressed target does not exist (anymore) on the Host. */
  | 'unavailable'
  /** The caller's input is invalid; the unchanged request cannot succeed. */
  | 'invalid-input'
  /** Opaque diagnostic: an unclassified code that must stay presentable unchanged. */
  | 'unknown'

/**
 * Codes with agreed cross-Client semantics. The vocabulary is
 * merge-extensible, so unlisted codes deliberately resolve to `unknown`;
 * owners add entries here only when every Client can honor the same meaning.
 * Exported read-only for the repository verifier and future native projection.
 */
export const REMOTE_FAILURE_CLASSES: Readonly<Record<string, RemoteFailureClass>> = {
  'gateway/authentication-required': 'authentication',
  'device/admission-expired': 'authentication',
  'gateway/permission-denied': 'permission',
  'subagent/unauthorized': 'permission',
  'gateway/host-not-ready': 'host-state',
  'gateway/protocol-unsupported': 'compatibility',
  'host/protocol-unsupported': 'compatibility',
  'host/capability-unavailable': 'compatibility',
  'host/description-invalid': 'carrier-invalid',
  'gateway/preparation-unavailable': 'carrier-invalid',
  'gateway/stream-invalid': 'carrier-invalid',
  'gateway/transport-interrupted': 'transport',
  'gateway/connection-unavailable': 'transport',
  'revision-conflict': 'conflict',
  'session/revision-conflict': 'conflict',
  'session/not-found': 'unavailable',
  'session/queue-item-not-found': 'unavailable',
  'subagent/not-found': 'unavailable',
  'agent-preset/not-found': 'unavailable',
  'workspace/not-found': 'unavailable',
  'workspace-file/not-found': 'unavailable',
  'workspace-file/not-regular-file': 'unavailable',
  'workspace-file/not-directory': 'unavailable',
  'presented-file/not-found': 'unavailable',
  'session/attachment-invalid': 'invalid-input',
  'subagent/attachment-invalid': 'invalid-input',
  'session/title-invalid': 'invalid-input',
  'agent-preset/invalid': 'invalid-input',
  'workspace/invalid-path': 'invalid-input',
}

/**
 * Classify one Remote failure code for presentation.
 * @param code - code carried by a Remote failure envelope, known or unknown.
 * @returns the agreed class, or `unknown` for codes without cross-Client semantics.
 */
export function classifyRemoteFailureCode(code: string): RemoteFailureClass {
  return REMOTE_FAILURE_CLASSES[code] ?? 'unknown'
}

/**
 * Classify a caught value by its Remote failure code.
 * @param error - any caught value; non-Remote failures resolve to `unknown`.
 * @returns the agreed class for the carried code, preserving the original diagnostic.
 */
export function classifyRemoteFailure(error: unknown): RemoteFailureClass {
  const code = remoteErrorOf(error)?.code
  return code === undefined ? 'unknown' : classifyRemoteFailureCode(code)
}
