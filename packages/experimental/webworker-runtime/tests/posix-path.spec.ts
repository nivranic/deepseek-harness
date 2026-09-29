/** Normalized VFS paths and literal file-URL strings retain their own semantics. */
import { execFileSync } from 'node:child_process'
import { fileURLToPath as nodeFileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { basename, dirname, fileUrlToPath, parse, pathToFileUrl } from '../src/module-system/posix-path.ts'

it.each([
  ['/', '.', ''],
  ['/a/b/..', '/', 'a'],
  ['/a//b///', '/a', 'b'],
  ['a/b.txt', 'a', 'b.txt'],
  ['../a/../..', '..', '..'],
  ['a/..', '.', '.'],
] as const)('normalizes %s before selecting its directory and basename', (input, directory, name) => {
  expect(dirname(input)).toBe(directory)
  expect(basename(input)).toBe(name)
  expect(parse(input)).toMatchObject({ dir: directory, base: name })
})

it('removes a proper suffix after selecting the normalized basename', () => {
  expect(basename('/a/name.txt///', '.txt')).toBe('name')
  expect(basename('/a/name.txt', 'name.txt')).toBe('name.txt')
  expect(basename('/a/name.txt', '.js')).toBe('name.txt')
})

it.each([
  ['file://', '/'],
  ['file://?query', '/'],
  ['file:///a?query#fragment', '/a'],
  ['file:///a#fragment?query', '/a'],
  ['file:///a%3Fb%23c?query', '/a?b#c'],
  ['file:///a?before\nb#after', '/a?before\nb'],
  ['file:///a\n?after', '/a\n'],
  ['file:///a?before\n', '/a?before\n'],
  ['file:///a?before\r\n', '/a?before\r\n'],
  ['file:///a?before\r', '/a?before\r'],
  ['file:///a?before\u2028', '/a?before\u2028'],
  ['file:///a?before\u2029', '/a?before\u2029'],
  ['file://a%2Fb#fragment', 'a/b'],
] as const)('decodes %j after removing delimiters from its final raw line', (input, expected) => {
  expect(fileUrlToPath(input)).toBe(expected)
})

it('accepts URL objects and round-trips escaped VFS segments', () => {
  expect(fileUrlToPath(new URL('file:///hello%20world?ignored'))).toBe('/hello world')
  expect(fileUrlToPath(pathToFileUrl('/a?b#c/空 格'))).toBe('/a?b#c/空 格')
})

it('rejects a foreign scheme and malformed percent escapes', () => {
  expect(() => fileUrlToPath('https://example.test/a')).toThrow('not a file URL')
  expect(() => fileUrlToPath('file:///%E0%A4%A')).toThrow(URIError)
})

it('finishes long delimiter and separator inputs in a bounded child process', () => {
  const fixture = nodeFileURLToPath(new URL('./fixtures/posix-path-stress.mjs', import.meta.url))
  const output = execFileSync(process.execPath, ['--import', import.meta.resolve('tsx/esm'), fixture], {
    encoding: 'utf8', timeout: 5000,
  })
  expect(output).toBe('completed\n')
}, 15000)
