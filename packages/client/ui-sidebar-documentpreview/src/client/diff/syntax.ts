/** Each diff hunk highlights its old and new fragments independently. */
import { highlightLines, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import { languageForPath } from '../code/languages.ts'
import type { DiffFile } from './files.ts'
import type { DiffRow } from './parse.ts'

/**
 * Highlight loaded hunk fragments with the shared grammar registry. Context uses
 * the new side's grammar state; missing file names and grammars stay plain.
 * @param rows - loaded patch rows.
 * @param files - file metadata associated with those rows.
 * @returns highlighted spans indexed by display row; callers observe grammar loads before recalculating.
 */
export function highlightDiffRows(
  rows: readonly DiffRow[], files: ReadonlyMap<number, DiffFile>,
): ReadonlyMap<number, readonly HighlightSpan[]> {
  const result = new Map<number, readonly HighlightSpan[]>()
  let old: { index: number; text: string }[] = []
  let next: { index: number; text: string }[] = []
  let file: DiffFile | undefined
  const flush = (): void => {
    for (const [side, path] of [[old, file?.oldPath], [next, file?.newPath]] as const) {
      if (side.length === 0 || path === undefined) continue
      const tokens = highlightLines(side.map(line => line.text).join('\n'), languageForPath(path))
      if (tokens === undefined) continue
      for (const [index, line] of side.entries()) result.set(line.index, tokens[index] ?? [])
    }
    old = []
    next = []
  }
  for (const [index, row] of rows.entries()) {
    if (row.type === 'hunk' || row.type === 'preamble') {
      flush()
      file = files.get(index)
    }
    if (row.type === 'context' || row.type === 'del') old.push({ index, text: row.text })
    if (row.type === 'context' || row.type === 'add') next.push({ index, text: row.text })
  }
  flush()
  return result
}
