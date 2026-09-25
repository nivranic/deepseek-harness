/** Shared syntax grammars keep old/new hunk state separate and preserve text. */
import { describe, expect, it } from 'vitest'
import { diffFiles } from '../src/client/diff/files.ts'
import { parseUnifiedDiff } from '../src/client/diff/parse.ts'
import { highlightDiffRows } from '../src/client/diff/syntax.ts'

describe('diff syntax', () => {
  it('highlights TypeScript while preserving source text and independent side state', () => {
    const rows = parseUnifiedDiff('--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-/* old comment\n-old */\n+const value = 1\n+export { value }')
    const highlighted = highlightDiffRows(rows, diffFiles(rows))
    for (const [index, spans] of highlighted) expect(spans.map(span => span.text).join('')).toBe(rows[index]!.text)
    expect(highlighted.get(5)?.some(span => span.style.color !== highlighted.get(5)?.[0]?.style.color)).toBe(true)
    expect(highlighted.get(3)?.map(span => span.style.color)).not.toEqual(highlighted.get(5)?.map(span => span.style.color))
  })

  it('uses plain text when no filename or supported grammar is available', () => {
    for (const text of ['@@ -1 +1 @@\n-old\n+new', '--- a/x.unknown\n+++ b/x.unknown\n@@ -1 +1 @@\n-old\n+new']) {
      const rows = parseUnifiedDiff(text)
      expect(highlightDiffRows(rows, diffFiles(rows)).size).toBe(0)
    }
  })
})
