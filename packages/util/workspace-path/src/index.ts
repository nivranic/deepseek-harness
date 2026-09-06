/**
 * Browser-safe Workspace path and display helpers.
 * @module @deepseek-ai/dsh-util-workspace-path
 */

/** Whether a path uses a Windows drive or UNC prefix. */
function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

function trimTrailingSeparators(value: string, windows: boolean): string {
  let end = value.length
  while (end > 0 && (value[end - 1] === '/' || (windows && value[end - 1] === '\\'))) end--
  return value.slice(0, end)
}

/**
 * Resolve a Workspace-relative path into the Host-facing spelling used by path operations.
 * @param cwd - Session Workspace root, when known.
 * @param path - Absolute or Workspace-relative path.
 * @returns an absolute path when a Workspace root is available, otherwise the original path.
 */
export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (path.startsWith('/') || isWindowsStylePath(path)) return path
  if (cwd === undefined || cwd === '') return path
  const base = trimTrailingSeparators(cwd, true)
  const relative = path.replace(/^[/\\]+/, '')
  return `${base}/${relative}`
}

/**
 * Abbreviate a POSIX home directory for display.
 * @param path - Absolute or already-short display path.
 * @param home - Host account home; absent skips abbreviation.
 * @returns `~` or `~/…` for the POSIX home and its descendants, otherwise `path`.
 */
export function abbreviateHomePath(path: string, home?: string): string {
  if (home === undefined || home === '') return path
  if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path
  const root = trimTrailingSeparators(home, false)
  if (root === '') return path
  if (trimTrailingSeparators(path, false) === root) return '~'
  if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`
  return path
}

/**
 * Read the final non-empty segment of a Workspace path for display.
 * Workspace-label surfaces use this helper instead of deriving another basename.
 * @param path - Workspace directory path using POSIX or Windows separators.
 * @returns the final segment, or an empty string for a separator-only path.
 */
export function workspaceTitleOf(path: string): string {
  const trimmed = trimTrailingSeparators(path, true)
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}
