/** Home placeholders preserve complete paths and unrelated recorded content. */
import { describe, expect, it } from 'vitest'
import { captureFixtureHomePaths, realizeFixtureHomePaths } from './fixture-home-paths.ts'

const home = 'C:\\Users\\fixture person\\Temp\\isolated-home'
const suffix = '/attachments/v1/files/ab/abcdef/a file.txt'
const token = '{{harnessHome}}' + suffix
const native = home + suffix.replaceAll('/', '\\')
const logOf = (path: string): string => JSON.stringify({
  type: 'tool/result',
  data: {
    arguments: '{ "file_path" : ' + JSON.stringify(path) + ', "limit": 10 }',
    blocks: [{ arguments: '{ "file_path" : ' + JSON.stringify(path) + ' }' }],
    meta: { path, offset: 1, lines: [{ number: 1, text: 'UPLOAD_ROUND_OK' }], totalLines: 1 },
    content: [{ text: '<path>' + path + '</path>\n<content>UPLOAD_ROUND_OK</content>' }],
  },
}) + '\n'

describe('Harness home fixture paths', () => {
  it.each([home, '/private/tmp/fixture person/isolated-home'])('round-trips typed paths at %s', (root) => {
    const actualPath = root + suffix.replaceAll('/', root.includes('\\') ? '\\' : '/')
    const actual = logOf(actualPath)
    const captured = captureFixtureHomePaths(actual, root)
    expect(captured).toBe(logOf(token))
    expect(realizeFixtureHomePaths(captured, root)).toBe(actual)
  })

  it('captures slash-form Windows metadata without confusing an adjacent directory', () => {
    expect(captureFixtureHomePaths(logOf(native.replaceAll('\\', '/')), home)).toBe(logOf(token))
    const adjacent = logOf(home + '-other\\attachments\\file.txt')
    expect(captureFixtureHomePaths(adjacent, home)).toBe(adjacent)
  })

  it('retains argument whitespace, quote escaping, unicode and nested tool-call arguments', () => {
    const quoted = token + ' 你好 "quote".txt'
    const actual = logOf(home + quoted.slice('{{harnessHome}}'.length).replaceAll('/', '\\'))
    expect(captureFixtureHomePaths(actual, home)).toBe(logOf(quoted))
    expect(realizeFixtureHomePaths(logOf(quoted), home)).toBe(actual)
  })

  it('leaves ordinary prose, unrelated paths and malformed argument text observable', () => {
    const raw = JSON.stringify({
      text: 'User prose: ' + home + ' and {{harnessHome}}/unrelated',
      path: 'D:\\other\\file.txt',
      arguments: '{ invalid "escape\\q"; 99 }',
    }) + '\n'
    expect(captureFixtureHomePaths(raw, home)).toBe(raw)
    expect(realizeFixtureHomePaths(raw, home)).toBe(raw)
  })

  it('preserves POSIX backslashes and arbitrary argument strings that resemble owned paths', () => {
    const root = '/tmp/isolated-home'
    const path = root + '/literal\\name.txt'
    expect(realizeFixtureHomePaths(captureFixtureHomePaths(logOf(path), root), root)).toBe(logOf(path))
    const argumentsText = JSON.stringify({ message: native, example: '"file_path": "' + token + '"' })
    const raw = JSON.stringify({ arguments: argumentsText }) + '\n'
    expect(captureFixtureHomePaths(raw, home)).toBe(raw)
    expect(realizeFixtureHomePaths(raw, home)).toBe(raw)
  })

  it.each([
    [token, '{{harnessHome}}/attachments/v1/files/ab/changed/a file.txt'],
    ['UPLOAD_ROUND_OK', 'CORRUPTED_FILE'],
    ['"offset":1', '"offset":2'],
  ])('keeps a changed path or result distinct: %s', (before, after) => {
    const expected = logOf(token)
    const changed = expected.replaceAll(before, after)
    expect(realizeFixtureHomePaths(changed, home)).not.toBe(logOf(native))
  })
})
