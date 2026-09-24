/** Pure unified-diff parsing for the diff document preview; no React or DOM here. */

/** A hunk header's captured line counts; a missing count means one line. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u

/** One parsed display row of a unified diff, retaining source line positions. */
export type DiffRow =
  | { readonly type: 'preamble'; readonly text: string }
  | {
    readonly type: 'hunk'
    readonly text: string
    readonly oldStart: number
    readonly newStart: number
  }
  | { readonly type: 'context'; readonly text: string; readonly oldLine: number; readonly newLine: number }
  | { readonly type: 'add'; readonly text: string; readonly newLine: number }
  | { readonly type: 'del'; readonly text: string; readonly oldLine: number }
  | { readonly type: 'note'; readonly text: string }

/**
 * Parse accumulated unified-diff text into display rows. Lines before the first
 * hunk header stay visible as preamble (`---`/`+++` file headers included); a
 * body line without a hunk prefix — a truncated or malformed hunk — is shown as
 * preamble too rather than dropped or numbered. `\`-prefixed notes such as the
 * missing trailing newline carry no line numbers. The closed vocabulary ends at
 * these six row types.
 * @param text - unified-diff text; pages join with `\n` and carry no trailing terminator.
 * @returns the parsed rows, empty for empty text.
 */
export function parseUnifiedDiff(text: string): readonly DiffRow[] {
  if (text === '') return []
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const line of text.split('\n')) {
    const header = HUNK_HEADER.exec(line)
    if (header !== null) {
      oldLine = Number(header[1])
      newLine = Number(header[3])
      inHunk = true
      rows.push({ type: 'hunk', text: line, oldStart: oldLine, newStart: newLine })
      continue
    }
    if (inHunk && line.startsWith(' ')) {
      rows.push({ type: 'context', text: line.slice(1), oldLine: oldLine, newLine })
      oldLine += 1
      newLine += 1
      continue
    }
    if (inHunk && line.startsWith('-')) {
      rows.push({ type: 'del', text: line.slice(1), oldLine })
      oldLine += 1
      continue
    }
    if (inHunk && line.startsWith('+')) {
      rows.push({ type: 'add', text: line.slice(1), newLine })
      newLine += 1
      continue
    }
    if (inHunk && line.startsWith('\\')) {
      rows.push({ type: 'note', text: line })
      continue
    }
    rows.push({ type: 'preamble', text: line })
  }
  return rows
}
