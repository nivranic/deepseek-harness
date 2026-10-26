import { describe, expect, it } from 'vitest'
import { DIFF_CORPUS } from '@deepseek-ai/dsh-client-ui-primitives'
import { promptDiffLines } from '../src/client/prompt-diff-lines.ts'
import type { DiffCorpusHunk } from '@deepseek-ai/dsh-client-ui-primitives'

/** The rows the corpus pins for {@link promptDiffLines}: headers kept, notes dropped. */
function expectedRows(hunks: readonly DiffCorpusHunk[]): { kind: 'meta' | 'context' | 'added' | 'removed'; text: string }[] {
  const rows: { kind: 'meta' | 'context' | 'added' | 'removed'; text: string }[] = []
  for (const [hunkIndex, hunk] of hunks.entries()) {
    if (hunkIndex > 0) rows.push({ kind: 'meta', text: '' })
    rows.push({ kind: 'meta', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` })
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue
      if (line.startsWith('+')) rows.push({ kind: 'added', text: line })
      else if (line.startsWith('-')) rows.push({ kind: 'removed', text: line })
      else rows.push({ kind: 'context', text: line })
    }
  }
  return rows
}

describe('promptDiffLines over the shared diff corpus', () => {
  for (const { name, before, after, hunks, patchAdded, patchRemoved } of DIFF_CORPUS) {
    it(`renders the pinned rows for ${name}`, () => {
      const rows = promptDiffLines(before, after)
      expect(rows).toEqual(expectedRows(hunks))
      expect(rows.filter(row => row.kind === 'added')).toHaveLength(patchAdded)
      expect(rows.filter(row => row.kind === 'removed')).toHaveLength(patchRemoved)
    })
  }
})
