/** Unified-diff file headers and body numbering follow the declared hunk extents. */
import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../src/client/diff/parse.ts'

describe('unified-diff hunk extents', () => {
  it('keeps the next file headers outside a completed hunk', () => {
    const rows = parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new\n--- a/second.ts\n+++ b/second.ts\n@@ -4 +4 @@\n-before\n+after')
    expect(rows.slice(3, 5)).toEqual([
      { type: 'preamble', text: '--- a/second.ts' },
      { type: 'preamble', text: '+++ b/second.ts' },
    ])
    expect(rows.at(-1)).toEqual({ type: 'add', text: 'after', newLine: 4 })
  })

  it('ends an incomplete hunk when the next git file section starts', () => {
    const rows = parseUnifiedDiff('@@ -1,8 +1,8 @@\n-old\n+new\ndiff --git a/second b/second\n--- a/second\n+++ b/second')
    expect(rows.slice(3).map(row => row.type)).toEqual(['preamble', 'preamble', 'preamble'])
  })

  it('preserves header-like source lines while their side still has capacity', () => {
    expect(parseUnifiedDiff('@@ -1 +1 @@\n--- source\n+++ source').slice(1)).toEqual([
      { type: 'del', text: '-- source', oldLine: 1 },
      { type: 'add', text: '++ source', newLine: 1 },
    ])
  })

  it('numbers only the declared new-file lines and retains excess input visibly', () => {
    expect(parseUnifiedDiff('@@ -0,0 +1,2 @@\n+first\n+second\n+excess').slice(1)).toEqual([
      { type: 'add', text: 'first', newLine: 1 },
      { type: 'add', text: 'second', newLine: 2 },
      { type: 'preamble', text: '+excess' },
    ])
  })

  it('requires capacity on both sides for a context line', () => {
    expect(parseUnifiedDiff('@@ -0,0 +1 @@\n context\n+new').slice(1)).toEqual([
      { type: 'preamble', text: ' context' },
      { type: 'add', text: 'new', newLine: 1 },
    ])
  })

  it('retains a no-newline marker after the final body line without assigning gutters', () => {
    expect(parseUnifiedDiff('@@ -1 +0,0 @@\n-old\n\\ No newline at end of file').at(-1))
      .toEqual({ type: 'note', text: '\\ No newline at end of file' })
  })

  it('does not assign imprecise line numbers from unsafe hunk coordinates', () => {
    const rows = parseUnifiedDiff('@@ -9007199254740992 +1 @@\n-old\n+new')
    expect(rows.map(row => row.type)).toEqual(['preamble', 'preamble', 'preamble'])
  })
})
