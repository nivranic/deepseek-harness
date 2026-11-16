/** Copy validation diagnostics into the Remote protocol without validator metadata. */

import type { RemoteValidationIssue } from './types.ts'

/**
 * Retain diagnostic codes, messages and field paths, omitting all other fields.
 * Symbol path components become diagnostic strings; messages are not redacted.
 * @param issues - validation results from an owner, such as Zod issues.
 * @returns independent JSON-compatible diagnostics in their original order.
 */
export function remoteValidationIssues(issues: readonly {
  readonly code: string
  readonly message: string
  readonly path: readonly PropertyKey[]
}[]): readonly RemoteValidationIssue[] {
  return issues.map(({ code, message, path }) => ({
    code, message, path: path.map(key => typeof key === 'symbol' ? String(key) : key),
  }))
}
