/**
 * Acceptance-path coverage for the rescope codemod's exact-edit classifier: a
 * duplicated insertion — what a non-idempotent apply produces — must be
 * rejected rather than applied again.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXACT_EDITS, exactEditState, rewritePackageReferences } from './rescope-vendor.ts'

const ANCHOR = '\n## Sync procedure'
const INSERTED = `\n15. **rescope**: one log entry.\n${ANCHOR}`

const documentationEdits = [
  'agent-spine-demo-mounted-tree',
  'agent-spine-demo-mounted-tree-zh',
  'vendoring-cookbook-tree-comment',
  'vendoring-cookbook-tree-comment-zh',
  'vendoring-cookbook-name-invariant',
  'vendoring-cookbook-name-invariant-zh',
] as const

describe.each([
  'apps/cli/tests/desktop-composition.e2e.ts',
  'packages/experimental/inspector/src/shared/bridge/messages/cordis.ts',
  'packages/experimental/inspector/tests/cordis-query.host.spec.ts',
  'packages/experimental/inspector/tests/cordis-tree.host.spec.ts',
  'packages/experimental/inspector/tests/plugin.client.spec.ts',
])('product identifiers in %s', (file) => {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

  it('preserves the current product values and remains idempotent', () => {
    expect(rewritePackageReferences(source, file)).toEqual({ text: source, lines: 0 })
  })

  it('still detects package references in every module syntax in the same file', () => {
    const specifiers = [
      "import { Context } from 'cordis'",
      "export * from 'cordis/tree'",
      "declare module 'cordis' {}",
      "import('cordis/tree')",
      "require('cordis')",
      "require.resolve('cordis/tree')",
      "import.meta.resolve('cordis')",
    ].join('\n')
    const expected = specifiers.replaceAll("'cordis", "'@deepseek-ai/cordis")
    expect(rewritePackageReferences(source + '\n' + specifiers, file).text).toBe(source + '\n' + expected)
    expect(rewritePackageReferences(expected, file, true).text).toBe(specifiers)
  })
})

it('limits preserved product values to their declared files and syntax positions', () => {
  const file = 'packages/experimental/inspector/tests/cordis-tree.host.spec.ts'
  const input = "const records = [{ topic: 'cordis/tree', package: 'cordis/tree' }]; import('cosmokit'); import('cordis')"
  expect(rewritePackageReferences(input, file).text).toBe(
    "const records = [{ topic: 'cordis/tree', package: '@deepseek-ai/cordis/tree' }]; import('@deepseek-ai/cosmokit'); import('@deepseek-ai/cordis')",
  )
  expect(rewritePackageReferences(input, 'unlisted.ts').text).not.toContain("'cordis/tree'")
})

describe.each(documentationEdits)('current documentation edit %s', (id) => {
  const edit = EXACT_EDITS.find(candidate => candidate.id === id)
  if (edit === undefined) throw new Error(`Required documentation edit is missing: ${id}`)
  const document = readFileSync(new URL(`../${edit.file}`, import.meta.url), 'utf8')

  it('recognizes the current name while preserving all surrounding documentation on a round trip', () => {
    expect(exactEditState(document, edit.find, edit.replace, edit.expect)).toBe('applied')
    expect(exactEditState(document, edit.replace, edit.find, edit.expect)).toBe('pending')
    const reversed = document.replace(edit.replace, edit.find)
    expect(exactEditState(reversed, edit.find, edit.replace, edit.expect)).toBe('pending')
    expect(exactEditState(reversed, edit.replace, edit.find, edit.expect)).toBe('applied')
    expect(reversed.replace(edit.find, edit.replace)).toBe(document)
  })

  it('rejects missing, duplicate and mixed instructions through the gate classifier', () => {
    expect(exactEditState(document.replaceAll(edit.replace, ''), edit.find, edit.replace, edit.expect)).toBe('invalid')
    expect(exactEditState(document + '\n' + edit.replace, edit.find, edit.replace, edit.expect)).toBe('invalid')
    expect(exactEditState(document + '\n' + edit.find, edit.find, edit.replace, edit.expect)).toBe('invalid')
  })

  it.runIf(id.startsWith('agent-spine-demo'))('rejects a longer package name that shares the timer prefix', () => {
    const unrelated = document.replace(edit.replace, edit.replace.trimEnd() + '-unrelated ')
    expect(exactEditState(unrelated, edit.find, edit.replace, edit.expect)).toBe('invalid')
  })
})

describe('exactEditState', () => {
  it('classifies an insertion by its target form, so a duplicate is invalid', () => {
    expect(exactEditState(`log\n${ANCHOR}\n`, ANCHOR, INSERTED, 1)).toBe('pending')
    expect(exactEditState(`log${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('applied')
    // The anchor survives an insertion, so counting the source form would have
    // called this pending and inserted the entry a second time.
    expect(exactEditState(`log${INSERTED}${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('invalid')
    expect(exactEditState('log\n', ANCHOR, INSERTED, 1)).toBe('invalid')
  })

  it('classifies a deletion by its source form, and requires its remainder to survive', () => {
    const remainder = 'exclude:\n'
    const withEntries = 'exclude:\n  - cordis@4\n'
    expect(exactEditState(withEntries, withEntries, remainder, 1)).toBe('pending')
    expect(exactEditState(remainder, withEntries, remainder, 1)).toBe('applied')
    // Upstream dropped the whole field: the source form is gone, but so is the
    // remainder, so this is a moved site rather than a completed deletion.
    expect(exactEditState('unrelated:\n', withEntries, remainder, 1)).toBe('invalid')
  })

  it('requires a replacement to leave no source form and the exact target count', () => {
    expect(exactEditState('a = 1\n', 'a = 1', 'b = 2', 1)).toBe('pending')
    expect(exactEditState('b = 2\n', 'a = 1', 'b = 2', 1)).toBe('applied')
    expect(exactEditState('b = 2\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    // A moved or partially applied site: neither state is complete.
    expect(exactEditState('a = 1\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    expect(exactEditState('x\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
  })
})
