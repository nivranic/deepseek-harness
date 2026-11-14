/**
 * Client-namespace projection of the host-diagnostics vocabulary: a pure
 * re-export of the package's types outlet, so Client code imports ONLY the
 * client namespace while `./types` serves the same single-source content to
 * host consumers.
 * @module @deepseek-ai/dsh-api-host-diagnostics/client
 */

export type * from './types.ts'
