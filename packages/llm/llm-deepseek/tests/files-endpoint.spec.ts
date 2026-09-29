import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { filesEndpoint } from '../src/files-endpoint.ts'

describe('Files endpoint spelling', () => {
  it.each([
    ['', ''],
    ['///', ''],
    ['https://example.test', 'https://example.test'],
    ['https://example.test///', 'https://example.test'],
    ['https://example.test/a//b///', 'https://example.test/a//b'],
    ['https://example.test/路径///', 'https://example.test/路径'],
    ['https://example.test/%2F', 'https://example.test/%2F'],
    ['https://example.test/\n', 'https://example.test/\n'],
  ])('removes only the trailing slashes from %j', (input, expected) => {
    expect(filesEndpoint(input)).toBe(expected)
  })

  it('finishes long interior slash runs within a bounded child lifetime', () => {
    // A separate process lets the timeout interrupt a synchronous regex regression.
    const module = new URL('../src/files-endpoint.ts', import.meta.url).href
    const program = `
      import { strict as assert } from 'node:assert';
      import { filesEndpoint } from ${JSON.stringify(module)};
      const prefix = 'https://example.test/' + '/'.repeat(1_000_000) + 'v1';
      assert.equal(filesEndpoint(prefix + '///'), prefix);
      assert.equal(filesEndpoint('/'.repeat(1_000_000)), '');
    `
    execFileSync(process.execPath, ['--input-type=module', '--eval', program], {
      timeout: 5_000,
      stdio: 'pipe',
    })
  })
})
