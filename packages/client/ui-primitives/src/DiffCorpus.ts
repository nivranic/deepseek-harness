/**
 * A pinned cross-renderer diff corpus: one set of before/after pairs whose
 * jsdiff `structuredPatch('', '', before, after, undefined, undefined,
 * { context: 3 })` output, full-side line counts, and unified-text parse are
 * recorded here so the diff consumers (this package's whole-file side counter,
 * the trajectory prompt diff, and the document preview's unified parser) stay
 * provably aligned on the same inputs.
 */

/** One hunk of a corpus case, in jsdiff `structuredPatch` hunk shape. */
export interface DiffCorpusHunk {
  /** Source-side start line (1-based; `1` with zero `oldLines` for a create). */
  readonly oldStart: number
  /** Count of source-side lines the hunk covers. */
  readonly oldLines: number
  /** Target-side start line (1-based; `1` with zero `newLines` for a delete). */
  readonly newStart: number
  /** Count of target-side lines the hunk covers. */
  readonly newLines: number
  /** Prefixed hunk lines: `' '` context, `'-'` removed, `'+'` added, `'\\'` note. */
  readonly lines: readonly string[]
}

/** One corpus case: a before/after pair plus every consumer's pinned answer. */
export interface DiffCorpusCase {
  /** Stable case id, used as the test title at every consumer. */
  readonly name: string
  /** Full source-side text (`''` for a create). */
  readonly before: string
  /** Full target-side text (`''` for a delete). */
  readonly after: string
  /** `structuredPatch` hunks at `context: 3`; empty for an identical pair. */
  readonly hunks: readonly DiffCorpusHunk[]
  /** `+`-prefixed line count summed over hunks. */
  readonly patchAdded: number
  /** `-`-prefixed line count summed over hunks. */
  readonly patchRemoved: number
  /** Old-side content-line count under `contentLines`'s terminator rule. */
  readonly oldContentLines: number
  /** New-side content-line count under `contentLines`'s terminator rule. */
  readonly newContentLines: number
}

/**
 * The pinned corpus. Values were captured from the real jsdiff output; each
 * consumer's spec asserts its own view against these instead of re-deriving
 * them, so a library upgrade or consumer rewrite that drifts any pinned field
 * fails at the owning spec.
 */
export const DIFF_CORPUS: readonly DiffCorpusCase[] = [
  {
    name: 'singleLineReplace',
    before: 'alpha',
    after: 'beta',
    hunks: [{
      oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
      lines: ['-alpha', '\\ No newline at end of file', '+beta', '\\ No newline at end of file'],
    }],
    patchAdded: 1,
    patchRemoved: 1,
    oldContentLines: 1,
    newContentLines: 1,
  },
  {
    name: 'trailingNewlineAdded',
    before: 'a\nb',
    after: 'a\nb\n',
    hunks: [{
      oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
      lines: [' a', '-b', '\\ No newline at end of file', '+b'],
    }],
    patchAdded: 1,
    patchRemoved: 1,
    oldContentLines: 2,
    newContentLines: 2,
  },
  {
    name: 'identical',
    before: 'same\nlines\n',
    after: 'same\nlines\n',
    hunks: [],
    patchAdded: 0,
    patchRemoved: 0,
    oldContentLines: 2,
    newContentLines: 2,
  },
  {
    name: 'create',
    before: '',
    after: 'new\nfile\ncontent\n',
    hunks: [{
      oldStart: 1, oldLines: 0, newStart: 1, newLines: 3,
      lines: ['+new', '+file', '+content'],
    }],
    patchAdded: 3,
    patchRemoved: 0,
    oldContentLines: 0,
    newContentLines: 3,
  },
  {
    name: 'delete',
    before: 'gone\naway\n',
    after: '',
    hunks: [{
      oldStart: 1, oldLines: 2, newStart: 1, newLines: 0,
      lines: ['-gone', '-away'],
    }],
    patchAdded: 0,
    patchRemoved: 2,
    oldContentLines: 2,
    newContentLines: 0,
  },
  {
    name: 'scatteredHunks',
    before: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n',
    after: 'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n',
    hunks: [{
      oldStart: 1, oldLines: 10, newStart: 1, newLines: 10,
      lines: [' l1', '-l2', '+L2', ' l3', ' l4', ' l5', ' l6', ' l7', ' l8', '-l9', '+L9', ' l10'],
    }],
    patchAdded: 2,
    patchRemoved: 2,
    oldContentLines: 10,
    newContentLines: 10,
  },
  {
    name: 'farScattered',
    before: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\nl14\nl15\nl16\nl17\nl18\nl19\nl20\n',
    after: 'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\nl14\nl15\nl16\nl17\nl18\nL19\nl20\n',
    hunks: [
      { oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, lines: [' l1', '-l2', '+L2', ' l3', ' l4', ' l5'] },
      { oldStart: 16, oldLines: 5, newStart: 16, newLines: 5, lines: [' l16', ' l17', ' l18', '-l19', '+L19', ' l20'] },
    ],
    patchAdded: 2,
    patchRemoved: 2,
    oldContentLines: 20,
    newContentLines: 20,
  },
  {
    name: 'cjkEmoji',
    before: '报告 📊 v1\nsecond\n',
    after: '报告 📊 v2\nsecond\n',
    hunks: [{
      oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
      lines: ['-报告 📊 v1', '+报告 📊 v2', ' second'],
    }],
    patchAdded: 1,
    patchRemoved: 1,
    oldContentLines: 2,
    newContentLines: 2,
  },
  {
    name: 'crlf',
    before: 'a\r\nb\r\n',
    after: 'a\r\nB\r\n',
    hunks: [{
      oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
      lines: [' a\r', '-b\r', '+B\r'],
    }],
    patchAdded: 1,
    patchRemoved: 1,
    oldContentLines: 2,
    newContentLines: 2,
  },
  {
    name: 'blankLineChange',
    before: 'x\n\ny\n',
    after: 'x\ny\n',
    hunks: [{
      oldStart: 1, oldLines: 3, newStart: 1, newLines: 2,
      lines: [' x', '-', ' y'],
    }],
    patchAdded: 0,
    patchRemoved: 1,
    oldContentLines: 3,
    newContentLines: 2,
  },
  {
    name: 'blockReplace',
    before: 'one\ntwo\nthree\n',
    after: 'ONE\nTWO\nTHREE\nFOUR\n',
    hunks: [{
      oldStart: 1, oldLines: 3, newStart: 1, newLines: 4,
      lines: ['-one', '-two', '-three', '+ONE', '+TWO', '+THREE', '+FOUR'],
    }],
    patchAdded: 4,
    patchRemoved: 3,
    oldContentLines: 3,
    newContentLines: 4,
  },
]
