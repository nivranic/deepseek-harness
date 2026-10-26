/** The trajectory transcript's prompt-diff rows, computed from jsdiff hunks. */
import { structuredPatch } from 'diff'

/** One rendered prompt-diff row: a hunk-header/meta line or a prefixed body line. */
export interface PromptDiffLine {
  kind: 'meta' | 'context' | 'added' | 'removed'
  text: string
}

/**
 * Diff two prompt texts into display rows: one `meta` header per hunk, a blank
 * `meta` separator before every hunk after the first, and each hunk line by its
 * prefix. `\`-prefixed notes (the missing trailing newline) carry no display
 * meaning here and are dropped. Identical inputs yield no rows, so the owning
 * section renders nothing.
 * @param before - the prior prompt text.
 * @param after - the current prompt text.
 * @returns the display rows, empty when the texts are equal.
 */
export function promptDiffLines(before: string, after: string): readonly PromptDiffLine[] {
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: 3 })
  return patch.hunks.flatMap((hunk, hunkIndex) => [
    ...(hunkIndex === 0 ? [] : [{ kind: 'meta' as const, text: '' }]),
    {
      kind: 'meta' as const,
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    },
    ...hunk.lines.flatMap((line): PromptDiffLine[] => {
      if (line.startsWith('\\')) return []
      if (line.startsWith('+')) return [{ kind: 'added', text: line }]
      if (line.startsWith('-')) return [{ kind: 'removed', text: line }]
      return [{ kind: 'context', text: line }]
    }),
  ])
}
