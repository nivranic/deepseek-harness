/** Pure unified-to-split row pairing for the side-by-side diff view; no React or DOM here. */
import type { DiffRow } from './parse.ts'

/** A unified row that carries its own source line: the rows a split side can render. */
export type DiffChangeRow = Extract<DiffRow, { type: 'context' | 'del' | 'add' }>

/** One half of a paired split row. */
export interface SplitSide {
  /** Display index of the unified row this side renders; keys the shared syntax-span map. */
  readonly index: number
  /** The unified row whose type drives this side's gutter and colouring. */
  readonly source: DiffChangeRow
}

/** One visual split row: a full-width structural line, or one paired old/new line. */
export type SplitRow =
  | { readonly type: 'preamble' | 'hunk' | 'note'; readonly text: string; readonly index: number }
  | { readonly type: 'pair'; readonly old: SplitSide | undefined; readonly next: SplitSide | undefined }

/**
 * Pair parsed unified rows for the side-by-side view. Context lines appear on both
 * sides; one context-free run of removed and added lines pairs positionally
 * (first removal with first addition), the longer side's tail pairing against an
 * absent opposite. Preamble, hunk, and note rows stay full-width and keep their
 * unified index for file links and syntax spans.
 * @param rows - parsed loaded patch rows.
 * @returns the split rows, one per visual line, in patch order.
 */
export function splitRows(rows: readonly DiffRow[]): readonly SplitRow[] {
  const result: SplitRow[] = []
  let dels: SplitSide[] = []
  let adds: SplitSide[] = []
  const flush = (): void => {
    for (let pair = 0; pair < Math.max(dels.length, adds.length); pair++) {
      result.push({ type: 'pair', old: dels[pair], next: adds[pair] })
    }
    dels = []
    adds = []
  }
  for (const [index, row] of rows.entries()) {
    if (row.type === 'del') {
      dels.push({ index, source: row })
      continue
    }
    if (row.type === 'add') {
      adds.push({ index, source: row })
      continue
    }
    flush()
    if (row.type === 'context') result.push({ type: 'pair', old: { index, source: row }, next: { index, source: row } })
    else result.push({ type: row.type, text: row.text, index })
  }
  flush()
  return result
}
