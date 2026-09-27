/** Verify native scanner source and Android builder refusals without producing release artifacts. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const moduleDirectory = fileURLToPath(new URL('../native/support-scanner/', import.meta.url))
const policy = JSON.parse(readFileSync(new URL('../native/support-scanner/build.json', import.meta.url), 'utf8'))
assert.equal(typeof policy.goVersion, 'string')
assert.match(policy.goVersion, /^\d+\.\d+\.\d+$/u)
const go = process.env.DSH_SCANNER_GO ?? 'go'
const python = process.env.DSH_SCANNER_PYTHON ?? 'python'
const goEnv = { ...process.env, GOENV: 'off', GOWORK: 'off', GOTOOLCHAIN: 'local', GOFLAGS: '-mod=readonly',
  GOSUMDB: 'sum.golang.org', GONOSUMDB: 'none', GOPRIVATE: '', GONOPROXY: 'none' }
for (const name of ['source', 'artifact', 'build']) {
  assert.ok(existsSync(new URL(`./release/test_mobile_scanner_${name}.py`, import.meta.url)), 'Scanner builder test owner is missing')
}

/** Each command runs to completion; failure prevents subsequent acceptance steps. */
function run(command, args, cwd, env, capture = false) {
  const result = spawnSync(command, args, { cwd, env, windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (capture && result.status !== 0) {
    process.stdout.write(result.stdout); process.stderr.write(result.stderr)
  }
  if (result.status !== 0) throw new Error(`Scanner verification command failed: ${command} (${result.status ?? result.signal})`)
  return result
}

const version = run(go, ['env', 'GOVERSION'], moduleDirectory, goEnv, true).stdout.trim()
assert.equal(version, `go${policy.goVersion}`, 'Scanner compiler must match the committed policy')
const builderTests = run(python, ['-m', 'unittest', 'discover', '-s', 'scripts/release', '-p', 'test_mobile_scanner_*.py', '-v'], root,
  { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, true)
process.stdout.write(builderTests.stdout); process.stderr.write(builderTests.stderr)
const builderCount = /\bRan ([1-9]\d*) tests? in /u.exec(builderTests.stderr)
assert.ok(builderCount, 'Scanner builder tests did not execute')
const pythonTests = Number(builderCount[1])
const pythonSkipped = Number(/\bskipped=(\d+)\b/u.exec(builderTests.stderr)?.[1] ?? 0)
assert.ok(pythonSkipped < pythonTests, 'Scanner builder tests all skipped')
run(go, ['mod', 'verify'], moduleDirectory, goEnv)
const scannerTests = run(go, ['test', '-mod=readonly', '-count=1', '-timeout=60s', '-v', './...'], moduleDirectory, goEnv, true)
process.stdout.write(scannerTests.stdout); process.stderr.write(scannerTests.stderr)
assert.match(scannerTests.stdout, /^--- PASS: /mu, 'Scanner behavior tests did not execute')
run(go, ['vet', '-mod=readonly', './...'], moduleDirectory, goEnv)
console.log(JSON.stringify({ status: 'PASS', go: version, scope: 'scanner source and Android builder',
  pythonTests, pythonSkipped, goTests: [...scannerTests.stdout.matchAll(/^--- PASS: /gmu)].length,
  race: 'NOT_EXECUTED', artifactBuild: 'NOT_EXECUTED' }))
