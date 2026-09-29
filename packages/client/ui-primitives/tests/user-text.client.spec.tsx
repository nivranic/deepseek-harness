// @vitest-environment jsdom
/**
 * Inline projection of sent user text: decoration never breaks a single-line
 * message (bubble regression), and wire session forms fold to their label
 * (queue-row readability).
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { projectUserText } from '../src/user-text.tsx'

const project = (text: string, labels: readonly string[] = []) =>
  render(<div data-host>{projectUserText(text, labels)}</div>).container.querySelector('[data-host]')!

describe('projectUserText', () => {
  it('keeps a decorated single-line message on one line: every part is inline', () => {
    const host = project('反反复复 /dsh-acp-test @执行几个命令测试', ['执行几个命令测试'])
    expect(host.querySelectorAll('div').length).toBe(0)
    expect(host.textContent).toBe('反反复复 /dsh-acp-test 执行几个命令测试')
    const chips = host.querySelectorAll('[data-ref-chip]')
    expect([...chips].map(c => c.getAttribute('data-ref-chip'))).toEqual(['skill', 'session'])
    // The whitespace between tokens survives as its own inline run.
    const runs = [...host.querySelectorAll('span')].filter(s => !s.hasAttribute('data-ref-chip') && s.closest('[data-ref-chip]') === null)
    expect(runs.map(r => r.textContent)).toEqual(['反反复复 ', ' '])
  })

  it('folds the wire session form to its label with the session glyph', () => {
    const host = project('看看 @[查看并分析图片](dsh-session:InNlc3Npb24tNDM0) 的结论')
    const chip = host.querySelector('[data-ref-chip="session"]')!
    expect(chip.textContent).toBe('查看并分析图片')
    expect(chip.getAttribute('title')).toBe('@[查看并分析图片](dsh-session:InNlc3Npb24tNDM0)')
    expect(chip.querySelector('svg')).not.toBeNull()
    expect(host.textContent).toBe('看看 查看并分析图片 的结论')
  })

  it('prefers the wire fold over the bare-token scan on the same range', () => {
    const host = project('@[a](dsh-session:x)', [])
    expect(host.querySelectorAll('[data-ref-chip]').length).toBe(1)
    expect(host.querySelector('[data-ref-chip="session"]')!.textContent).toBe('a')
  })

  it('decorates recall-associated labels, files, folders, and quoted paths', () => {
    const host = project('@会话一 说 @src/deep/file.txt 与 @dir/ 与 @"a b.md"', ['会话一'])
    const kinds = [...host.querySelectorAll('[data-ref-chip]')].map(c =>
      [c.getAttribute('data-ref-chip'), c.textContent])
    expect(kinds).toEqual([
      ['session', '会话一'],
      ['file', 'file.txt'],
      ['folder', 'dir'],
      ['file', 'a b.md'],
    ])
  })

  it('repeated recall labels decorate every occurrence once', () => {
    const host = project('@再看 前情 @再看', ['再看', '再看'])
    expect(host.querySelectorAll('[data-ref-chip="session"]').length).toBe(2)
  })

  it('strips trailing punctuation and skips degenerate tokens', () => {
    const host = project('用 /plan。 试试 @。')
    const chips = [...host.querySelectorAll('[data-ref-chip]')]
    expect(chips.map(c => c.textContent)).toEqual(['/plan'])
    expect(host.textContent).toBe('用 /plan。 试试 @。')
  })

  it('prefers the longer recall label when one nests inside another', () => {
    const host = project('@会话一 收尾', ['会话', '会话一'])
    const chips = [...host.querySelectorAll('[data-ref-chip="session"]')]
    expect(chips.map(c => c.textContent)).toEqual(['会话一'])
    expect(host.textContent).toBe('会话一 收尾')
  })

  it('falls back to the raw quoted label when the path has no basename', () => {
    const host = project('看 @"/" 下面')
    const chip = host.querySelector('[data-ref-chip="file"]')!
    expect(chip.textContent).toBe('"/"')
  })

  it('renders undecorated text as one inline run', () => {
    const host = project('纯文本，无引用')
    expect(host.querySelectorAll('div').length).toBe(0)
    expect(host.querySelectorAll('[data-ref-chip]').length).toBe(0)
    expect(host.textContent).toBe('纯文本，无引用')
  })

  it.each([
    ['@[@[nested](dsh-session:x)', ['@[nested']],
    ['@[](dsh-session:x) @[valid](dsh-session:y)', ['valid']],
    ['@[broken\n@[valid](dsh-session:x)', ['valid']],
    ['@[broken](wrong:x) @[valid](dsh-session:y)', ['valid']],
    ['@[empty](dsh-session:) @[valid](dsh-session:y)', ['valid']],
    ['@[broken](dsh-session:x\u00a0) @[valid](dsh-session:y)', ['valid']],
    ['@[outer](dsh-session:@[inner](dsh-session:x)', ['outer']],
    ['@[broken](dsh-session:@[inner label](dsh-session:x)', []],
    ['@[broken](dsh-session:x @[inner label](dsh-session:x)', ['inner label']],
    ['@[a\r😀\\b](dsh-session:opaque)@[next](dsh-session:y)', ['a\r😀\\b', 'next']],
    ['@[unfinished', []],
    ['@[label](dsh-session:unfinished', []],
  ])('preserves display grammar for %s', (text, labels) => {
    const host = project(text)
    expect([...host.querySelectorAll('[data-ref-chip="session"]')].map(chip => chip.textContent)).toEqual(labels)
  })

  it('retains internal punctuation, quoted endings, and punctuation outside chips', () => {
    const host = project('@a...b.txt!?，。；：！？ @"a!" @。')
    expect([...host.querySelectorAll('[data-ref-chip]')].map(chip => [chip.textContent, chip.getAttribute('title')]))
      .toEqual([['a...b.txt', '@a...b.txt'], ['a!', '@"a!"']])
    expect(host.textContent).toBe('a...b.txt!?，。；：！？ a! @。')
  })

  it('renders long unfinished mentions and internal punctuation without repeated suffix scans', () => {
    const inputs = [
      `${'@['.repeat(128_000)}unfinished`,
      `${'@[x](dsh-session:'.repeat(16_000)}unfinished`,
      `@${'.'.repeat(128_000)}file`,
    ]
    const started = performance.now()
    for (const text of inputs) {
      const host = project(text)
      expect(host.querySelector('[data-ref-chip="session"]')).toBeNull()
      expect(host.querySelector('[data-ref-chip="file"]')!.getAttribute('title')).toBe(text)
    }
    expect(performance.now() - started).toBeLessThan(5_000)
  })
})
