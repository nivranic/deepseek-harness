import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { renderIndexInjections } from '../src/injections.ts'

const ready = '<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>'
const script = '<script>X</script>'

describe.each(['head', 'body'] as const)('%s opening-tag lookup', (placement) => {
  it.each([
    ['', '<TAG>', 'tail'],
    ['<TAGger>', '<TaG>', 'tail'],
    ['', '<TAG data-x="1">', 'tail'],
    ['', '<TAG\nclass="a">', 'tail'],
    ['', '<TAG\u00a0class="a">', 'tail'],
    ['', '<TAG data-x="a>', 'b">tail'],
    ['', '<TAG <TAG >', 'tail'],
    ['<!--', '<TAG>', '-->tail'],
  ])('inserts after the first matching tag in %j %j %j', (prefix, opening, suffix) => {
    const before = (prefix + opening).replaceAll('TAG', placement).replaceAll('TaG', placement.toUpperCase())
    const after = suffix.replaceAll('TAG', placement)
    const result = renderIndexInjections(before + after, [{ kind: 'script', placement, text: 'X' }])
    expect(result).toBe(placement === 'head'
      ? before + script + after + ready
      : before + script + ready + after)
  })

  it.each(['', '<TAG', '<TAG ', '<TAG/>', '<TAGger>', '</TAG>'])('uses the fragment fallback for %j', (template) => {
    const html = template.replaceAll('TAG', placement)
    expect(renderIndexInjections(html, [{ kind: 'script', placement, text: 'X' }]))
      .toBe(placement === 'head' ? script + html + ready : html + script + ready)
  })

  it('finishes repeated unclosed prefixes within a bounded child lifetime', () => {
    // A child timeout can interrupt a synchronous regex regression.
    const module = new URL('../src/injections.ts', import.meta.url).href
    const program = `
      import { strict as assert } from 'node:assert';
      import { renderIndexInjections } from ${JSON.stringify(module)};
      const html = '<${placement} '.repeat(100_000);
      const result = renderIndexInjections(html, [{ kind: 'script', placement: '${placement}', text: 'X' }]);
      const script = ${JSON.stringify(script)};
      const ready = ${JSON.stringify(ready)};
      assert.equal(result, ${placement === 'head' ? 'script + html + ready' : 'html + script + ready'});
    `
    execFileSync(process.execPath, ['--input-type=module', '--eval', program], { timeout: 5_000, stdio: 'pipe' })
  })
})
