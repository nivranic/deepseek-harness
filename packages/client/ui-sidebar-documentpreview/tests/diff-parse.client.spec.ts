/** Pure unified-diff parsing: hunk headers, both gutters, notes, preamble, malformed body lines. */
import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../src/client/diff/parse.ts'

describe('parseUnifiedDiff', () => {
  it('returns no rows for empty text', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('keeps file headers and leading garbage as preamble rows', () => {
    const rows = parseUnifiedDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n old\n+new')
    expect(rows.slice(0, 3)).toEqual([
      { type: 'preamble', text: 'diff --git a/x b/x' },
      { type: 'preamble', text: '--- a/x' },
      { type: 'preamble', text: '+++ b/x' },
    ])
  })

  it('parses hunk headers with counts and keeps the section heading in the row text', () => {
    const rows = parseUnifiedDiff('@@ -3,7 +3,8 @@ function run() {\n context')
    expect(rows[0]).toEqual({ type: 'hunk', text: '@@ -3,7 +3,8 @@ function run() {', oldStart: 3, newStart: 3 })
  })

  it('treats a missing count as one line and numbers both gutters across types', () => {
    const rows = parseUnifiedDiff('@@ -10 +12 @@\n context\n-gone\n+fresh\n keep')
    expect(rows.slice(1)).toEqual([
      { type: 'context', text: 'context', oldLine: 10, newLine: 12 },
      { type: 'del', text: 'gone', oldLine: 11 },
      { type: 'add', text: 'fresh', newLine: 13 },
      { type: 'context', text: 'keep', oldLine: 12, newLine: 14 },
    ])
  })

  it('restarts numbering at each hunk header', () => {
    const rows = parseUnifiedDiff('@@ -1 +1 @@\n-a\n+b\n@@ -50,2 +60,2 @@\n c\n-d')
    expect(rows[0]).toMatchObject({ type: 'hunk', oldStart: 1, newStart: 1 })
    expect(rows[3]).toMatchObject({ type: 'hunk', oldStart: 50, newStart: 60 })
    expect(rows[4]).toEqual({ type: 'context', text: 'c', oldLine: 50, newLine: 60 })
    expect(rows[5]).toEqual({ type: 'del', text: 'd', oldLine: 51 })
  })

  it('carries no-newline notes without line numbers and keeps numbering still', () => {
    const rows = parseUnifiedDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b')
    expect(rows[2]).toEqual({ type: 'note', text: '\\ No newline at end of file' })
    expect(rows[3]).toEqual({ type: 'add', text: 'b', newLine: 1 })
  })

  it('shows a body line without a hunk prefix as preamble instead of numbering it', () => {
    const rows = parseUnifiedDiff('@@ -1,2 +1,2 @@\n ok\nbroken\n+next')
    expect(rows[2]).toEqual({ type: 'preamble', text: 'broken' })
    expect(rows[3]).toEqual({ type: 'add', text: 'next', newLine: 2 })
  })

  it('treats a plus or minus line before any hunk as preamble', () => {
    const rows = parseUnifiedDiff('+early\n@@ -1 +1 @@\n one')
    expect(rows[0]).toEqual({ type: 'preamble', text: '+early' })
    expect(rows[2]).toEqual({ type: 'context', text: 'one', oldLine: 1, newLine: 1 })
  })
})
