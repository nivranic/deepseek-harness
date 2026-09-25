/** File metadata from unified-diff preambles; body parsing remains tolerant of incomplete pages. */
import { parsePatch } from 'diff'
import type { StructuredPatch } from 'diff'
import type { DiffRow } from './parse.ts'

/** One patch file's decoded paths and the row that can open its current workspace version. */
export interface DiffFile {
  readonly oldPath: string | undefined
  readonly newPath: string | undefined
  readonly actionRow: number | undefined
}

/** Exclude null-device sentinels and filenames that cannot address a filesystem entry. */
function usablePath(path: string | undefined): string | undefined {
  return path === undefined || path === '' || path === '/dev/null' || path.includes('\0') ? undefined : path
}

/** Read only headers: a partial body must not trigger the library's strict hunk validator. */
function readFile(headers: readonly string[], offset: number): DiffFile | undefined {
  let parsed: StructuredPatch[]
  try {
    parsed = parsePatch(headers.join('\n'))
  } catch {
    // Malformed patch headers remain visible but cannot offer a decoded file target.
    return undefined
  }
  const file = parsed.at(-1)
  if (file === undefined) return undefined
  const old = usablePath(file.oldFileName)
  const next = usablePath(file.newFileName)
  const prefixed = file.isGit === true || old?.startsWith('a/') === true && next?.startsWith('b/') === true
  const oldPath = old !== undefined && prefixed && old.startsWith('a/') ? old.slice(2) : old
  const newPath = next !== undefined && prefixed && next.startsWith('b/') ? next.slice(2) : next
  if (oldPath === undefined && newPath === undefined) return undefined
  const newHeader = headers.findIndex(line => line.startsWith('+++ '))
  const gitHeader = headers.findIndex(line => line.startsWith('diff --git '))
  const action = newHeader >= 0 ? newHeader : gitHeader
  return { oldPath, newPath, actionRow: newPath === undefined || action < 0 ? undefined : offset + action }
}

/**
 * Associate displayed rows with their file preamble, including Git C-quoted names.
 * Only preamble rows contribute filenames; header-like body text stays source.
 * @param rows - parsed loaded patch rows.
 * @returns file metadata indexed by each associated display row.
 */
export function diffFiles(rows: readonly DiffRow[]): ReadonlyMap<number, DiffFile> {
  const files = new Map<number, DiffFile>()
  let current: DiffFile | undefined
  let headerEnd = 0
  for (const [index, row] of rows.entries()) {
    if (index >= headerEnd && row.type === 'preamble' && (row.text.startsWith('diff --git ') || row.text.startsWith('--- '))) {
      const headers: string[] = []
      for (let end = index; end < rows.length; end++) {
        const candidate = rows[end] as DiffRow
        if (candidate.type !== 'preamble' || end > index && (candidate.text.startsWith('diff --git ')
          || candidate.text.startsWith('--- ') && headers.some(header => header.startsWith('--- ')))) break
        headers.push(candidate.text)
        headerEnd = end + 1
      }
      current = readFile(headers, index)
    }
    if (current !== undefined) files.set(index, current)
  }
  return files
}
