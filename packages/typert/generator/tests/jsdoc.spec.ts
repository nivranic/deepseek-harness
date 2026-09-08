import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parseJsDoc } from '../src/jsdoc.ts'

describe('Cordis JSDoc projection', () => {
  it('keeps paragraph and list structure before the first tag', () => {
    const parsed = parseJsDoc(`/**
 * Intro {@link Item}.
 *
 * Next paragraph.
 * - first
 *   continuation
 * - second
 *   another continuation
 *
 * Last line.
 * @param value - input
 * Documentation after tags belongs to that tag.
 */`)
    expect(parsed.doc).toBe('Intro Item.\n\nNext paragraph.\n\n- first continuation\n- second another continuation\n\nLast line.')
    expect([...parsed.params]).toEqual([['value', 'input Documentation after tags belongs to that tag.']])
  })

  it('distinguishes absent tags from recognized empty descriptions', () => {
    expect(parseJsDoc('/** */')).toEqual({ doc: '', params: new Map(), returns: null, throws: [], deprecated: false })
    const parsed = parseJsDoc('/** Text.\n * @param empty\n * @returns\n * @throws\n * @deprecated\n */')
    expect(parsed).toEqual({ doc: 'Text.', params: new Map([['empty', '']]), returns: '', throws: [''], deprecated: true })
  })

  it('accepts tag aliases and joins descriptions until an unknown tag or blank line', () => {
    const parsed = parseJsDoc(`/** Text.
 * @param [input] — first
 * second
 * @param empty
 * filled
 * @return
 * result
 * detail
 * @throw
 * failure
 * more
 * @throws – another failure
 * @unknown stop
 * ignored
 * @returns final
 *
 * ignored after blank
 */`)
    expect([...parsed.params]).toEqual([['input', 'first second'], ['empty', 'filled']])
    expect(parsed.returns).toBe('final')
    expect(parsed.throws).toEqual(['failure more', 'another failure'])
  })

  it.each([
    ['[value]', 'value', 'input'],
    ['[value', 'value', 'input'],
    ['value]', 'value', 'input'],
    ['value.extra', 'value', '.extra input'],
    ['9$', '9$', 'input'],
  ])('retains the parameter-name syntax in %s', (name, key, description) => {
    expect([...parseJsDoc(`/** @param ${name} input */`).params]).toEqual([[key, description]])
  })

  it.each([
    '@param', '@param [[name]] text', '@returning text', '@throwsExtra text', '@deprecated-extra',
  ])('does not recognize the malformed tag %s', (tag) => {
    expect(parseJsDoc(`/** ${tag} */`)).toEqual({ doc: '', params: new Map(), returns: null, throws: [], deprecated: false })
  })

  it.each(['\r', '\u2028', '\u2029'])('rejects a line terminator inside a tag description: %j', (separator) => {
    const parsed = parseJsDoc(`/** Text.\n * @param value x${separator}y\n * @returns x${separator}y\n * @throws x${separator}y\n */`)
    expect([...parsed.params]).toEqual([])
    expect(parsed.returns).toBeNull()
    expect(parsed.throws).toEqual([])
  })

  it.each([
    ['plain text', 'plain text'],
    ['{@link Target}', 'Target'],
    ['a {@link Target label} b', 'a Target label b'],
    ['{@link A}{@link B}', 'AB'],
    ['{@linkx}{@link yes}', '{@linkx}yes'],
    ['{@link } after {@link yes}', '{@link } after yes'],
    ['a {@link\n\n} b', 'a \n b'],
    ['{@link a {@link b} c}', 'a {@link b c}'],
    ['{@link missing', '{@link missing'],
    ['{@link', '{@link'],
  ])('projects inline link text in %j', (input, output) => {
    expect(parseJsDoc(input).doc).toBe(output)
  })

  it('finishes long malformed comments within a bounded child lifetime', () => {
    // The pure parser uses erasable TypeScript; the child deadline also stops synchronous regressions.
    const module = new URL('../src/jsdoc.ts', import.meta.url).href
    const program = `
      import { strict as assert } from 'node:assert';
      import { parseJsDoc } from ${JSON.stringify(module)};
      const whitespace = ' '.repeat(100_000);
      assert.equal(parseJsDoc('/** text ' + whitespace + 'x */').doc, 'text x');
      for (const tag of ['@param value', '@returns', '@throws']) {
        const parsed = parseJsDoc('/** Text.\\n * ' + tag + ' ' + whitespace + 'x\\u2028y\\n */');
        assert.equal(parsed.doc, 'Text.');
        assert.equal(parsed.params.size, 0);
        assert.equal(parsed.returns, null);
        assert.deepEqual(parsed.throws, []);
      }
      const unclosed = '{@link x '.repeat(40_000);
      assert.equal(parseJsDoc('/** ' + unclosed + ' */').doc, unclosed.trim());
    `
    execFileSync(process.execPath, ['--input-type=module', '--eval', program], { timeout: 5_000, stdio: 'pipe' })
  })
})
