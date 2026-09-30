/** A real Host SIGKILL restart reconnects the paired Android companion while invalidating its staged upload receipts. */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { probeFreePort, REPO_ROOT } from './support.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const execute = promisify(execFile)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const BUDGET_CAPABILITY = 'native-remote.http-request-budget.v1'
const DEDUPE_CAPABILITY = 'file-upload.dedupe.v1'

/** Public identity facts one Host process reports over private IPC. */
interface HostFacts {
  pid: number
  nativePort: number
  spkiFingerprint: string
  hostId: string
  displayName: string
  capabilities: readonly string[]
  devices: number
}

type HostMessage =
  | ({ kind: 'ready' } & HostFacts)
  | ({ kind: 'describe'; rid: number } & HostFacts)
  | { kind: 'pairing'; rid: number; code: string; expiresAt: number; role: string }
  | { kind: 'session'; rid: number; sessionId: string }
  | { kind: 'observed'; rid: number }
  | { kind: 'flushed'; rid: number; flushed: boolean }
  | { kind: 'error'; rid: number; message: string }
  | { kind: 'session-event'; type: 'user/message'; seq: number; source: string }
  | { kind: 'session-event'; type: 'turn/end'; turn: number; reason: string }

type HostReply = Exclude<HostMessage, { kind: 'ready' } | { kind: 'session-event' }>

interface DraftAttachment {
  type: 'image' | 'file'
  receiptId: string
  attachmentId: string
  name?: string
  bytes: number
}

interface MixedDraft {
  requestId: string | null
  text: string
  attachments: DraftAttachment[]
}

interface InputSnapshot {
  pid: number
  hostId: string | null
  hostKey: string | null
  generation: number
  sessionOwner: number
  sessionId: string | null
  input: {
    drafts: Record<string, MixedDraft>
    pending: Record<string, { sessionId: string; draft: MixedDraft }>
    lastSessionId: string | null
  }
}

interface HttpSnapshot { started: number; finished: number; generation: number }

it.skipIf(!process.env.DSH_ANDROID_ADB)('Android reconnects after a real Host SIGKILL restart and replaces the lost upload receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-android-host-restart-'))
  const home = join(root, 'home')
  const profile = join(home, 'profiles', 'hostrestart')
  const workspace = join(root, 'workspace')
  await mkdir(profile, { recursive: true })
  await mkdir(workspace, { recursive: true })
  const webPort = await probeFreePort()
  // The native listener keeps one fixed port so the SIGKILL restart and the driver's adb reverse stay aligned.
  const nativePort = await probeFreePort()
  expect(nativePort).not.toBe(webPort)
  const mock = await startMockLlmServer({ sequence: ['success'], successText: 'Companion reconnect acknowledged' })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-hostrestart', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  const fixture = new URL('./android-host-restart.fixture.ts', import.meta.url).href
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
    { id: 'webserver', config: { host: '127.0.0.1', port: webPort } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false } },
    { id: 'llm-deepseek', config: { baseURL: mock.baseURL, apiKeyEnv: 'DSH_ANDROID_RESTART_KEY' } },
    { id: 'agent-instructions', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'open-in-app', disabled: true },
    { id: 'ui-open-in-app', disabled: true },
    { id: 'skill-filesystem', config: {
      dshHome: join(root, 'skills'), agentsHome: join(root, 'agents'), bundledSkillDir: join(root, 'bundled'), watch: false,
    } },
    { id: 'agent-presets', config: { default: 'standard', includeUserRoot: false } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      // An absolute entry keeps plugin-package-inventory identity resolution working: the
      // resolver walks up from the module to its package manifest, while a bare name would
      // require an installed node_modules link this isolated profile never has.
      { id: 'native-remote', name: pathToFileURL(join(REPO_ROOT, 'packages', 'api', 'native-remote', 'src', 'index.ts')).href, config: {
        host: '127.0.0.1', port: nativePort, maxConnections: 16,
        maxRequestBodyBytes: 1048576, maxWebSocketMessageBytes: 1048576, maxStreamsPerConnection: 32,
        requestTimeoutMs: 30000, headersTimeoutMs: 10000, handshakeTimeoutMs: 10000, websocketHeartbeatIntervalMs: 2000,
        certificateLifetimeDays: 365, certificateRenewBeforeDays: 30,
      } },
      { id: 'android-host-restart-fixture', name: fixture, config: {} },
    ] },
  ]))
  const adb = process.env.DSH_ANDROID_ADB!
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 30_000 })
  const identifier = randomUUID()
  const filename = `dsh-host-restart-${identifier}-data.bin`
  const fileBytes = Buffer.from([0, 255, 42, 13, 10, 128, 7])
  const fileDigest = digest(fileBytes)
  const storedPath = join(home, 'attachments', 'v1', 'files', fileDigest.slice(0, 2), fileDigest, filename)
  const localFile = join(root, filename)
  const destination = `/sdcard/Download/${filename}`
  const text = 'Attachment intent captured before the Host restart'
  const replacementText = 'Replacement intent sent after the Host restart'
  let child: ChildProcess | undefined
  let exited: Promise<void> | undefined
  let messages: HostMessage[] = []
  let replyRid = 0
  const replyWaiters = new Map<number, { resolve: (message: HostReply) => void; reject: (error: Error) => void }>()
  const failures: unknown[] = []
  let stderr = ''
  let ownsDeviceFile = false
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  let sessionId: string | undefined
  const folder = fileURLToPath(new URL('../../../.artifacts/android-host-restart-ui/', import.meta.url))
  function start(): void {
    messages = []
    child = spawn(process.execPath, [
      '--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href,
      join(REPO_ROOT, 'apps/cli/src/bin.ts'), '--profile', 'hostrestart',
    ], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      env: { ...process.env, DSH_HOME: home, DSH_ANDROID_RESTART_KEY: 'test-only', DEEPSEEK_API_KEY: '',
        DEEPSEEK_BASE_URL: mock.baseURL,
        DSH_AGENTS_HOME: join(root, 'agents'), DSH_BUNDLED_SKILL_DIR: join(root, 'bundled'),
        NODE_OPTIONS: '', TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json') },
    })
    child.on('message', (message: HostMessage) => {
      messages.push(message)
      if (!('rid' in message)) return
      const waiter = replyWaiters.get(message.rid)
      if (waiter === undefined) return
      replyWaiters.delete(message.rid)
      if (message.kind === 'error') waiter.reject(new Error(`Host fixture request failed: ${message.message}`))
      else waiter.resolve(message)
    })
    child.stdout?.on('data', (data: Buffer) => { stderr += data.toString().replace(/token=[^\s"']+/g, 'token=REDACTED') })
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString().replace(/token=[^\s"']+/g, 'token=REDACTED') })
    exited = new Promise<void>((resolve, reject) => {
      child!.once('error', reject)
      child!.once('exit', () => { resolve() })
    })
  }
  async function ready(): Promise<HostFacts & { kind: 'ready' }> {
    await expect.poll(() => messages.some(message => message.kind === 'ready'), { timeout: 60_000 }).toBe(true)
    return messages.find(message => message.kind === 'ready') as HostFacts & { kind: 'ready' }
  }
  function request(kind: 'issuePairing' | 'describe' | 'createSession' | 'observe' | 'flush', extra: { cwd?: string; sessionId?: string } = {}): Promise<HostReply> {
    const rid = ++replyRid
    return new Promise<HostReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        replyWaiters.delete(rid)
        reject(new Error(`Host fixture request ${kind} timed out`))
      }, 30_000)
      replyWaiters.set(rid, {
        resolve: (message) => { clearTimeout(timer); resolve(message) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      child!.send({ kind, rid, ...extra })
    })
  }
  async function readEvents(target: string): Promise<readonly SessionEvent[]> {
    const reader = new Context()
    try {
      await reader.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
      const handle = await reader.sessionPersistence.open(SessionId(target), 'read')
      try {
        return (await handle.read()).events
      } finally {
        await handle.close()
      }
    } finally {
      await reader.fiber.dispose()
    }
  }
  const command = async (request_: object) => {
    const result = await driver!.request(request_)
    expect(result.type, JSON.stringify(result)).toBe('ok')
    return result.value
  }
  const snapshot = async () => await command({ op: 'foregroundSnapshot' }) as InputSnapshot
  const http = async () => await command({ op: 'nativeHttpSnapshot' }) as HttpSnapshot
  const draft = async () => await command({ op: 'assertMixedAttachments' }) as MixedDraft
  const capture = async (name: string) => {
    await command({ op: 'hidePromptKeyboard' })
    const image = await command({ op: 'screenshot' })
    if (typeof image !== 'string') throw new Error('Missing Android screenshot')
    await writeFile(join(folder, name), Buffer.from(image, 'base64'))
  }
  const pickFile = async () => {
    await command({ op: 'openAttachmentPicker' })
    await command({ op: 'finishAttachmentPick', filename })
  }
  let stage = 'prepare'
  try {
    await mkdir(folder, { recursive: true })
    await writeFile(localFile, fileBytes)
    ownsDeviceFile = true
    await run('push', localFile, destination)
    stage = 'first-host-process'
    start()
    const first = await ready()
    expect(first.nativePort).toBe(nativePort)
    expect(first.capabilities).toContain(BUDGET_CAPABILITY)
    expect(first.devices).toBe(0)
    const created = await request('createSession', { cwd: workspace }) as { kind: 'session'; sessionId: string }
    sessionId = created.sessionId
    stage = 'pair-and-stage'
    driver = await startAndroidCompanionUiDriver(adb, serial, nativePort, true)
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const pairing = await request('issuePairing') as { kind: 'pairing'; code: string; expiresAt: number; role: string }
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${nativePort}`,
      hostId: first.hostId, displayName: first.displayName, spkiFingerprint: first.spkiFingerprint,
      code: pairing.code, expiresAt: pairing.expiresAt, role: pairing.role,
    } })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'fillPromptDraft', text })
    await pickFile()
    await command({ op: 'awaitAttachmentReady' })
    const beforeRestart = await draft()
    expect(beforeRestart.text).toBe(text)
    const staged = beforeRestart.attachments[0]!
    expect(staged.type).toBe('file')
    expect(staged.receiptId.length).toBeGreaterThan(0)
    expect(staged.attachmentId).toBe(`sha256:${fileDigest}`)
    expect(staged.name).toBe(filename)
    expect(staged.bytes).toBe(fileBytes.length)
    const beforeKill = await snapshot()
    expect(beforeKill.sessionId).toBe(sessionId)
    expect(beforeKill.input.drafts[sessionId]).toEqual(beforeRestart)
    const httpBeforeKill = await http()
    expect(httpBeforeKill.started).toBe(httpBeforeKill.finished)
    // The uploaded bytes are durable Host storage; the receipt is only process-local staging.
    const storedBeforeKill = await stat(storedPath)
    expect(digest(await readFile(storedPath))).toBe(fileDigest)
    await request('flush', { sessionId })
    stage = 'host-sigkill'
    expect(child!.kill('SIGKILL')).toBe(true)
    await exited
    stage = 'second-host-process'
    start()
    const second = await ready()
    // Durable identity survives the abrupt restart while the process itself is new.
    expect(second.pid).not.toBe(first.pid)
    expect(second.hostId).toBe(first.hostId)
    expect(second.spkiFingerprint).toBe(first.spkiFingerprint)
    expect(second.nativePort).toBe(nativePort)
    expect(second.capabilities).toContain(BUDGET_CAPABILITY)
    expect(second.capabilities).toContain(DEDUPE_CAPABILITY)
    expect(second.devices).toBe(1)
    expect(digest(await readFile(storedPath))).toBe(fileDigest)
    const described = await request('describe') as { kind: 'describe' } & HostFacts
    expect(described.spkiFingerprint).toBe(first.spkiFingerprint)
    expect(described.devices).toBe(1)
    await request('observe', { sessionId })
    stage = 'companion-reconnect'
    await driver.setHostReachable(false)
    await driver.setHostReachable(true)
    const survived = await snapshot()
    expect(survived.pid).toBe(beforeKill.pid)
    expect(survived.hostId).toBe(beforeKill.hostId)
    expect(survived.hostKey).toBe(beforeKill.hostKey)
    expect(survived.generation).toBe(beforeKill.generation)
    expect(survived.sessionOwner).toBe(beforeKill.sessionOwner)
    expect(survived.sessionId).toBe(sessionId)
    expect(survived.input.drafts[sessionId]).toEqual(beforeRestart)
    await command({ op: 'returnToSessionList' })
    await command({ op: 'openSession', sessionId })
    expect(await draft()).toEqual(beforeRestart)
    await capture('reconnected-session.png')
    stage = 'old-receipt-refused'
    await command({ op: 'failPromptDraft', text })
    expect(await command({ op: 'assertAttachmentReceiptRefusal' })).toEqual({
      code: 'session/attachment-invalid', reason: 'FILE_NOT_STAGED',
    })
    await capture('rejected-old-receipt.png')
    const pendingId = await command({ op: 'pendingPrompt', text }) as string
    expect(pendingId).toBe(beforeRestart.requestId)
    // A newer composer draft survives: discard also forgets a draft sharing the pending request identity.
    await command({ op: 'replacePromptDraft', text: replacementText })
    const edited = await draft()
    expect(edited.text).toBe(replacementText)
    expect(edited.attachments).toEqual(beforeRestart.attachments)
    expect(edited.requestId).not.toBe(beforeRestart.requestId)
    await command({ op: 'hidePromptKeyboard' })
    await command({ op: 'assertPendingPromptVisible', requestId: pendingId })
    await command({ op: 'discardPendingPrompt', requestId: pendingId })
    stage = 'receipt-replacement'
    await command({ op: 'removeAttachment', receiptId: beforeRestart.attachments[0]!.receiptId })
    await pickFile()
    await command({ op: 'awaitAttachmentReady' })
    const replacement = await draft()
    expect(replacement.text).toBe(replacementText)
    expect(replacement.attachments).toMatchObject([
      { type: 'file', attachmentId: `sha256:${fileDigest}`, name: filename, bytes: fileBytes.length },
    ])
    expect(replacement.attachments[0]!.receiptId).not.toBe(beforeRestart.attachments[0]!.receiptId)
    expect(replacement.requestId).not.toBe(beforeRestart.requestId)
    // The surviving companion remembers the digest it already uploaded, so the re-upload
    // resolves through uploadDedupe: the stored object is never rewritten after the restart.
    const storedAfterDedupe = await stat(storedPath)
    expect(storedAfterDedupe.mtimeMs).toBe(storedBeforeKill.mtimeMs)
    expect(storedAfterDedupe.size).toBe(storedBeforeKill.size)
    // The deduplication probe and the reconnect still issue fresh HTTP calls through the restarted Host.
    const httpAfterRestart = await http()
    expect(httpAfterRestart.started).toBe(httpAfterRestart.finished)
    expect(httpAfterRestart.started).toBeGreaterThan(httpBeforeKill.started)
    expect(digest(await readFile(storedPath))).toBe(fileDigest)
    stage = 'explicit-send'
    await command({ op: 'submitPromptDraft' })
    await expect.poll(() => messages.some(message => message.kind === 'session-event' && message.type === 'user/message'), { timeout: 60_000 }).toBe(true)
    const accepted = messages.find(message => message.kind === 'session-event' && message.type === 'user/message') as { kind: 'session-event'; seq: number; source: string }
    expect(accepted.source).toBe('user')
    await expect.poll(() => messages.some(message => message.kind === 'session-event' && message.type === 'turn/end'), { timeout: 60_000 }).toBe(true)
    await command({ op: 'assertNoPendingPrompt' })
    const sent = await snapshot()
    expect(sent.input.drafts[sessionId]).toBeUndefined()
    expect(sent.input.pending).toEqual({})
    await command({ op: 'assertAttachmentMessage', seq: accepted.seq, names: [filename] })
    await capture('final-send.png')
    await request('flush', { sessionId })
    const events = await readEvents(sessionId)
    const recorded = events.filter(event => event.type === 'user/message')
    const userMessages = recorded.filter(event => event.data.source.kind === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]!.data.source).toMatchObject({ kind: 'user', rpcId: replacement.requestId })
    expect(userMessages[0]!.data.content).toEqual([
      { type: 'text', text: replacementText },
      { type: 'file', attachment: { attachmentId: `sha256:${fileDigest}`, name: filename, bytes: fileBytes.length } },
    ])
    expect(events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { turn: 1, reason: { kind: 'completed' } } }])
    expect(mock.requests).toHaveLength(1)
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    driver = undefined
    await writeFile(join(folder, 'observation.json'), JSON.stringify({
      receiptAcrossRestart: 'invalidated',
      refusal: { code: 'session/attachment-invalid', reason: 'FILE_NOT_STAGED' },
      durableAcrossRestart: { hostId: true, spkiFingerprint: true, nativePort, storedFileBytes: true, deviceGrant: true },
      newProcess: { pid: second.pid, previousPid: first.pid },
      budgetCapabilityReadvertised: true,
      dedupeCapabilityReadvertised: true,
      reuploadRewroteStoredObject: false,
      httpCalls: { beforeKill: httpBeforeKill.started, afterRestart: httpAfterRestart.started },
      replacedReceipt: { old: beforeRestart.attachments[0]!.receiptId, replacement: replacement.attachments[0]!.receiptId },
      durableUserMessages: 1,
      modelRequests: mock.requests.length,
      sessionId,
    }, null, 2) + '\n')
  } catch (error) {
    failures.push(error)
    console.error('Android host restart progress', JSON.stringify({
      stage, sessionId,
      messages: messages.map(({ kind }) => ({ kind })),
      requests: mock.requests.map(({ behavior, outcome }) => ({ behavior, outcome })),
    }))
    await writeFile(join(folder, `host-restart-child-${Date.now()}.log`), stderr, { flag: 'wx' }).catch((writeError: unknown) => {
      failures.push(writeError)
    })
  } finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    child?.kill('SIGKILL')
    await exited?.catch((error: unknown) => { failures.push(error) })
    if (ownsDeviceFile) await run('shell', 'rm', '-f', '--', destination).catch((error: unknown) => { failures.push(error) })
    await mock.close().catch((error: unknown) => { failures.push(error) })
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Android host restart acceptance failed')
}, 300_000)
