/** `node:sea` detection for a browser worker, which cannot be a Node single executable application. */

/**
 * Detect whether this runtime is a Node single executable application.
 * @returns false because the browser worker has no Node executable or embedded SEA assets.
 */
export function isSea(): boolean {
  return false
}

/** CommonJS interop marker for the worker module loader. */
export const __esModule = true

/** SEA detection shared by static imports and the worker's module table. */
export default { isSea } satisfies Partial<typeof import('node:sea')>
