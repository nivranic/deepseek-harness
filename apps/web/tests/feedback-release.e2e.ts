// Keyless assembled-browser coverage for an explicitly selected FEEDBACK_ONLY
// test composition over the Web bundles and the real host wire. The scaffold
// mounts the shipped telemetry row against this suite's loopback collector:
// /feedback releases the privacy-safe event diagnostics through that record,
// the acknowledgement pins the feedback-gated disclosure sentence, and a
// second feedback releases only the sequence suffix after the first handoff.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { gunzipSync } from 'node:zlib'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria, captureStableAria,
  compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-release', import.meta.url))
// Reuse the platform-neutral read round (declared as this manifest's
// `session.source`) so privacy coverage includes successful tool
// arguments/results on every supported Host OS without a duplicate recording.
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.jsonl', import.meta.url))
const ACK_EXPECTED = join(SNAPSHOT_DIR, 'ack.expected.md')
const ACK_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'ack-expanded.expected.md')
const MODE = webSnapshotMode()

const PROMPT = 'Use the read tool twice in one assistant message: read a.txt and b.txt. Then reply with the single word DONE and stop.'
const FIRST_FEEDBACK = 'the diff view is unreadable'
const SECOND_FEEDBACK = 'the second remark'
const REASONING_MARKER = 'The user wants me to read a.txt and b.txt'
const TOOL_ARGUMENT_MARKERS = ['a.txt', 'b.txt'] as const
const TOOL_RESULT_MARKERS = ['1: alpha', '1: beta'] as const
const SYSTEM_PROMPT_MARKER = 'You are an AI agent powered by DeepSeek Harness.'
const SYSTEM_CONTEXT_MARKER = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'
const PRIVATE_IDENTITY_FILE = '.anonymous-user-id'

interface OtlpAttributeValue {
  readonly stringValue?: unknown
  readonly intValue?: unknown
}

interface OtlpAttribute {
  readonly key?: unknown
  readonly value?: OtlpAttributeValue
}

interface OtlpLogRecord {
  readonly attributes?: OtlpAttribute[]
}

interface OtlpScopeLogs {
  readonly logRecords?: OtlpLogRecord[]
}

interface OtlpResourceLogs {
  readonly scopeLogs?: OtlpScopeLogs[]
}

interface OtlpCapture {
  readonly resourceLogs?: OtlpResourceLogs[]
}

interface ReleasedEvent {
  readonly type: string
  readonly seq: number
}

const EXPECTED_FIRST_RELEASE_TYPES = [
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
  'agent/inbox/spliced',
  'turn/start',
  'agent/inbox/spliced',
  'step/start',
  'user/message',
  'user/message',
  'session/title',
  'request/header',
  'request/context',
  'assistant/chunk',
  'assistant/message',
  'tool/call',
  'tool/call',
  'tool/result',
  'tool/result',
  'step/end',
  'step/start',
  'assistant/chunk',
  'assistant/message',
  'step/end',
  'turn/end',
  'command/run',
  'feedback/record',
] as const

function attributeValue(record: OtlpLogRecord, key: string): OtlpAttributeValue | undefined {
  return record.attributes?.find(attribute => attribute.key === key)?.value
}

function releasedEvents(payload: string): ReleasedEvent[] {
  const capture = JSON.parse(payload) as OtlpCapture
  const records = capture.resourceLogs?.flatMap(resource =>
    resource.scopeLogs?.flatMap(scope => scope.logRecords ?? []) ?? []) ?? []
  return records.flatMap((record) => {
    const type = attributeValue(record, 'event.type')?.stringValue
    if (typeof type !== 'string') return []
    const rawSeq = attributeValue(record, 'event.seq')?.intValue
    let seq: number
    if (typeof rawSeq === 'number') {
      seq = rawSeq
    } else if (typeof rawSeq === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(rawSeq)) {
      seq = Number(rawSeq)
    } else {
      throw new Error(`OTLP event ${JSON.stringify(type)} has no integer event.seq`)
    }
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new Error(`OTLP event ${JSON.stringify(type)} has unsafe event.seq ${JSON.stringify(rawSeq)}`)
    }
    return [{ type, seq }]
  })
}

function expectStrictlyIncreasing(events: ReleasedEvent[]): void {
  expect(events.length).toBeGreaterThan(0)
  for (let index = 1; index < events.length; index += 1) {
    expect(events[index]!.seq).toBeGreaterThan(events[index - 1]!.seq)
  }
}

function expectPrivacySafeWire(wire: string, sensitiveValues: string[]): void {
  for (const sensitive of sensitiveValues) {
    expect(sensitive.length).toBeGreaterThan(0)
    for (const spelling of new Set([sensitive, sensitive.replaceAll('\\', '\\\\')])) {
      expect(wire).not.toContain(JSON.stringify(spelling).slice(1, -1))
    }
  }
}

async function readPrivateIdentityRoot(harnessHome: string): Promise<string> {
  const persisted = await readFile(join(harnessHome, PRIVATE_IDENTITY_FILE), 'utf8')
  const match = /^v1:([0-9a-f]{64})$/u.exec(persisted.trim())
  if (match === null) throw new Error('anonymous identity file is not a versioned private root seed')
  return match[1]!
}

describe.skipIf(MODE === 'record')('web e2e: feedback-gated release under an explicitly selected mode', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let collector: Server
  let sessionId = ''
  let privateIdentityRoot = ''
  let firstReleaseBoundary = -1
  const uploads: string[] = []

  beforeAll(async () => {
    collector = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk as Buffer))
      request.on('end', () => {
        const raw = Buffer.concat(chunks)
        uploads.push((request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString())
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      })
    })
    collector.listen(0, '127.0.0.1')
    await once(collector, 'listening')
    const address = collector.address()
    if (address === null || typeof address === 'string') throw new Error('collector has no port')
    scaffold = await launchWebScaffold({
      telemetryUrl: `http://127.0.0.1:${address.port}/v1/logs`,
      telemetryMode: 'FEEDBACK_ONLY',
      // The replayed session.jsonl belongs to the seeded-history scenario;
      // comparing (or refreshing) the persisted session here would rewrite
      // that shared source with this lane's feedback events. The release
      // evidence lives in this lane's golden and collector assertions.
      compareReplaySession: false,
      replayFixture: FIXTURE,
    })
    privateIdentityRoot = await readPrivateIdentityRoot(scaffold.harnessHome)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await Promise.all([
      writeFile(join(scaffold.workspaceCwd, 'workspace', 'a.txt'), 'alpha\n'),
      writeFile(join(scaffold.workspaceCwd, 'workspace', 'b.txt'), 'beta\n'),
    ])
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    collector?.close()
    collector?.closeAllConnections()
  })

  it('drives the recorded prompt to a settled turn (replay and refresh)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-release-drive'))
    // Drift guard: the shared fixture must carry exactly the drive prompt.
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const settledSessionId = await settled
    sessionId = String(settledSessionId)
    const agent = scaffold.ctx.agents.get(settledSessionId)
    if (agent === undefined) throw new Error(`settled session ${sessionId} has no live agent`)
    for (const [type, markers] of [
      ['request/header', [SYSTEM_PROMPT_MARKER]],
      ['user/message', [SYSTEM_CONTEXT_MARKER]],
      ['assistant/message', [REASONING_MARKER]],
      ['tool/call', TOOL_ARGUMENT_MARKERS],
      ['tool/result', TOOL_RESULT_MARKERS],
    ] as const) {
      const matchingEvents = agent.session.events.filter(event => event.type === type)
      for (const marker of markers) {
        expect(matchingEvents.some(event => JSON.stringify(event.data).includes(marker))).toBe(true)
      }
    }
    const toolResults = agent.session.events.filter(event => event.type === 'tool/result')
    expect(toolResults).toHaveLength(2)
    expect(toolResults.every(event => event.data.message.content[0].isError === false)).toBe(true)
  }, 60_000)

  it('releases privacy-safe diagnostics through the feedback and pins the disclosure', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-release'))
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    expect(uploads).toEqual([])
    const input = page.locator('[data-composer-input]').first()
    await input.fill(`/feedback ${FIRST_FEEDBACK}`)
    await input.press('Enter')

    await page.getByText(/Feedback recorded for session/).waitFor({ timeout: 10_000 })
    expect(await page.getByText(
      /recording feedback makes the privacy-safe diagnostics not yet shared eligible for the configured telemetry pipeline/,
    ).count()).toBe(1)

    // FEEDBACK_ONLY releases through the committed feedback event: exactly one
    // request reaches the collector with the whole privacy-safe sequence prefix.
    await expect.poll(() => uploads.length, { timeout: 15_000 }).toBe(1)
    const firstRelease = releasedEvents(uploads[0]!)
    expectStrictlyIncreasing(firstRelease)
    expect(firstRelease.map(event => event.type)).toEqual(EXPECTED_FIRST_RELEASE_TYPES)
    expect(firstRelease.at(-1)?.type).toBe('feedback/record')
    firstReleaseBoundary = firstRelease.at(-1)!.seq
    expectPrivacySafeWire(uploads[0]!, [
      PROMPT,
      FIRST_FEEDBACK,
      REASONING_MARKER,
      ...TOOL_ARGUMENT_MARKERS,
      ...TOOL_RESULT_MARKERS,
      SYSTEM_PROMPT_MARKER,
      SYSTEM_CONTEXT_MARKER,
      scaffold.workspaceCwd,
      scaffold.persistenceRoot,
      scaffold.harnessHome,
      sessionId,
      privateIdentityRoot,
    ])

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ACK_EXPECTED, snapshot, MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(ACK_EXPANDED_EXPECTED, expanded, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('releases only the records since the last handoff on a second feedback', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-release-suffix'))
    const input = page.locator('[data-composer-input]').first()
    await input.fill(`/feedback ${SECOND_FEEDBACK}`)
    await input.press('Enter')
    await expect.poll(() => uploads.length, { timeout: 15_000 }).toBe(2)
    const secondRelease = releasedEvents(uploads[1]!)
    expectStrictlyIncreasing(secondRelease)
    expect(secondRelease.map(event => event.type)).toEqual([
      'command/done', 'command/run', 'feedback/record',
    ])
    expect(secondRelease[0]!.seq).toBe(firstReleaseBoundary + 1)
    expect(secondRelease.every(event => event.seq > firstReleaseBoundary)).toBe(true)
    expect(secondRelease.at(-1)?.type).toBe('feedback/record')
    expectPrivacySafeWire(uploads[1]!, [
      PROMPT,
      FIRST_FEEDBACK,
      SECOND_FEEDBACK,
      REASONING_MARKER,
      ...TOOL_ARGUMENT_MARKERS,
      ...TOOL_RESULT_MARKERS,
      SYSTEM_PROMPT_MARKER,
      SYSTEM_CONTEXT_MARKER,
      scaffold.workspaceCwd,
      scaffold.persistenceRoot,
      scaffold.harnessHome,
      sessionId,
      privateIdentityRoot,
    ])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ack.expected.md', 'ack-expanded.expected.md'])
  })
})
