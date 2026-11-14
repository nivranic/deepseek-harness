/** Identify immutable source copies retained by versioned handoff archives. */

/**
 * Distinguish captured evidence from the live tools that verify its hashes.
 * @param file - Repository-relative path with forward slash separators.
 * @returns Whether the file belongs to a dated handoff's frozen evidence tree.
 */
export function isFrozenHandoffEvidence(file: string): boolean {
  return /^artifacts\/upstream-first\/handoff\/\d{4}-\d{2}-\d{2}-\d+\/(?:uncommitted-files|resume-evidence)\//u.test(file)
}
