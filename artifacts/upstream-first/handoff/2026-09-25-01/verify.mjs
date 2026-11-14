/**
 * Read-only verification of the 2026-09-25-01 handoff package.
 * Plain node: node verify.mjs [--live]
 * --live additionally checks the live worktree (HEAD, branch sync, latest
 * record sha, .artifacts manifest count) instead of package-internal facts.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
const SPEC_SHA = '4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80'
const RECORD_SHA = '243af43ad9065b0424afbfa90c0c26370e7968796d3db80751356f8458fae684'
const HEAD = '5bd766f9114174e4d78760977391ec62104a7868'

// 1. Manifest entries match bytes.
const manifestPath = resolve(here, 'manifest.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const entry of manifest.files) {
    const bytes = readFileSync(resolve(here, entry.path))
    check(`manifest ${entry.path}`, sha256(bytes) === entry.sha256 && bytes.byteLength === entry.bytes)
  }
} else {
  check('manifest.json present', false, 'run the manifest builder first')
}

// 2. Specification bytes.
check('original specification sha', sha256(readFileSync(resolve(here, 'original-specification.md'))) === SPEC_SHA)

// 3. JSON files parse; state facts.
const state = JSON.parse(readFileSync(resolve(here, 'state.json'), 'utf8'))
check('state head', state.head === HEAD)
check('state latest record sha', state.latestSealedRecord.sha256 === RECORD_SHA)
check('state unsealed is null', state.unsealedIncrement === null)
for (const name of ['changes.json', 'evidence-index.json']) {
  const parsed = JSON.parse(readFileSync(resolve(here, name), 'utf8'))
  check(`${name} parses`, parsed.schemaVersion === 1)
}
check('changes commit count', JSON.parse(readFileSync(resolve(here, 'changes.json'), 'utf8')).commitRange.count === 79)

// 4. Snapshots exist and differ from the authority only if the live reports moved on.
check('status snapshot present', existsSync(resolve(here, 'report-snapshots/IMPLEMENTATION_STATUS.md')))
check('traceability snapshot present', existsSync(resolve(here, 'report-snapshots/specification-traceability.json')))

// 5. Local markdown links resolve inside the package or the repo.
const manual = readFileSync(resolve(here, 'HANDOFF.md'), 'utf8')
const links = [...manual.matchAll(/\]\(([^)#]+?)(?:#[^)]*)?\)/gu)].map(m => m[1]).filter(l => !l.startsWith('http'))
for (const link of links) {
  const target = link.startsWith('../') || link.startsWith('../../') ? resolve(here, link) : resolve(here, link)
  check(`link ${link}`, existsSync(target))
}
check('manual trailing newline', manual.endsWith('\n') && !manual.endsWith('\n\n'))

// 6. LATEST points here.
const latest = JSON.parse(readFileSync(resolve(here, '../LATEST.json'), 'utf8'))
check('LATEST points at this package', latest.handoffId === '2026-09-25-01' && latest.entry === '2026-09-25-01/HANDOFF.md')

if (process.argv.includes('--live')) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
  check('live HEAD unchanged', head === HEAD, head)
  const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/agents/upstream-first'], { cwd: root }).toString().trim().split('\t')[0]
  check('live origin sync', remote === HEAD, remote)
  const record = readFileSync(resolve(root, 'artifacts/upstream-first/interrupted-transfer-source.json'))
  check('live latest record sha', sha256(record) === RECORD_SHA)
  const evidence = JSON.parse(readFileSync(resolve(root, 'artifacts/upstream-first/evidence.json'), 'utf8'))
  check('live latestSourceRecord', evidence.latestSourceRecord === 'artifacts/upstream-first/interrupted-transfer-source.json')
  const manifests = readdirSync(resolve(root, '.artifacts'), { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.endsWith('-before') && existsSync(resolve(root, '.artifacts', e.name, 'archive.json'))).length
  check('live archive manifests >= 151', manifests >= 151, String(manifests))
  const generator = readFileSync(resolve(root, 'artifacts/upstream-first/write-reports.mjs'), 'utf8')
  check('live generator keeps shared map', generator.includes('const archivedInputs = new Map()'))
}

const failed = checks.filter(c => !c.ok)
console.log(JSON.stringify({ total: checks.length, failed: failed.length, failures: failed.map(c => c.name) }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
