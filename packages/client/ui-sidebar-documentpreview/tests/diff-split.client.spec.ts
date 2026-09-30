/** Pure unified-to-split pairing: replacement alignment, runs, and structural rows. */
import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../src/client/diff/parse.ts'
import { splitRows, type SplitRow } from '../src/client/diff/split.ts'

const splitOf = (text: string): readonly SplitRow[] => splitRows(parseUnifiedDiff(text))

/** Narrow to the pair variant; structural rows return undefined for side access. */
const pairOf = (row: SplitRow | undefined): Extract<SplitRow, { type: 'pair' }> | undefined =>
  row?.type === 'pair' ? row : undefined

describe('splitRows', () => {
  it('pairs a replacement block positionally and keeps context on both sides', () => {
    const rows = splitOf('@@ -2,4 +2,4 @@\n ctx\n-gone\n-old\n+fresh\n+new\n tail')
    expect(rows.map(row => row.type)).toEqual(['hunk', 'pair', 'pair', 'pair', 'pair'])
    const context = pairOf(rows[1])!
    expect(context.old?.source).toBe(context.next?.source)
    expect(context.old?.source.type).toBe('context')
    const first = pairOf(rows[2])!
    const second = pairOf(rows[3])!
    expect([first.old?.source.text, first.next?.source.text]).toEqual(['gone', 'fresh'])
    expect([second.old?.source.text, second.next?.source.text]).toEqual(['old', 'new'])
    const tail = pairOf(rows[4])!
    expect(tail.old?.source.text).toBe('tail')
    expect(tail.next?.source.text).toBe('tail')
  })

  it('pairs a pure deletion against absent additions and a pure insertion against absent removals', () => {
    const removal = splitOf('@@ -1,2 +1,1 @@\n ctx\n-only')
    expect(pairOf(removal[2])?.old?.source.text).toBe('only')
    expect(pairOf(removal[2])?.next).toBeUndefined()
    const insertion = splitOf('@@ -1,1 +1,2 @@\n ctx\n+added')
    expect(pairOf(insertion[2])?.old).toBeUndefined()
    expect(pairOf(insertion[2])?.next?.source.text).toBe('added')
  })

  it('pairs the longer side tail beyond the shorter side', () => {
    const rows = splitOf('@@ -1,4 +1,2 @@\n-a\n-b\n+x')
    expect(rows.map(row => row.type)).toEqual(['hunk', 'pair', 'pair'])
    expect([pairOf(rows[1])?.old?.source.text, pairOf(rows[1])?.next?.source.text]).toEqual(['a', 'x'])
    expect([pairOf(rows[2])?.old?.source.text, pairOf(rows[2])?.next]).toEqual(['b', undefined])
  })

  it('flushes pending pairs at hunk and preamble boundaries and keeps structural rows full-width', () => {
    const rows = splitOf('preamble\n@@ -1,2 +1,2 @@\n-a\n+x\n@@ -5,1 +5,1 @@\n-y\n+y')
    expect(rows.map(row => row.type)).toEqual(['preamble', 'hunk', 'pair', 'hunk', 'pair'])
    expect(rows[0]).toMatchObject({ type: 'preamble', text: 'preamble', index: 0 })
    expect(rows[2]?.type).toBe('pair')
  })

  it('keeps unified indices on every side so syntax spans and file links address the source rows', () => {
    const rows = splitOf('@@ -1,3 +1,3 @@\n ctx\n-gone\n+fresh')
    expect(pairOf(rows[1])?.old?.index).toBe(1)
    expect(pairOf(rows[1])?.next?.index).toBe(1)
    expect(pairOf(rows[2])?.old?.index).toBe(2)
    expect(pairOf(rows[2])?.next?.index).toBe(3)
  })

  it('returns no rows for empty input', () => {
    expect(splitOf('')).toEqual([])
  })
})
