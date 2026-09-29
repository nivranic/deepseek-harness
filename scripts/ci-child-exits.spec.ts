/** Real child exits verify the optional CI observer without loading it into Vitest. */
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

const observer = new URL('./ci-child-exits.mjs', import.meta.url).href

it.each([0, 17])('preserves exit %i and stdout while excluding private child inputs', (code) => {
  const privateInput = 'private-child-input-sentinel'
  const source = `
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    const child = spawn(process.execPath, ['-e',
      'process.stdout.write("child-output"); process.exitCode = ${code}', '${privateInput}'],
      { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PRIVATE_INPUT: '${privateInput}' } });
    const [code] = await once(child, 'close');
    process.exitCode = code;
  `
  const result = spawnSync(process.execPath, ['--import', observer, '--input-type=module', '-e', source], { encoding: 'utf8' })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(code)
  expect(result.signal).toBeNull()
  expect(result.stdout).toBe('child-output')
  const rows = result.stderr.trim().split('\n').map((line): unknown => JSON.parse(line))
  expect(rows).toEqual([{
    kind: 'ci-child-exit', nodeVersion: process.version, parentPid: result.pid,
    childPid: expect.any(Number) as unknown, code, signal: null,
  }])
  expect(result.stderr).not.toContain(privateInput)
})

it('observes signal termination without converting it to a successful exit', () => {
  const source = `
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    child.once('spawn', () => child.kill('SIGTERM'));
    const [code, signal] = await once(child, 'close');
    if (code !== null || signal !== 'SIGTERM') throw new Error('unexpected termination');
    process.exitCode = 23;
  `
  const result = spawnSync(process.execPath, ['--import', observer, '--input-type=module', '-e', source], { encoding: 'utf8' })
  expect(result.status).toBe(23)
  expect(result.stdout).toBe('')
  expect(JSON.parse(result.stderr)).toMatchObject({ kind: 'ci-child-exit', code: null, signal: 'SIGTERM' })
})
