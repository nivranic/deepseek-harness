/** The shared diff corpus through the unified-text parser: gutters, notes, and +/- counts. */
import { describe, expect, it } from 'vitest'
import { DIFF_CORPUS } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffCorpusHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseUnifiedDiff } from '../src/client/diff/parse.ts'
import type { DiffRow } from '../src/client/diff/parse.ts'

/** The unified text a preview page would accumulate for the corpus hunks. */
function unifiedText(hunks: readonly DiffCorpusHunk[]): string {
  return hunks.flatMap(hunk => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines]).join('\n')
}

/** The rows the parser must produce, numbering both gutters hunk by hunk. */
function expectedRows(hunks: readonly DiffCorpusHunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    rows.push({ type: 'hunk', text: header, oldStart: hunk.oldStart, newStart: hunk.newStart })
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) rows.push({ type: 'note', text: line })
      else if (line.startsWith('+')) rows.push({ type: 'add', text: line.slice(1), newLine: newLine++ })
      else if (line.startsWith('-')) rows.push({ type: 'del', text: line.slice(1), oldLine: oldLine++ })
      else rows.push({ type: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return rows
}

describe('parseUnifiedDiff over the shared diff corpus', () => {
  for (const { name, hunks, patchAdded, patchRemoved } of DIFF_CORPUS) {
    it(`parses the pinned unified text for ${name}`, () => {
      const rows = parseUnifiedDiff(unifiedText(hunks))
      expect(rows).toEqual(expectedRows(hunks))
      expect(rows.filter(row => row.type === 'add')).toHaveLength(patchAdded)
      expect(rows.filter(row => row.type === 'del')).toHaveLength(patchRemoved)
    })
  }
})
