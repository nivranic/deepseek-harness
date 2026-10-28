// One-off: emit the §43 same-candidate fixture from fixed inputs through the
// production producer, so the sealed artifact is derived, never hand-written.
import { writeFileSync } from 'node:fs'
import { buildSupportBundle, diagnosticsBundleEntry, sessionHeadersBundleEntry, settingsExportBundleEntry } from '../src/support-bundle.ts'

const diagnosticsSnapshot = {
  productVersion: '1.2.3',
  sourceRevision: '0123456789abcdef0123456789abcdef01234567',
  apiProtocolVersion: 1,
  sessionFormatVersion: 0,
  hostId: '11111111-2222-4333-8444-555555555555',
  platform: 'linux',
  arch: 'x64',
  runtimeMode: 'full',
  nodeVersion: 'v22.0.0',
  transports: [],
  capabilities: [],
  plugins: [{ moduleName: 'fixture-plugin', enabled: true, fiberPhase: 'active' }],
  migrations: [{ from: 0, to: 1, releasedIn: '1.0.0' }],
  crash: [],
  lastErrors: [
    { time: 1700000000000, name: 'Error', message: 'call failed: [redacted:assignment]', agentId: 'agent-1', turn: 2, step: 1 },
  ],
  health: {
    process: { state: 'up', detail: 'pid 1' },
    runtime: { state: 'up', detail: 'node v22.0.0' },
    sessionStore: { state: 'up', detail: 'sessionPersistence is composed' },
    pluginState: { state: 'up', detail: 'pluginInventory is composed' },
    connection: { state: 'down', detail: 'webServer is not composed' },
    modelProvider: { state: 'up', detail: 'llm is composed' },
    ready: true,
  },
}

const bundle = buildSupportBundle([
  diagnosticsBundleEntry(diagnosticsSnapshot),
  sessionHeadersBundleEntry([
    { id: 'sess-a', createdAt: 1700000000000, isSeeded: false, revision: 'r1', cwd: '/tmp/one', eventCount: 12, sizeBytes: 2048 },
    { id: 'sess-b', createdAt: 1700000000999, isSeeded: true, revision: 'r2', parentSession: 'sess-a' },
  ]),
  settingsExportBundleEntry([
    { ns: 'llm.deepseek', revision: 3, applies: 'live', value: { model: 'deepseek-chat' }, redacted: ['apiKey'] },
    { ns: 'web.search', revision: 1, applies: 'restart', value: { enabled: false }, redacted: [] },
  ]),
])

writeFileSync(new URL('./fixtures/support-bundle-candidate.json', import.meta.url), `${JSON.stringify(bundle, null, 2)}\n`)
console.log('candidate checksum:', bundle.checksum)
