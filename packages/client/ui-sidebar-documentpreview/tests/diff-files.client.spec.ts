/** File metadata comes from preambles, including quoted Git names and partial files. */
import { describe, expect, it } from 'vitest'
import { diffFiles } from '../src/client/diff/files.ts'
import { parseUnifiedDiff } from '../src/client/diff/parse.ts'

describe('diff file metadata', () => {
  it('decodes a quoted UTF-8 Git path and discards only its Git prefix', () => {
    const text = 'diff --git "a/\\344\\270\\255.ts" "b/\\344\\270\\255.ts"\n--- "a/\\344\\270\\255.ts"\n+++ "b/\\344\\270\\255.ts"\n@@ -1 +1 @@\n-old\n+new'
    expect(diffFiles(parseUnifiedDiff(text)).get(5)).toEqual({ oldPath: '中.ts', newPath: '中.ts', actionRow: 2 })
  })

  it('preserves spaces and plain non-Git directory names', () => {
    const rows = parseUnifiedDiff('--- old dir/file.ts\tdate\n+++ new dir/file.ts\tdate\n@@ -1 +1 @@\n-before\n+after')
    expect(diffFiles(rows).get(2)).toEqual({ oldPath: 'old dir/file.ts', newPath: 'new dir/file.ts', actionRow: 1 })
  })

  it('associates separate files while ignoring header-like deleted content', () => {
    const rows = parseUnifiedDiff('--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n--- content\n+++ content\n--- a/two.py\n+++ b/two.py\n@@ -1 +1 @@\n-old\n+new')
    const files = diffFiles(rows)
    expect(files.get(3)?.newPath).toBe('one.ts')
    expect(files.get(9)?.newPath).toBe('two.py')
  })

  it('keeps partial hunks available without invoking strict body validation', () => {
    const rows = parseUnifiedDiff('--- a/x.ts\n+++ b/x.ts\n@@ -1,100 +1,100 @@\n first')
    expect(diffFiles(rows).get(3)?.newPath).toBe('x.ts')
  })

  it('has no current-file action for a deletion and handles a new Git file', () => {
    const deleted = parseUnifiedDiff('diff --git a/old.ts b/old.ts\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old')
    expect(diffFiles(deleted).get(4)).toEqual({ oldPath: 'old.ts', newPath: undefined, actionRow: undefined })
    const added = parseUnifiedDiff('diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+new')
    expect(diffFiles(added).get(4)).toEqual({ oldPath: undefined, newPath: 'new.ts', actionRow: 2 })
  })

  it('finds renamed binary targets without a textual hunk', () => {
    const rows = parseUnifiedDiff('diff --git a/old.png b/new.png\nsimilarity index 100%\nrename from old.png\nrename to new.png')
    expect(diffFiles(rows).get(0)).toEqual({ oldPath: 'old.png', newPath: 'new.png', actionRow: 0 })
  })

  it('leaves anonymous fragments and NUL filenames without open targets', () => {
    expect(diffFiles(parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new')).size).toBe(0)
    const rows = parseUnifiedDiff('--- a/old\n+++ "b/\\000bad"\n@@ -1 +1 @@\n-old\n+new')
    expect(diffFiles(rows).get(4)?.newPath).toBeUndefined()
  })

  it('keeps library-rejected headers visible without a target', () => {
    const rows = parseUnifiedDiff('--- a/x.ts\n+++ b/x.ts\n@@ -1,9007199254740992 +1 @@')
    expect(diffFiles(rows).size).toBe(0)
    expect(rows.map(row => row.text)).toEqual(['--- a/x.ts', '+++ b/x.ts', '@@ -1,9007199254740992 +1 @@'])
  })
})
