/** Scanner verification cannot pass without its owned tests or the pinned compiler. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

for (const [name, setup, failure] of [
  ['missing test owner', `fs.existsSync = file => !String(file).endsWith('test_mobile_scanner_source.py');`, 'Scanner builder test owner is missing'],
  ['wrong compiler', `child.spawnSync = () => ({ status: 0, stdout: 'go0.0.0', stderr: '' });`, 'Scanner compiler must match'],
  ['empty Python corpus', `child.spawnSync = (_, args) => ({ status: 0, stdout: args[0] === 'env' ? 'go' + policy.goVersion : '', stderr: 'Ran 0 tests in 0.0s' });`, 'Scanner builder tests did not execute'],
  ['fully skipped Python corpus', String.raw`child.spawnSync = (_, args) => ({ status: 0, stdout: args[0] === 'env' ? 'go' + policy.goVersion : '', stderr: 'Ran 18 tests in 0.0s\nOK (skipped=18)' });`, 'Scanner builder tests all skipped'],
  ['empty Go corpus', String.raw`child.spawnSync = (_, args) => ({ status: 0, stdout: args[0] === 'env' ? 'go' + policy.goVersion : '[no test files]', stderr: 'Ran 18 tests in 0.0s\nOK' });`, 'Scanner behavior tests did not execute'],
]) {
  test(`rejects ${name}`, () => {
    const code = `import fs from 'node:fs'; import child from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const policy = JSON.parse(fs.readFileSync('native/support-scanner/build.json', 'utf8'));
      ${setup}
      syncBuiltinESMExports(); await import('./scripts/test-support-scanner.mjs');`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', windowsHide: true, timeout: 10_000,
    })
    assert.equal(result.status, 1, result.stderr)
    assert.ok(result.stderr.includes(failure), result.stderr)
  })
}
