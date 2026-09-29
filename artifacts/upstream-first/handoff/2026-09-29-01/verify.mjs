/** Verify this handoff's bytes; --live checks local product inputs without running product checks or contacting GitHub. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const digest = data => createHash('sha256').update(data).digest('hex')
const read = path => readFileSync(resolve(here, path))
const json = path => JSON.parse(read(path).toString('utf8'))
let checks = 0
const check = (value, message) => { assert.ok(value, message); checks++ }
const safe = path => typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.includes(':')
  && path.split('/').every(part => part && part !== '.' && part !== '..')
const manifest = json('manifest.json')
for (const entry of manifest.files) {
  check(safe(entry.path), 'Unsafe manifest path')
  const bytes = read(entry.path)
  check(bytes.length === entry.bytes && digest(bytes) === entry.sha256, 'Changed handoff file: ' + entry.path)
}
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(resolve(dir, entry.name)) : [relative(here, resolve(dir, entry.name)).replaceAll('\\', '/')])
const owned = walk(here).filter(path => !['manifest.json', 'verification.json'].includes(path)).sort()
check(JSON.stringify(owned) === JSON.stringify(manifest.files.map(entry => entry.path).sort()), 'Manifest inventory differs')
const state = json('state.json')
check(state.head === '74b476627a950189b348a5771bb205c508f8230f', 'Unexpected handoff baseline')
check(state.goalStatus === 'paused' && !state.fullGoalComplete && !state.completeRc, 'Completion incorrectly claimed')
check(state.unsealedIncrement.key === 'native-upload-budget' && !state.unsealedIncrement.captureStarted, 'Incorrect unsealed state')
check(state.unsealedIncrement.beforeFiles === 6924, 'Incorrect archive count')
check(digest(read('../2026-09-25-01/HANDOFF.md')) === state.predecessorManualSha256, 'Predecessor changed')
check(digest(read('original-specification.md')) === '4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80', 'Specification changed')
const changes = json('changes.json')
check(changes.commitRange.count === 41 && changes.commitRange.commits.length === 41, 'Incorrect commit inventory')
for (const file of changes.unsealedFiles) {
  check(safe(file.path) && !file.path.startsWith('.glm-router/'), 'Excluded product input')
  if (!file.deleted) check(digest(read(file.snapshot)) === file.sha256, 'Product snapshot mismatch: ' + file.path)
}
for (const file of json('evidence-index.json').files) check(digest(read(file.snapshot)) === file.sha256, 'Evidence snapshot mismatch: ' + file.path)
const manual = read('HANDOFF.md').toString('utf8')
check(manual.endsWith('\n') && !manual.endsWith('\n\n'), 'Manual newline')
for (const match of manual.matchAll(/\]\(([^)#]+?)(?:#[^)]*)?\)/gu)) {
  if (!/^https?:/u.test(match[1])) check(existsSync(resolve(here, match[1])), 'Missing manual link: ' + match[1])
}
const latest = json('../LATEST.json')
check(latest.handoffId === '2026-09-29-01' && latest.entry === '2026-09-29-01/HANDOFF.md', 'LATEST target mismatch')
check(latest.entrySha256 === digest(read('HANDOFF.md')) && latest.manifestSha256 === digest(read('manifest.json')), 'LATEST hash mismatch')
if (process.argv.includes('--live')) {
  const git = (...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root }).toString().trim()
  check(git('rev-parse', 'HEAD') === state.head && git('branch', '--show-current') === state.branch, 'Live branch/HEAD changed')
  for (const file of changes.unsealedFiles) {
    const path = resolve(root, file.path)
    check(file.deleted ? !existsSync(path) : digest(readFileSync(path)) === file.sha256, 'Live product file changed: ' + file.path)
  }
  for (const file of json('evidence-index.json').files) check(digest(readFileSync(resolve(root, file.path))) === file.sha256, 'Live evidence changed: ' + file.path)
  for (const file of [state.latestSealedRecord, ...state.currentApks]) check(digest(readFileSync(resolve(root, file.path))) === file.sha256, 'Live bound file changed: ' + file.path)
  check(digest(readFileSync(resolve(root, state.unsealedIncrement.beforeArchive))) === state.unsealedIncrement.beforeArchiveSha256, 'Before manifest changed')
  const evidence = JSON.parse(readFileSync(resolve(root, 'artifacts/upstream-first/evidence.json'), 'utf8'))
  check(evidence.latestSourceRecord === state.latestSealedRecord.path && !evidence.completeRc, 'Live seal pointer changed')
}
console.log(JSON.stringify({ status: 'PASS', checks, live: process.argv.includes('--live'), productTestsRun: false }, null, 2))
