import { describe, expect, it } from 'vitest'
import { DIFF_CORPUS, diffTotals } from '../src/index.ts'

// The corpus pins jsdiff's own +/- counts (patchAdded/patchRemoved) next to the
// whole-side counts this package's footer prints. They agree on every case even
// though they are different measures — the patch counts only changed lines, the
// sides count every line — so the assertion is per-case equality of diffTotals
// with the recorded content-line counts, not of the two count families.
describe('diffTotals over the shared diff corpus', () => {
  for (const { name, before, after, oldContentLines, newContentLines } of DIFF_CORPUS) {
    it(`counts both full sides for ${name}`, () => {
      expect(diffTotals([{ path: `corpus/${name}.txt`, oldText: before === '' ? null : before, newText: after }]))
        .toEqual({ added: newContentLines, removed: oldContentLines })
    })
  }
})
