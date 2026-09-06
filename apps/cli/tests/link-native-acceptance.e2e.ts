/**
 * Cross-language Link acceptance over the shipped base + desktop Host. The
 * TypeScript reference always runs the shared corpus; CI may additionally
 * supply one native driver argv through DSH_LINK_ACCEPTANCE_DRIVER_JSON.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type LinkAccessService from '@deepseek-ai/dsh-link-access'
import {
  LINK_CONTRACT_VERSION,
  LINK_PROTOCOL_VERSION,
  type LinkHostDescription,
  type LinkPairingPayload,
} from '@deepseek-ai/dsh-link-access/protocol'
import { LinkClient, LinkError } from '@deepseek-ai/dsh-link-client'
import {
  foldCompanionDomain,
  type CompanionDomainState,
  type CompanionRecord,
} from '@deepseek-ai/dsh-link-contracts'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import {
  startMockLlmServer,
  type MockLlmServer,
} from '@deepseek-ai/dsh-llm-mock-server'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import {
  createProcessInspector,
  type ProcessIdentity,
} from '@deepseek-ai/dsh-subprocess-local/src/process-inspector.ts'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const DESKTOP_PATCH = join(REPO_ROOT, 'packages/bundle/desktop-app/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
const CORPUS_PATH = join(REPO_ROOT, 'packages/remote/link-contracts/acceptance/corpus.v1.json')
const MOCK_CREDENTIAL_REF = 'DSH_LINK_ACCEPTANCE_MOCK_KEY'
const MOCK_CREDENTIAL = 'link-acceptance-mock-key'
const HOST_DEVICE_NAME = 'Link Acceptance Host'
const TEARDOWN_DEADLINE_MS = 60_000
const EVIDENCE_RENAME_DEADLINE_MS = 75_000
const AFTER_ALL_HOOK_TIMEOUT_MS = 120_000
const CONTROL_REQUEST_TIMEOUT_MS = 30_000
const NATIVE_DRIVER_TIMEOUT_MS = 480_000
const NATIVE_PROCESS_GRACE_MS = 2_000
const NATIVE_PROCESS_OUTPUT_MAX_BYTES = 5 * 1024 * 1024
const NATIVE_CANDIDATE_UNLINK_TIMEOUT_MS = 5_000
const PROCESS_TREE_REGRESSION_TIMEOUT_MS = 10_000
const PROCESS_TREE_RESULT_NAME = 'process-tree.json'
const PROCESS_TREE_CANDIDATE_NAME = 'native-candidate.json'
const PROCESS_TREE_REGRESSION_CONTROL_TOKEN = 'timeout-regression-control-token'
const PROCESS_TREE_RETAINED_SECRET_SUFFIX_BYTES = 8
const SENSITIVE_PROJECTION_SENTINEL = 'dsh-link-private-projection-7f3c9b1e'
const PROJECTION_DIGEST_ENCODING =
  'SHA-256 of UTF-8 Node.js JSON.stringify output after JSON.parse, preserving parsed property order' as const
const PROCESS_INSPECTOR = createProcessInspector()
const STEP_IDS = [
  'pair',
  'connect',
  'describe',
  'list',
  'open',
  'history',
  'follow',
  'prompt',
  'stream',
  'approval',
  'cancel',
  'reconnect',
  'revoke',
] as const
const NATIVE_ARGV = {
  swift: ['swift', 'run', '--package-path', 'apps/apple', 'LinkNativeAcceptance'],
  kotlin: ['apps/android/gradlew', '--no-daemon', '-p', 'apps/android', ':core:nativeAcceptance'],
} as const
const HOST_EXECUTION_INPUTS = [
  '.gitignore',
  'package.json',
  'pnpm-workspace.yaml',
  'scripts/test-invariants.ts',
  'tsconfig.base.json',
  'tsconfig.json',
  'vitest.e2e.config.ts',
  'vitest.shared.ts',
  'apps/cli/config',
  'apps/cli/package.json',
  'apps/cli/tests/link-native-acceptance.e2e.ts',
  'native/landlock-run',
  'packages',
  'patches',
  'pnpm-lock.yaml',
  'vendor',
] as const
const NATIVE_EXECUTION_INPUTS = {
  swift: [
    '.github/workflows/apple-swift.yml',
    'apps/apple',
  ],
  kotlin: [
    '.github/workflows/android-kotlin.yml',
    'apps/android',
  ],
} as const
const HOST_IGNORED_EXECUTION_ROOTS = [
  'apps/cli/config',
  'apps/cli/tests',
  'native/landlock-run',
  'packages',
  'patches',
  'scripts',
  'vendor',
] as const
const IGNORED_BUILD_CACHE_SEGMENTS: ReadonlySet<string> = new Set([
  '.build',
  '.cache',
  '.gradle',
  '.idea',
  '.kotlin',
  '.pnpm',
  '.swiftpm',
  '.tmp',
  '.turbo',
  '.vite',
  '.vscode',
  'DerivedData',
  'build',
  'coverage',
  'dist',
  'lib',
  'node_modules',
  'out',
  'target',
  'tmp',
])
const IGNORED_EXECUTION_EXTENSIONS: ReadonlySet<string> = new Set([
  'bat', 'c', 'cc', 'cjs', 'cmd', 'cpp', 'cts', 'entitlements', 'gradle', 'groovy',
  'h', 'hh', 'hpp', 'hxx', 'java', 'js', 'json', 'jsonc', 'jsx', 'kt', 'kts', 'lock',
  'm', 'mjs', 'mm', 'mts', 'node', 'patch', 'pbxproj', 'plist', 'properties', 'proto',
  'ps1', 'py', 'rs', 'sh', 'sql', 'swift', 'toml', 'ts', 'tsx', 'wasm', 'xcconfig',
  'xml', 'yaml', 'yml',
])

type StepId = typeof STEP_IDS[number]
type SimpleStepId = Exclude<StepId, 'list' | 'history' | 'prompt' | 'approval' | 'reconnect'>

/** One corpus action whose success has no additional data-owned expectation. */
interface SimpleAcceptanceStep { readonly id: SimpleStepId }

/** Exact session visibility expected from the list operation. */
interface ListAcceptanceStep {
  readonly id: 'list'
  readonly targetSessionId: string
  readonly decoySessionId: string
  readonly expectedSessionIds: readonly string[]
}

/** Target history relation and decoy refusal expected from the history operation. */
interface HistoryAcceptanceStep {
  readonly id: 'history'
  readonly targetSessionId: string
  readonly decoySessionId: string
  readonly expectedTargetRelation: 'matches-follow-opening'
  readonly decoyErrorCode: string
}

/** Prompt admission, output, and decoy refusal expected from the prompt operation. */
interface PromptAcceptanceStep {
  readonly id: 'prompt'
  readonly targetSessionId: string
  readonly decoySessionId: string
  readonly text: string
  readonly expectedAccepted: true
  readonly expectedResponseText: string
  readonly decoyErrorCode: string
}

/** Approval request and outcome expected from the approval operation. */
interface ApprovalAcceptanceStep {
  readonly id: 'approval'
  readonly stallPrompt: string
  readonly outcome: 'allowed-once'
}

/** Streaming-loss recovery expectations shared by every acceptance driver. */
interface RecoveryAcceptanceSemantics {
  readonly prompt: string
  readonly faultAfter: 'first-assistant-chunk'
  readonly expectedTerminalKind: 'completed'
  readonly minimumOfflineSeqAdvance: 1
  readonly expectedFollowReplacementCount: 2
  readonly expectedEventReplacementCount: 2
  readonly expectedSameCutReconnectCount: 1
  readonly expectedSnapshotHasMore: false
  readonly expectedFinalProjectionRelation: 'authoritative-snapshot-fold'
}

/** One interruption followed by exactly one authoritative replacement per active stream. */
interface ReconnectAcceptanceStep {
  readonly id: 'reconnect'
  readonly fault: 'interrupt-active-streams'
  readonly expectedFollowReplacementCount: 1
  readonly expectedEventReplacementCount: 1
  readonly expectedAuthoritativeSnapshot: true
  readonly expectedClientIdRefresh: true
  readonly recovery: RecoveryAcceptanceSemantics
}

type AcceptanceStep =
  | SimpleAcceptanceStep
  | ListAcceptanceStep
  | HistoryAcceptanceStep
  | PromptAcceptanceStep
  | ApprovalAcceptanceStep
  | ReconnectAcceptanceStep

/** Parsed shared acceptance input plus its exact file digest. */
interface AcceptanceCorpus {
  readonly schemaVersion: 1
  readonly contractVersion: number
  readonly steps: readonly AcceptanceStep[]
  readonly sha256: string
}

/** Temporary configuration consumed by a native acceptance process. */
interface AcceptanceConfig {
  readonly schemaVersion: 1
  readonly language: string
  readonly corpusPath: string
  readonly candidateResultPath: string
  readonly pairing: LinkPairingPayload
  readonly sessionId: string
  readonly controlEndpoint: string
  readonly controlToken: string
  readonly hostCommit: string
  readonly clientCommit: string
  readonly expectedResponseText: string
  readonly deviceName: string
}

/** Candidate result retained only inside the isolated acceptance home. */
interface AcceptanceResult {
  readonly schemaVersion: 1
  readonly language: string
  readonly corpusSha256: string
  readonly hostCommit: string
  readonly clientCommit: string
  readonly linkProtocolVersion: number
  readonly contractVersion: number
  readonly sessionFormatVersion: number
  readonly steps: readonly { readonly id: StepId; readonly status: 'PASS' }[]
  readonly recovery: RecoveryAcceptanceResult
}

/** Recovery observations emitted by a driver and independently checked by the Host. */
interface RecoveryAcceptanceResult {
  readonly preFaultSeq: number
  readonly recoverySnapshotCursor: number
  readonly repeatedSnapshotCursor: number
  readonly offlineSeqCount: number
  readonly recoverySnapshotHasMore: false
  readonly followReplacementCount: number
  readonly eventReplacementCount: number
  readonly beforeRepeatedReconnectProjection: CompanionDomainState
  readonly afterRepeatedReconnectProjection: CompanionDomainState
}

/** Privacy-safe PASS evidence written to the caller-owned result path. */
interface PublishedAcceptanceResult {
  readonly schemaVersion: 1
  readonly recordKind: 'privacy-safe-acceptance-summary'
  readonly status: 'PASS'
  readonly language: string
  readonly corpusSha256: string
  readonly hostCommit: string
  readonly clientCommit: string
  readonly linkProtocolVersion: number
  readonly contractVersion: number
  readonly sessionFormatVersion: number
  readonly steps: readonly { readonly id: StepId; readonly status: 'PASS' }[]
  readonly recovery: PublishedRecoveryAcceptanceResult
}

/** Aggregate recovery facts that cannot disclose Session projection payloads. */
interface PublishedRecoveryAcceptanceResult {
  readonly preFaultSeq: number
  readonly recoverySnapshotCursor: number
  readonly repeatedSnapshotCursor: number
  readonly offlineSeqCount: number
  readonly recoverySnapshotHasMore: false
  readonly followReplacementCount: number
  readonly eventReplacementCount: number
  readonly projectionItemCount: number
  readonly projectionPlanActive: boolean
  readonly projectionTodoCount: number
  readonly projectionGoalCount: number
  readonly projectionToolCallCount: number
  readonly projectionImageCount: number
  readonly projectionArtifactCount: number
  readonly projectionEqualAfterRepeatedReconnect: true
  readonly beforeRepeatedReconnectProjectionSha256: string
  readonly afterRepeatedReconnectProjectionSha256: string
  readonly projectionDigestEncoding: typeof PROJECTION_DIGEST_ENCODING
}

/** Authoritative Session cut computed inside the Host control process. */
interface HostRecoveryEvidence {
  readonly preFaultSeq: number
  readonly hostFinalCursor: number
  readonly offlineSeqCount: number
  readonly snapshotHasMore: false
  readonly canonicalProjection: CompanionDomainState
}

/** Optional external driver decoded from the process environment. */
interface NativeDriver {
  readonly language: 'swift' | 'kotlin'
  readonly argv: readonly string[]
  readonly resultPath: string
}

type NativeProcess = ReturnType<typeof spawnNativeProcess>

/** External result owned by this run after its preexistence check passes. */
interface NativeArtifact {
  readonly language: NativeDriver['language']
  readonly resultPath: string
}

/** Privacy-safe native PASS result retained until every suite resource closes cleanly. */
interface NativePublication {
  readonly artifact: NativeArtifact
  readonly result: PublishedAcceptanceResult
}

/** Process identities and pre-cleanup settlement recorded by the runner regressions. */
interface ProcessTreeRegressionObservation {
  readonly childSentinelPresent: boolean
  readonly childPid: number
  readonly childStarted: string
  readonly grandchildSentinelPresent: boolean
  readonly grandchildPid: number
  readonly grandchildStarted: string
  readonly ready: true
  readonly terminatedBeforeCleanup?: boolean
}

/** Pre-identity process observation written by the native-driver fixture. */
type ProcessTreeRegressionSeed = Omit<
  ProcessTreeRegressionObservation,
  'childStarted' | 'grandchildStarted' | 'terminatedBeforeCleanup'
>

/** State retained while one external approval is pending or settled. */
type ApprovalState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'complete'; readonly outcome: ApprovalOutcome }
  | { readonly kind: 'failed'; readonly message: string }

type RevocationState =
  | { readonly kind: 'not-started' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'complete'; readonly deviceId: string }
  | { readonly kind: 'failed'; readonly message: string }

/** Host observations for one prepared reference or native driver. */
interface ControlObservation {
  readonly deviceName: string
  readonly modelRequestBaseline: number
  approvalStarts: number
  approval: ApprovalState | undefined
  recoveryOfflineSeq: number | undefined
  recovery: HostRecoveryEvidence | undefined
  revocation: RevocationState
  verified: boolean
}

/** Loopback-only coordinator that verifies Host recovery, approval, and revocation effects. */
interface AcceptanceControl {
  readonly endpoint: string
  readonly token: string
  prepare(deviceName: string): void
  verifyExpectedBehavior(): Promise<HostRecoveryEvidence>
  close(): Promise<void>
}

/** Original DSH_HOME value restored after the isolated composition stops. */
interface EnvironmentSnapshot {
  readonly present: boolean
  readonly value: string | undefined
}

/** Resources whose teardown must reach quiescence. */
interface AcceptanceSuite {
  readonly home: string
  readonly corpus: AcceptanceCorpus
  readonly nativeDriver: NativeDriver | undefined
  readonly mock: MockLlmServer
  readonly ctx: Context
  readonly link: LinkAccessService
  readonly control: AcceptanceControl
  readonly commit: string
  readonly nativeArtifact: NativeArtifact | undefined
  nativePublication: NativePublication | undefined
}

let suite: AcceptanceSuite | undefined
let dshHomeSnapshot: EnvironmentSnapshot | undefined
let activeNativeProcess: NativeProcess | undefined
let suiteFailed = false

function registerAcceptanceSuite(): void {
  beforeAll(async () => {
    dshHomeSnapshot = {
      present: Object.hasOwn(process.env, 'DSH_HOME'),
      value: process.env.DSH_HOME,
    }
    const home = await mkdtemp(join(tmpdir(), 'dsh-link-native-acceptance-'))
    process.env.DSH_HOME = home
    let mock: MockLlmServer | undefined
    let ctx: Context | undefined
    let control: AcceptanceControl | undefined
    let nativeArtifact: NativeArtifact | undefined
    let nativeFailureInitialized = false
    try {
      const nativeDriver = parseNativeDriver(
        process.env.DSH_LINK_ACCEPTANCE_DRIVER_JSON,
        process.env.DSH_LINK_ACCEPTANCE_LANGUAGE,
        process.env.DSH_LINK_ACCEPTANCE_RESULT,
        home,
      )
      if (nativeDriver !== undefined) {
        nativeArtifact = await claimNativeArtifact(nativeDriver, home)
        await writeSanitizedFailure(nativeArtifact.resultPath, nativeArtifact.language)
        nativeFailureInitialized = true
      }
      const commit = await assertExecutionInputsClean(nativeDriver?.language)
      const corpus = await readCorpus()
      const listStep = corpusStep(corpus, 'list')
      const promptStep = corpusStep(corpus, 'prompt')
      const reconnectStep = corpusStep(corpus, 'reconnect')
      mock = await startMockLlmServer({
        host: '127.0.0.1',
        port: 0,
        apiKey: MOCK_CREDENTIAL,
        sequence: nativeDriver === undefined
          ? ['success', 'stall', 'slow_success']
          : ['success', 'stall', 'slow_success', 'success', 'stall', 'slow_success'],
        successText: promptStep.expectedResponseText,
        chunkSize: 5,
        chunkDelayMs: 500,
        randomSeed: 1,
      })
      await writeFile(join(home, 'settings.yaml'), '{}\n')
      await writeFile(
        join(home, '.credentials.yaml'),
        `version: 1\nrefs:\n  ${MOCK_CREDENTIAL_REF}: ${MOCK_CREDENTIAL}\n`,
        { mode: 0o600 },
      )
      ctx = await bootComposition(home, mock.baseURL, listStep.targetSessionId)
      await ctx.sessionController.create({
        sessionId: SessionId(listStep.targetSessionId),
        cwd: join(home, 'workspace'),
      })
      await ctx.sessionController.create({
        sessionId: SessionId(listStep.decoySessionId),
        cwd: join(home, 'decoy-workspace'),
      })
      const link = ctx.get('linkAccess')
      if (link === undefined) throw new Error('shipped desktop composition did not mount Link access')
      await ctx.settings.update(settingsNamespace('remote'), {
        enabled: true,
        allowRemoteApproval: true,
        deviceName: HOST_DEVICE_NAME,
      })
      await waitFor(async () => {
        if (await link.endpoint() === undefined || !link.isRemoteApprovalAllowed()) {
          throw new Error('Link carrier is not ready for remote approval')
        }
      }, 'Link carrier bind')
      control = await startControl(ctx, link, mock, listStep.targetSessionId, reconnectStep.recovery)
      suite = {
        home,
        corpus,
        nativeDriver,
        mock,
        ctx,
        link,
        control,
        commit,
        nativeArtifact,
        nativePublication: undefined,
      }
    } catch (error) {
      const failures: unknown[] = [error]
      if (nativeArtifact !== undefined && !nativeFailureInitialized) {
        await containCleanup(
          writeSanitizedFailure(nativeArtifact.resultPath, nativeArtifact.language),
          failures,
        )
      }
      if (control !== undefined) await containCleanup(control.close(), failures)
      if (ctx !== undefined) await containCleanup(ctx.fiber.dispose(), failures)
      if (mock !== undefined) await containCleanup(mock.close(), failures)
      await containCleanup(rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }), failures)
      restoreDshHome()
      throw failures.length === 1
        ? error
        : new AggregateError(failures, 'Link native acceptance setup and cleanup failed')
    }
  }, 120_000)

  afterAll(async () => {
    const teardownStartedAt = performance.now()
    const cleanupDeadline = teardownStartedAt + TEARDOWN_DEADLINE_MS
    const evidenceRenameDeadline = teardownStartedAt + EVIDENCE_RENAME_DEADLINE_MS
    const current = suite
    suite = undefined
    const failures = await settleCleanupBeforeDeadline(
      cleanupAcceptanceSuite(current),
      cleanupDeadline,
    )
    restoreDshHome()
    await publishNativeEvidence(
      current?.nativeArtifact,
      current?.nativePublication,
      failures,
      evidenceRenameDeadline,
      () => suiteFailed,
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Link native acceptance teardown failed')
  }, AFTER_ALL_HOOK_TIMEOUT_MS)

  describe('the shared Link native acceptance corpus', () => {
    it('passes the TypeScript reference and an optional external native driver', async ({ signal }) => {
      onTestFailed(markSuiteFailed)
      const current = requireSuite()
      let nativePublication: NativePublication | undefined

      try {
        const referenceConfig = await driverConfig(current, 'typescript', 'Link Acceptance TypeScript')
        current.control.prepare(referenceConfig.deviceName)
        const reference = await runTypeScriptReference(referenceConfig, current.corpus)
        const referenceHostRecovery = await current.control.verifyExpectedBehavior()
        const validatedReference = validateResult(
          reference,
          referenceConfig,
          current.corpus,
          referenceHostRecovery,
        )

        if (current.nativeDriver !== undefined) {
          const nativeConfig = await driverConfig(
            current,
            current.nativeDriver.language,
            `Link Acceptance ${current.nativeDriver.language}`,
          )
          const nativeArtifact = current.nativeArtifact
          if (nativeArtifact === undefined) {
            throw new Error('native acceptance failure sentinel was not initialized')
          }
          current.control.prepare(nativeConfig.deviceName)
          const received = await runNativeDriver(
            current,
            current.nativeDriver,
            nativeConfig,
            signal,
          )
          const nativeHostRecovery = await current.control.verifyExpectedBehavior()
          const native = validateResult(received, nativeConfig, current.corpus, nativeHostRecovery)
          if (native.corpusSha256 !== validatedReference.corpusSha256
            || native.hostCommit !== validatedReference.hostCommit
            || native.clientCommit !== validatedReference.clientCommit
            || native.linkProtocolVersion !== validatedReference.linkProtocolVersion
            || native.contractVersion !== validatedReference.contractVersion
            || native.sessionFormatVersion !== validatedReference.sessionFormatVersion
            || !isDeepStrictEqual(native.steps, validatedReference.steps)) {
            throw new Error('native acceptance metadata does not match the TypeScript reference')
          }
          nativePublication = {
            artifact: nativeArtifact,
            result: toPublishedAcceptanceResult(native),
          }
        }

        const expectedBehaviors = current.nativeDriver === undefined
          ? ['success', 'stall', 'slow_success']
          : ['success', 'stall', 'slow_success', 'success', 'stall', 'slow_success']
        await waitFor(() => {
          if (current.mock.requests.length !== expectedBehaviors.length
          || current.mock.requests.some(request => request.outcome === undefined)) {
            throw new Error('mock LLM requests have not reached terminal outcomes')
          }
          return Promise.resolve()
        }, 'mock LLM terminal outcomes')
        expect(current.mock.requests.map(request => request.behavior)).toEqual(expectedBehaviors)
        expect(current.mock.requests.map(request => request.outcome)).toEqual(
          expectedBehaviors.map(behavior => behavior === 'stall' ? 'client_closed' : 'completed'),
        )
        await assertExecutionInputsClean(current.nativeDriver?.language, current.commit)

        if (nativePublication !== undefined) {
          current.nativePublication = nativePublication
        }
      } catch (error) {
        if (current.nativeArtifact !== undefined) {
          try {
            await writeSanitizedFailure(
              current.nativeArtifact.resultPath,
              current.nativeArtifact.language,
            )
          } catch (writeError) {
            throw new AggregateError(
              [error, writeError],
              'Link native acceptance failed and its sanitized result could not be written',
            )
          }
        }
        throw error
      }
    }, 600_000)
  })
}

/** Boot the shipped base + desktop patches with only test-owned storage and provider overrides. */
async function bootComposition(home: string, mockBaseUrl: string, targetSessionId: string): Promise<Context> {
  const patches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', DESKTOP_PATCH),
    { id: 'settings', config: { path: join(home, 'settings.yaml'), watch: false } },
    { id: 'credentials', config: { path: join(home, '.credentials.yaml'), watch: false } },
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    { id: 'device-trust', config: { path: join(home, 'device-trust.sqlite') } },
    {
      id: 'link-access',
      config: {
        dshHome: home,
        host: '127.0.0.1',
        port: 0,
        pairingAccess: { sessions: [targetSessionId], workspaces: [] },
      },
    },
    {
      id: 'llm-deepseek',
      config: {
        apiKeyEnv: MOCK_CREDENTIAL_REF,
        baseURL: `${mockBaseUrl}/v1`,
        thinking: 'disabled',
        reasoningEffort: 'off',
        streamIdleTimeoutMs: 60_000,
        retryPolicy: { mode: 'normal', maxRetries: 0 },
      },
    },
    {
      id: 'agent-presets',
      config: {
        default: 'standard',
        roots: [{ path: join(CONFIG_DIR, 'agent-presets'), trust: 'system' }],
        includeUserRoot: false,
      },
    },
  ]
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, home })
  const profileDir = join(home, 'profiles', 'link-native-acceptance')
  await mkdir(profileDir, { recursive: true })
  const profile = join(profileDir, 'cordis.yml')
  await writeFile(profile, '[]\n')
  return await boot('dsh-test', profile, patches, (bootCtx) => {
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

/** Parse and validate the one physical corpus used by every language. */
async function readCorpus(): Promise<AcceptanceCorpus> {
  const bytes = await readFile(CORPUS_PATH)
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown
  const root = requireRecord(parsed, 'acceptance corpus')
  if (!hasExactKeys(root, ['schemaVersion', 'contractVersion', 'steps'])
    || root.schemaVersion !== 1 || root.contractVersion !== LINK_CONTRACT_VERSION
    || !Array.isArray(root.steps) || root.steps.length !== STEP_IDS.length) {
    throw new Error('Link acceptance corpus has an unsupported schema or contract version')
  }
  const steps = root.steps.map((value, index): AcceptanceStep => {
    const step = requireRecord(value, `acceptance corpus step ${String(index + 1)}`)
    const expected = STEP_IDS[index] as StepId
    if (step.id !== expected) {
      throw new Error(`Link acceptance corpus step ${String(index + 1)} must be ${expected}`)
    }
    if (expected === 'list') {
      if (!hasExactKeys(step, [
        'decoySessionId',
        'expectedSessionIds',
        'id',
        'targetSessionId',
      ]) || !Array.isArray(step.expectedSessionIds)) {
        throw new Error('Link acceptance list step has invalid fields')
      }
      const targetSessionId = requireString(step.targetSessionId, 'list targetSessionId')
      const decoySessionId = requireString(step.decoySessionId, 'list decoySessionId')
      const expectedSessionIds = step.expectedSessionIds.map((value, expectedIndex) =>
        requireString(value, `list expectedSessionIds[${String(expectedIndex)}]`))
      if (targetSessionId === decoySessionId
        || expectedSessionIds.length !== 1
        || expectedSessionIds[0] !== targetSessionId) {
        throw new Error('Link acceptance list step must expose only its target session')
      }
      return { id: expected, targetSessionId, decoySessionId, expectedSessionIds }
    }
    if (expected === 'history') {
      if (!hasExactKeys(step, [
        'decoyErrorCode',
        'decoySessionId',
        'expectedTargetRelation',
        'id',
        'targetSessionId',
      ]) || step.expectedTargetRelation !== 'matches-follow-opening') {
        throw new Error('Link acceptance history step has invalid fields')
      }
      return {
        id: expected,
        targetSessionId: requireString(step.targetSessionId, 'history targetSessionId'),
        decoySessionId: requireString(step.decoySessionId, 'history decoySessionId'),
        expectedTargetRelation: step.expectedTargetRelation,
        decoyErrorCode: requireString(step.decoyErrorCode, 'history decoyErrorCode'),
      }
    }
    if (expected === 'prompt') {
      if (!hasExactKeys(step, [
        'decoyErrorCode',
        'decoySessionId',
        'expectedAccepted',
        'expectedResponseText',
        'id',
        'targetSessionId',
        'text',
      ]) || step.expectedAccepted !== true) {
        throw new Error('Link acceptance prompt step has invalid fields')
      }
      return {
        id: expected,
        targetSessionId: requireString(step.targetSessionId, 'prompt targetSessionId'),
        decoySessionId: requireString(step.decoySessionId, 'prompt decoySessionId'),
        text: requireString(step.text, 'prompt text'),
        expectedAccepted: true,
        expectedResponseText: requireString(step.expectedResponseText, 'prompt expectedResponseText'),
        decoyErrorCode: requireString(step.decoyErrorCode, 'prompt decoyErrorCode'),
      }
    }
    if (expected === 'approval') {
      if (!hasExactKeys(step, ['id', 'stallPrompt', 'outcome'])
        || typeof step.stallPrompt !== 'string' || step.stallPrompt.length === 0
        || step.outcome !== 'allowed-once') {
        throw new Error('Link acceptance approval step requires a stall prompt and allowed-once outcome')
      }
      return {
        id: expected,
        stallPrompt: step.stallPrompt,
        outcome: step.outcome,
      }
    }
    if (expected === 'reconnect') {
      if (!hasExactKeys(step, [
        'expectedAuthoritativeSnapshot',
        'expectedClientIdRefresh',
        'expectedEventReplacementCount',
        'expectedFollowReplacementCount',
        'fault',
        'id',
        'recovery',
      ])
        || step.fault !== 'interrupt-active-streams'
        || step.expectedFollowReplacementCount !== 1
        || step.expectedEventReplacementCount !== 1
        || step.expectedAuthoritativeSnapshot !== true
        || step.expectedClientIdRefresh !== true) {
        throw new Error('Link acceptance reconnect step has invalid fields')
      }
      const recovery = requireRecord(step.recovery, 'reconnect recovery')
      if (!hasExactKeys(recovery, [
        'expectedEventReplacementCount',
        'expectedFinalProjectionRelation',
        'expectedFollowReplacementCount',
        'expectedSameCutReconnectCount',
        'expectedSnapshotHasMore',
        'expectedTerminalKind',
        'faultAfter',
        'minimumOfflineSeqAdvance',
        'prompt',
      ])
        || recovery.faultAfter !== 'first-assistant-chunk'
        || recovery.expectedTerminalKind !== 'completed'
        || recovery.minimumOfflineSeqAdvance !== 1
        || recovery.expectedFollowReplacementCount !== 2
        || recovery.expectedEventReplacementCount !== 2
        || recovery.expectedSameCutReconnectCount !== 1
        || recovery.expectedSnapshotHasMore !== false
        || recovery.expectedFinalProjectionRelation !== 'authoritative-snapshot-fold') {
        throw new Error('Link acceptance reconnect recovery has invalid fields')
      }
      return {
        id: expected,
        fault: step.fault,
        expectedFollowReplacementCount: 1,
        expectedEventReplacementCount: 1,
        expectedAuthoritativeSnapshot: true,
        expectedClientIdRefresh: true,
        recovery: {
          prompt: requireString(recovery.prompt, 'reconnect recovery prompt'),
          faultAfter: 'first-assistant-chunk',
          expectedTerminalKind: 'completed',
          minimumOfflineSeqAdvance: 1,
          expectedFollowReplacementCount: 2,
          expectedEventReplacementCount: 2,
          expectedSameCutReconnectCount: 1,
          expectedSnapshotHasMore: false,
          expectedFinalProjectionRelation: 'authoritative-snapshot-fold',
        },
      }
    }
    if (!hasExactKeys(step, ['id'])) {
      throw new Error(`Link acceptance ${expected} step accepts only its id`)
    }
    return { id: expected }
  })
  const listStep = steps.find((step): step is ListAcceptanceStep => step.id === 'list')
  const historyStep = steps.find((step): step is HistoryAcceptanceStep => step.id === 'history')
  const promptStep = steps.find((step): step is PromptAcceptanceStep => step.id === 'prompt')
  if (listStep === undefined || historyStep === undefined || promptStep === undefined
    || historyStep.targetSessionId !== listStep.targetSessionId
    || historyStep.decoySessionId !== listStep.decoySessionId
    || promptStep.targetSessionId !== listStep.targetSessionId
    || promptStep.decoySessionId !== listStep.decoySessionId) {
    throw new Error('Link acceptance list, history, and prompt steps must share target and decoy sessions')
  }
  return {
    schemaVersion: 1,
    contractVersion: LINK_CONTRACT_VERSION,
    steps,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

/** Refuse evidence from a source tree whose executed inputs differ from one stable HEAD. */
async function assertExecutionInputsClean(
  language: NativeDriver['language'] | undefined,
  expectedHead?: string,
): Promise<string> {
  const headBefore = await readAcceptanceHead()
  if (expectedHead !== undefined && headBefore !== expectedHead) {
    throw new Error('Link acceptance HEAD changed during the evidence run')
  }
  const pathspecs = [
    ...HOST_EXECUTION_INPUTS,
    ...(language === undefined ? [] : NATIVE_EXECUTION_INPUTS[language]),
  ]
  const result = await execa('git', [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.excludesFile=/dev/null',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    ...pathspecs,
  ], {
    cwd: REPO_ROOT,
    reject: false,
  })
  if (result.exitCode !== 0) {
    throw new Error(`could not inspect acceptance execution inputs (Git exited ${String(result.exitCode)})`)
  }
  if (result.stdout !== '') {
    throw new Error('Link acceptance execution inputs must be committed before evidence runs')
  }
  await assertNoIgnoredExecutionInputs(language)
  const headAfter = await readAcceptanceHead()
  if (headAfter !== headBefore || (expectedHead !== undefined && headAfter !== expectedHead)) {
    throw new Error('Link acceptance HEAD changed while execution inputs were inspected')
  }
  return headAfter
}

async function readAcceptanceHead(): Promise<string> {
  const result = await execa('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: REPO_ROOT,
    reject: false,
  })
  const head = result.stdout.trim()
  if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/u.test(head)) {
    throw new Error(`could not resolve acceptance HEAD (Git exited ${String(result.exitCode)})`)
  }
  return head
}

async function assertNoIgnoredExecutionInputs(
  language: NativeDriver['language'] | undefined,
): Promise<void> {
  const roots = [
    ...HOST_IGNORED_EXECUTION_ROOTS,
    ...(language === undefined ? [] : [`apps/${language === 'swift' ? 'apple' : 'android'}`]),
  ]
  const result = await execa('git', [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.excludesFile=/dev/null',
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '--no-empty-directory',
    '-z',
    '--',
    ...roots,
  ], {
    cwd: REPO_ROOT,
    reject: false,
  })
  if (result.exitCode !== 0) {
    throw new Error(`could not inspect ignored acceptance inputs (Git exited ${String(result.exitCode)})`)
  }
  const ignoredInputs = result.stdout
    .split('\0')
    .filter(path => path !== '' && !ignoredPathIsBuildCache(path))
    .filter(path => path.endsWith('/') || ignoredPathIsExecutionInput(path))
  if (ignoredInputs.length > 0) {
    throw new Error(
      `Link acceptance execution inputs include ignored source or config: ${ignoredInputs.slice(0, 5).join(', ')}`,
    )
  }
}

function ignoredPathIsBuildCache(path: string): boolean {
  const segments = path.replace(/\/$/u, '').split('/')
  return segments.some(segment => IGNORED_BUILD_CACHE_SEGMENTS.has(segment))
}

function ignoredPathIsExecutionInput(path: string): boolean {
  const name = path.split('/').at(-1) ?? ''
  if (name === 'Dockerfile' || name === 'Makefile') return true
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return IGNORED_EXECUTION_EXTENSIONS.has(extension)
}

/** Decode the one canonical argv schema and its separately pinned language/result fields. */
function parseNativeDriver(
  raw: string | undefined,
  languageValue: string | undefined,
  resultValue: string | undefined,
  temporaryHome: string,
): NativeDriver | undefined {
  if (raw === undefined) {
    if (languageValue !== undefined || resultValue !== undefined) {
      throw new Error('native acceptance language/result require DSH_LINK_ACCEPTANCE_DRIVER_JSON')
    }
    return undefined
  }
  if (languageValue !== 'swift' && languageValue !== 'kotlin') {
    throw new Error('DSH_LINK_ACCEPTANCE_LANGUAGE must be exactly swift or kotlin')
  }
  if (resultValue === undefined || resultValue.length === 0 || !isAbsolute(resultValue)) {
    throw new Error('DSH_LINK_ACCEPTANCE_RESULT must be an absolute path')
  }
  const resultPath = resolve(resultValue)
  if (pathIsInside(resolve(temporaryHome), resultPath)) {
    throw new Error('DSH_LINK_ACCEPTANCE_RESULT must be outside the temporary Harness home')
  }
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string')) {
    throw new Error('DSH_LINK_ACCEPTANCE_DRIVER_JSON must be one JSON argv array')
  }
  const expected = NATIVE_ARGV[languageValue]
  if (parsed.length !== expected.length
    || parsed.some((value, index) => value !== expected[index])) {
    throw new Error(`DSH_LINK_ACCEPTANCE_DRIVER_JSON is not the canonical ${languageValue} argv`)
  }
  return { language: languageValue, argv: [...expected], resultPath }
}

/** Claim one absent external result after resolving its physical parent. */
async function claimNativeArtifact(
  driver: NativeDriver,
  temporaryHome: string,
): Promise<NativeArtifact> {
  const resultParent = dirname(driver.resultPath)
  try {
    await mkdir(resultParent, { recursive: true })
  } catch (error) {
    throw new Error('DSH_LINK_ACCEPTANCE_RESULT parent could not be prepared', { cause: error })
  }
  let physicalHome: string
  let physicalParent: string
  try {
    [physicalHome, physicalParent] = await Promise.all([
      realpath(temporaryHome),
      realpath(resultParent),
    ])
  } catch (error) {
    throw new Error('DSH_LINK_ACCEPTANCE_RESULT parent could not be resolved', { cause: error })
  }
  if (pathIsInside(physicalHome, join(physicalParent, basename(driver.resultPath)))) {
    throw new Error('DSH_LINK_ACCEPTANCE_RESULT must resolve outside the temporary Harness home')
  }
  try {
    await lstat(driver.resultPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { language: driver.language, resultPath: driver.resultPath }
    }
    throw new Error('DSH_LINK_ACCEPTANCE_RESULT could not be inspected safely', { cause: error })
  }
  throw new Error('native acceptance result path must not exist before launch')
}

function pathIsInside(parent: string, candidate: string): boolean {
  const displacement = relative(parent, candidate)
  return displacement === ''
    || (displacement !== '..' && !displacement.startsWith(`..${sep}`) && !isAbsolute(displacement))
}

/** Start the authenticated loopback control plane. */
async function startControl(
  ctx: Context,
  link: LinkAccessService,
  mock: MockLlmServer,
  targetSessionId: string,
  recoverySemantics: RecoveryAcceptanceSemantics,
): Promise<AcceptanceControl> {
  const token = randomBytes(32).toString('hex')
  let observation: ControlObservation | undefined
  const server = createServer((request, response) => {
    const handle = async (): Promise<void> => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        request.resume()
        writeJson(response, 401, { error: 'unauthorized' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://control.invalid')
      const path = url.pathname
      if (request.method === 'POST' && path === '/approval/start') {
        request.resume()
        const current = observation
        if (current === undefined) {
          writeJson(response, 409, { error: 'driver-not-prepared' })
          return
        }
        if (current.approvalStarts > 0 || current.approval !== undefined) {
          writeJson(response, 409, { error: 'approval-already-started' })
          return
        }
        const agent = ctx.agents.get(SessionId(targetSessionId))
        if (agent === undefined || agent.status !== 'running') {
          writeJson(response, 409, { error: 'session-not-running' })
          return
        }
        await waitFor(() => {
          const requests = mock.requests.slice(current.modelRequestBaseline)
          if (requests.length !== 2) {
            throw new Error(`prepared driver issued ${String(requests.length)} model requests instead of two`)
          }
          const stalled = requests[1]
          if (stalled?.behavior !== 'stall' || stalled.outcome !== undefined) {
            throw new Error('prepared driver model request has not reached the configured stall')
          }
          return Promise.resolve()
        }, 'prepared driver stalled model request')
        current.approvalStarts += 1
        current.approval = { kind: 'pending' }
        void ctx.approval.request({
          agent,
          toolName: 'link-native-acceptance',
          reason: 'cross-language acceptance',
        }).then(
          (outcome) => { current.approval = { kind: 'complete', outcome } },
          (error: unknown) => {
            current.approval = {
              kind: 'failed',
              message: error instanceof Error ? error.message : String(error),
            }
          },
        )
        writeJson(response, 200, { started: true })
        return
      }
      if (request.method === 'GET' && path === '/approval/result') {
        request.resume()
        const approval = observation?.approval
        if (approval === undefined || approval.kind === 'pending') {
          writeJson(response, 202, { pending: true })
          return
        }
        if (approval.kind === 'failed') {
          writeJson(response, 500, { error: 'approval-failed' })
          return
        }
        writeJson(response, 200, { outcome: approval.outcome })
        return
      }
      if (request.method === 'GET' && path === '/recovery/status') {
        request.resume()
        const current = observation
        if (current === undefined) {
          writeJson(response, 409, { error: 'driver-not-prepared' })
          return
        }
        const rawPreFaultSeq = url.searchParams.get('preFaultSeq')
        const preFaultSeq = rawPreFaultSeq === null ? Number.NaN : Number(rawPreFaultSeq)
        if (url.searchParams.size !== 1 || !Number.isSafeInteger(preFaultSeq) || preFaultSeq < 0) {
          writeJson(response, 400, { error: 'invalid-pre-fault-seq' })
          return
        }
        if (current.recovery !== undefined) {
          if (current.recovery.preFaultSeq !== preFaultSeq) {
            writeJson(response, 409, { error: 'recovery-seq-changed' })
            return
          }
          writeJson(response, 200, {
            hostFinalCursor: current.recovery.hostFinalCursor,
            offlineSeqCount: current.recovery.offlineSeqCount,
          })
          return
        }
        const requests = mock.requests.slice(current.modelRequestBaseline)
        if (requests.length > 3) {
          throw new Error(`prepared driver issued ${String(requests.length)} model requests before recovery`)
        }
        const recoveryRequest = requests[2]
        if (requests.length < 3) {
          writeJson(response, 202, { pending: true })
          return
        }
        if (recoveryRequest?.behavior !== 'slow_success') {
          throw new Error('prepared driver third model request is not slow_success')
        }
        if (recoveryRequest.outcome === undefined) {
          if (current.recoveryOfflineSeq !== undefined && current.recoveryOfflineSeq !== preFaultSeq) {
            throw new Error('prepared driver changed its recovery seq while the provider was active')
          }
          current.recoveryOfflineSeq = preFaultSeq
          writeJson(response, 202, { pending: true })
          return
        }
        if (current.recoveryOfflineSeq !== preFaultSeq) {
          throw new Error('prepared driver did not observe the provider active after both streams closed')
        }
        if (recoveryRequest.outcome !== 'completed') {
          throw new Error('prepared driver recovery request did not complete slow_success')
        }
        const recovered = await captureHostRecovery(
          ctx,
          targetSessionId,
          preFaultSeq,
          recoverySemantics,
        )
        if (recovered === undefined) {
          writeJson(response, 202, { pending: true })
          return
        }
        current.recovery = recovered
        writeJson(response, 200, {
          hostFinalCursor: recovered.hostFinalCursor,
          offlineSeqCount: recovered.offlineSeqCount,
        })
        return
      }
      if (request.method === 'POST' && path === '/revoke') {
        request.resume()
        const current = observation
        if (current === undefined) {
          writeJson(response, 409, { error: 'driver-not-prepared' })
          return
        }
        if (current.revocation.kind !== 'not-started') {
          writeJson(response, 409, { error: 'revocation-already-started' })
          return
        }
        const matches = (await link.trustedDevices()).filter(
          device => device.name === current.deviceName && device.revokedAt === undefined,
        )
        if (matches.length !== 1) {
          writeJson(response, 409, { error: 'device-not-unique' })
          return
        }
        current.revocation = { kind: 'pending' }
        try {
          const revoked = await link.revokeDevice(matches[0]!.deviceId)
          if (revoked === undefined) throw new Error('prepared Link device disappeared before revocation')
          current.revocation = { kind: 'complete', deviceId: revoked.deviceId }
        } catch (error) {
          current.revocation = {
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          }
          throw error
        }
        writeJson(response, 200, { revoked: true })
        return
      }
      request.resume()
      writeJson(response, 404, { error: 'not-found' })
    }
    void handle().catch(() => {
      if (!response.headersSent) writeJson(response, 500, { error: 'control-failed' })
      else response.destroy()
    })
  })
  await listen(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('control server did not bind TCP')
  let closing: Promise<void> | undefined
  return {
    endpoint: `http://127.0.0.1:${String(address.port)}`,
    token,
    prepare: (nextDeviceName) => {
      if (observation !== undefined && !observation.verified) {
        throw new Error('cannot replace a driver before its Host behavior is verified')
      }
      observation = {
        deviceName: nextDeviceName,
        modelRequestBaseline: mock.requests.length,
        approvalStarts: 0,
        approval: undefined,
        recoveryOfflineSeq: undefined,
        recovery: undefined,
        revocation: { kind: 'not-started' },
        verified: false,
      }
    },
    verifyExpectedBehavior: async () => {
      const current = observation
      if (current === undefined) throw new Error('cannot verify an unprepared acceptance driver')
      if (current.verified) throw new Error('acceptance driver Host behavior was already verified')
      if (current.approvalStarts !== 1
        || current.approval?.kind !== 'complete'
        || current.approval.outcome !== 'allowed-once') {
        throw new Error('acceptance driver did not complete exactly one allowed-once approval')
      }
      if (current.recovery === undefined) {
        throw new Error('acceptance driver did not complete Host-observed recovery')
      }
      const finalRecovery = await captureHostRecovery(
        ctx,
        targetSessionId,
        current.recovery.preFaultSeq,
        recoverySemantics,
      )
      if (finalRecovery === undefined) {
        throw new Error('acceptance driver recovery terminal disappeared before verification')
      }
      assertDeepStrictEqualWithoutValues(
        finalRecovery,
        current.recovery,
        'repeated Host recovery observation changed',
      )
      if (current.revocation.kind !== 'complete') {
        throw new Error('acceptance driver did not execute one device revocation')
      }
      const revokedDeviceId = current.revocation.deviceId
      const revoked = (await link.trustedDevices()).find(
        device => device.deviceId === revokedDeviceId,
      )
      if (revoked?.revokedAt === undefined) {
        throw new Error('acceptance driver revocation did not reach the Link trust store')
      }
      current.verified = true
      return current.recovery
    },
    close: () => (closing ??= new Promise((resolve) => {
      server.close(() => { resolve() })
      server.closeAllConnections()
    })),
  }
}

/** Read one stable Host cut after the recovery turn has completed. */
async function captureHostRecovery(
  ctx: Context,
  targetSessionId: string,
  preFaultSeq: number,
  semantics: RecoveryAcceptanceSemantics,
): Promise<HostRecoveryEvidence | undefined> {
  const session = ctx.sessions.get(SessionId(targetSessionId))
  if (session === undefined) throw new Error('recovery Session is not attached')
  const events = session.events
  for (const [index, event] of events.entries()) {
    if (event.seq !== index) throw new Error(`recovery Session raw journal skipped or duplicated seq ${String(index)}`)
  }
  const preFault = events[preFaultSeq]
  if (preFault?.type !== 'assistant/chunk') {
    throw new Error('recovery pre-fault seq is not an assistant/chunk event')
  }
  const preFaultTurn = preFault.data.turn
  const completed = events.some((event) => {
    if (event.seq <= preFaultSeq || event.type !== 'turn/end') return false
    const reason = event.data.reason
    return event.data.turn === preFaultTurn && reason.kind === semantics.expectedTerminalKind
  })
  if (!completed) return undefined
  const finalCursor = events.at(-1)?.seq ?? -1
  const offlineSeqCount = events.filter(event => event.seq > preFaultSeq).length
  if (offlineSeqCount !== finalCursor - preFaultSeq
    || offlineSeqCount < semantics.minimumOfflineSeqAdvance) {
    throw new Error('recovery Session offline interval is not a non-empty contiguous suffix')
  }

  const abort = new AbortController()
  const signal = AbortSignal.any([
    abort.signal,
    AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
  ])
  const iterator = ctx.sessionController.follow({
    address: { kind: 'session', sessionId: SessionId(targetSessionId) },
    maxMessages: 50,
  }, signal)[Symbol.asyncIterator]()
  let opening: Awaited<ReturnType<typeof iterator.next>>
  try {
    opening = await iterator.next()
  } finally {
    abort.abort(new Error('recovery Host observation captured its opening cut'))
    await iterator.return?.()
  }
  if (opening.done || opening.value.type !== 'snapshot') {
    throw new Error('recovery Host follow did not open with a snapshot')
  }
  const snapshot = opening.value
  if (snapshot.cursor !== finalCursor
    || snapshot.hasMore !== semantics.expectedSnapshotHasMore
    || snapshot.projections.asOfSeq !== finalCursor) {
    throw new Error('recovery Host snapshot does not describe the final complete cut')
  }
  const page = await ctx.sessionController.page({
    address: { kind: 'session', sessionId: SessionId(targetSessionId) },
    throughSeq: snapshot.cursor,
    maxMessages: 50,
  }, AbortSignal.timeout(30_000))
  assertDeepStrictEqualWithoutValues(
    page.records,
    snapshot.records,
    'recovery Host page does not match its opening snapshot',
  )
  expect(page.hasMore).toBe(snapshot.hasMore)
  const canonicalProjection = foldCompanionDomain(snapshot.records)
  const itemSeqs = canonicalProjection.items.map(item => item.seq)
  if (canonicalProjection.cursor !== finalCursor || new Set(itemSeqs).size !== itemSeqs.length) {
    throw new Error('recovery Host canonical projection has a cursor mismatch or duplicate item seq')
  }
  return {
    preFaultSeq,
    hostFinalCursor: finalCursor,
    offlineSeqCount,
    snapshotHasMore: false,
    canonicalProjection,
  }
}

/** Run every corpus action through the production TypeScript Link client. */
async function runTypeScriptReference(
  config: AcceptanceConfig,
  corpus: AcceptanceCorpus,
): Promise<AcceptanceResult> {
  const passed: Array<{ readonly id: StepId; readonly status: 'PASS' }> = []
  let client: LinkClient | undefined
  let description: LinkHostDescription | undefined
  let follow: AsyncGenerator | undefined
  let followAbort: AbortController | undefined
  let openingSnapshot: Record<string, unknown> | undefined
  let successTurn: number | undefined
  let stalledTurn: number | undefined
  let cancelledSeq: number | undefined
  let events: AsyncGenerator | undefined
  let eventsAbort: AbortController | undefined
  let eventsClientId: string | undefined
  let recoveryResult: RecoveryAcceptanceResult | undefined
  let followGenerationCount = 0
  let eventGenerationCount = 0
  let primaryFailure: unknown
  let hasPrimaryFailure = false

  const pass = async (id: StepId, action: () => Promise<void>): Promise<void> => {
    const expected = corpus.steps[passed.length]?.id
    if (expected !== id) throw new Error(`reference attempted ${id} while corpus requires ${String(expected)}`)
    await action()
    passed.push({ id, status: 'PASS' })
  }

  try {
    await pass('pair', async () => {
      client = await LinkClient.pair(config.pairing, { deviceName: config.deviceName })
    })
    await pass('connect', async () => {
      description = await requireClient(client).describe()
    })
    await pass('describe', () => {
      expect(description).toMatchObject({
        linkProtocolVersion: LINK_PROTOCOL_VERSION,
        contractVersion: corpus.contractVersion,
        runtimeClass: 'full',
        sessionFormatVersion: SESSION_FORMAT_VERSION,
        allowRemoteApproval: true,
        capabilities: {
          session: { list: true, history: true, follow: true, prompt: true, cancel: true },
          interaction: { approval: true, question: true },
        },
      })
      return Promise.resolve()
    })
    await pass('list', async () => {
      const step = corpusStep(corpus, 'list')
      const listed = requireRecord(
        await requireClient(client).call('session/list', { _request: {} }),
        'session/list result',
      )
      if (!Array.isArray(listed.items)) throw new Error('session/list result omitted items')
      const sessionIds = listed.items.map(item => requireRecord(item, 'session/list item').sessionId)
      expect(sessionIds).toEqual(step.expectedSessionIds)
      expect(sessionIds).not.toContain(step.decoySessionId)
    })
    await pass('open', async () => {
      followAbort = new AbortController()
      follow = requireClient(client).openStream('session/follow', {
        request: sessionFollowRequest(config.sessionId),
      }, followAbort.signal)
      followGenerationCount += 1
      openingSnapshot = requireRecord(await nextValue(follow, 'session/follow opening'), 'session/follow snapshot')
    })
    await pass('history', async () => {
      const step = corpusStep(corpus, 'history')
      const snapshot = requireSnapshot(openingSnapshot, config.sessionId)
      const page = requireRecord(await requireClient(client).call('session/page', { request: {
        address: { kind: 'session', sessionId: step.targetSessionId },
        throughSeq: snapshot.cursor,
        maxMessages: 50,
      } }), 'session/page result')
      if (!Array.isArray(page.records) || typeof page.hasMore !== 'boolean') {
        throw new Error('session/page did not return a history page')
      }
      if (step.expectedTargetRelation === 'matches-follow-opening') {
        const opening = requireRecord(openingSnapshot, 'session/follow opening snapshot')
        assertDeepStrictEqualWithoutValues(
          page.records,
          opening.records,
          'history page does not match its opening snapshot',
        )
        expect(page.hasMore).toBe(opening.hasMore)
      }
      await expectLinkError(requireClient(client).call('session/page', { request: {
        address: { kind: 'session', sessionId: step.decoySessionId },
        throughSeq: snapshot.cursor,
        maxMessages: 50,
      } }), step.decoyErrorCode)
    })
    await pass('follow', () => {
      requireSnapshot(openingSnapshot, config.sessionId)
      return Promise.resolve()
    })
    await pass('prompt', async () => {
      const prompt = corpusStep(corpus, 'prompt')
      await expectLinkError(promptSession(
        requireClient(client),
        prompt.decoySessionId,
        prompt.text,
      ), prompt.decoyErrorCode)
      const accepted = await promptSession(requireClient(client), prompt.targetSessionId, prompt.text)
      expect(accepted).toEqual({ accepted: prompt.expectedAccepted })
    })
    await pass('stream', async () => {
      const prompt = corpusStep(corpus, 'prompt')
      const completed = await readCompletedTurn(
        requireStream(follow, 'session/follow'),
        prompt.expectedResponseText,
      )
      successTurn = completed.turn
    })
    await pass('approval', async () => {
      eventsAbort = new AbortController()
      events = requireClient(client).openStream('$events', {}, eventsAbort.signal)
      eventGenerationCount += 1
      const ready = requireRecord(await nextValue(events, '$events ready'), '$events ready')
      if (ready.type !== 'ready' || typeof ready.clientId !== 'string') {
        throw new Error('$events did not begin with a ready client id')
      }
      eventsClientId = ready.clientId
      const step = corpusStep(corpus, 'approval')
      const accepted = await promptSession(
        requireClient(client),
        config.sessionId,
        requireString(step.stallPrompt, 'approval stall prompt'),
      )
      expect(accepted).toEqual({ accepted: true })
      stalledTurn = await readStepStartAfter(
        requireStream(follow, 'session/follow'),
        requireNumber(successTurn, 'completed success turn'),
      )
      const started = await controlRequest(config, '/approval/start', 'POST')
      expect(started).toEqual({ status: 200, body: { started: true } })
      const frame = await readApprovalFrame(requireStream(events, '$events'), config.sessionId)
      expect(frame.request).toEqual({
        toolName: 'link-native-acceptance',
        reason: 'cross-language acceptance',
      })
      await requireClient(client).call('$events/result', {
        clientId: ready.clientId,
        eventId: frame.eventId,
        outcome: { kind: 'result', value: requireApprovalOutcome(step.outcome) },
      })
      const approvalResult = await waitForApprovalResult(config)
      expect(approvalResult).toEqual({ outcome: step.outcome })
    })
    await pass('cancel', async () => {
      const accepted = await requireClient(client).call('session/cancel', {
        request: { sessionId: config.sessionId },
      })
      expect(accepted).toEqual({ accepted: true })
      const ended = await readCancelledTurn(
        requireStream(follow, 'session/follow'),
        requireNumber(stalledTurn, 'stalled turn'),
      )
      cancelledSeq = ended.seq
    })
    await pass('reconnect', async () => {
      const step = corpusStep(corpus, 'reconnect')
      if (step.fault !== 'interrupt-active-streams') {
        throw new Error(`unsupported reconnect fault ${String(step.fault)}`)
      }
      const previousFollowCount = followGenerationCount
      const previousEventCount = eventGenerationCount
      const previousClientId = requireString(eventsClientId, 'initial $events client id')
      const previousFollow = requireStream(follow, 'session/follow')
      const previousEvents = requireStream(events, '$events')
      followAbort?.abort(new Error('acceptance interrupted the active follow stream'))
      eventsAbort?.abort(new Error('acceptance interrupted the active event stream'))
      await closeInterruptedStreams(previousFollow, previousEvents)

      followAbort = new AbortController()
      follow = requireClient(client).openStream('session/follow', {
        request: sessionFollowRequest(config.sessionId),
      }, followAbort.signal)
      followGenerationCount += 1
      const replacement = requireSnapshot(
        requireRecord(await nextValue(follow, 'replacement session/follow'), 'replacement snapshot'),
        config.sessionId,
      )
      expect(replacement.cursor).toBeGreaterThanOrEqual(requireNumber(cancelledSeq, 'cancelled event seq'))
      if (step.expectedAuthoritativeSnapshot) {
        assertAuthoritativeSnapshot(
          replacement.records,
          corpusStep(corpus, 'prompt').expectedResponseText,
          requireNumber(cancelledSeq, 'cancelled event seq'),
        )
      }

      eventsAbort = new AbortController()
      events = requireClient(client).openStream('$events', {}, eventsAbort.signal)
      eventGenerationCount += 1
      const ready = requireRecord(await nextValue(events, 'replacement $events ready'), 'replacement $events ready')
      if (ready.type !== 'ready' || typeof ready.clientId !== 'string') {
        throw new Error('replacement $events did not begin with a ready client id')
      }
      eventsClientId = ready.clientId
      expect(followGenerationCount - previousFollowCount).toBe(step.expectedFollowReplacementCount)
      expect(eventGenerationCount - previousEventCount).toBe(step.expectedEventReplacementCount)
      if (step.expectedClientIdRefresh) expect(eventsClientId).not.toBe(previousClientId)

      const recovery = step.recovery
      const recoveryFollowBaseline = followGenerationCount
      const recoveryEventBaseline = eventGenerationCount
      const accepted = await promptSession(requireClient(client), config.sessionId, recovery.prompt)
      expect(accepted).toEqual({ accepted: true })
      const preFaultSeq = await readFirstAssistantChunkAfter(
        requireStream(follow, 'session/follow'),
        requireNumber(cancelledSeq, 'cancelled event seq'),
      )
      const recoveryFollow = requireStream(follow, 'session/follow')
      const recoveryEvents = requireStream(events, '$events')
      followAbort?.abort(new Error('acceptance interrupted follow during recovery streaming'))
      eventsAbort?.abort(new Error('acceptance interrupted events during recovery streaming'))
      await closeInterruptedStreams(recoveryFollow, recoveryEvents)
      const hostRecovery = await waitForRecoveryStatus(config, preFaultSeq)
      expect(hostRecovery.offlineSeqCount).toBeGreaterThanOrEqual(recovery.minimumOfflineSeqAdvance)

      followAbort = new AbortController()
      follow = requireClient(client).openStream('session/follow', {
        request: sessionFollowRequest(config.sessionId),
      }, followAbort.signal)
      followGenerationCount += 1
      const recoveredSnapshot = requireSnapshot(
        requireRecord(await nextValue(follow, 'recovery session/follow'), 'recovery snapshot'),
        config.sessionId,
      )
      expect(recoveredSnapshot.cursor).toBe(hostRecovery.hostFinalCursor)
      expect(recoveredSnapshot.hasMore).toBe(recovery.expectedSnapshotHasMore)
      const beforeRepeatedReconnectProjection = foldCompanionDomain(
        requireCompanionRecords(recoveredSnapshot.records),
      )

      const recoveredEventsClientId = requireString(eventsClientId, 'pre-recovery $events client id')
      eventsAbort = new AbortController()
      events = requireClient(client).openStream('$events', {}, eventsAbort.signal)
      eventGenerationCount += 1
      const recoveryReady = requireRecord(
        await nextValue(events, 'recovery $events ready'),
        'recovery $events ready',
      )
      if (recoveryReady.type !== 'ready' || typeof recoveryReady.clientId !== 'string') {
        throw new Error('recovery $events did not begin with a ready client id')
      }
      eventsClientId = recoveryReady.clientId
      expect(eventsClientId).not.toBe(recoveredEventsClientId)

      if (recovery.expectedSameCutReconnectCount !== 1) {
        throw new Error('reference supports exactly one repeated same-cut reconnect')
      }
      const stableFollow = requireStream(follow, 'session/follow')
      const stableEvents = requireStream(events, '$events')
      followAbort.abort(new Error('acceptance repeated follow reconnect at a stable Host cut'))
      eventsAbort.abort(new Error('acceptance repeated events reconnect at a stable Host cut'))
      await closeInterruptedStreams(stableFollow, stableEvents)

      followAbort = new AbortController()
      follow = requireClient(client).openStream('session/follow', {
        request: sessionFollowRequest(config.sessionId),
      }, followAbort.signal)
      followGenerationCount += 1
      const repeatedSnapshot = requireSnapshot(
        requireRecord(await nextValue(follow, 'repeated session/follow'), 'repeated snapshot'),
        config.sessionId,
      )
      expect(repeatedSnapshot.cursor).toBe(hostRecovery.hostFinalCursor)
      expect(repeatedSnapshot.hasMore).toBe(recovery.expectedSnapshotHasMore)
      const afterRepeatedReconnectProjection = foldCompanionDomain(
        requireCompanionRecords(repeatedSnapshot.records),
      )
      assertDeepStrictEqualWithoutValues(
        afterRepeatedReconnectProjection,
        beforeRepeatedReconnectProjection,
        'repeated reconnect changed the companion projection',
      )

      eventsAbort = new AbortController()
      events = requireClient(client).openStream('$events', {}, eventsAbort.signal)
      eventGenerationCount += 1
      const repeatedReady = requireRecord(
        await nextValue(events, 'repeated $events ready'),
        'repeated $events ready',
      )
      if (repeatedReady.type !== 'ready' || typeof repeatedReady.clientId !== 'string') {
        throw new Error('repeated $events did not begin with a ready client id')
      }
      eventsClientId = repeatedReady.clientId
      expect(followGenerationCount - recoveryFollowBaseline)
        .toBe(recovery.expectedFollowReplacementCount)
      expect(eventGenerationCount - recoveryEventBaseline)
        .toBe(recovery.expectedEventReplacementCount)
      recoveryResult = {
        preFaultSeq,
        recoverySnapshotCursor: recoveredSnapshot.cursor,
        repeatedSnapshotCursor: repeatedSnapshot.cursor,
        offlineSeqCount: hostRecovery.offlineSeqCount,
        recoverySnapshotHasMore: false,
        followReplacementCount: followGenerationCount - recoveryFollowBaseline,
        eventReplacementCount: eventGenerationCount - recoveryEventBaseline,
        beforeRepeatedReconnectProjection,
        afterRepeatedReconnectProjection,
      }
    })
    await pass('revoke', async () => {
      const revoked = await controlRequest(config, '/revoke', 'POST')
      expect(revoked).toEqual({ status: 200, body: { revoked: true } })
      await expectLinkError(requireClient(client).describe(), 'unauthorized')
    })
    return {
      schemaVersion: 1,
      language: config.language,
      corpusSha256: corpus.sha256,
      hostCommit: config.hostCommit,
      clientCommit: config.clientCommit,
      linkProtocolVersion: LINK_PROTOCOL_VERSION,
      contractVersion: corpus.contractVersion,
      sessionFormatVersion: SESSION_FORMAT_VERSION,
      steps: passed,
      recovery: requireRecoveryResult(recoveryResult),
    }
  } catch (error) {
    hasPrimaryFailure = true
    primaryFailure = error
    throw error
  } finally {
    eventsAbort?.abort(new Error('reference cleanup'))
    followAbort?.abort(new Error('reference cleanup'))
    const cleanupResults = await Promise.allSettled([
      (async () => { await events?.return(undefined) })(),
      (async () => { await follow?.return(undefined) })(),
      (async () => { await client?.dispose() })(),
    ])
    const cleanupFailures: unknown[] = []
    for (const result of cleanupResults) {
      if (result.status === 'rejected') cleanupFailures.push(result.reason as unknown)
    }
    if (cleanupFailures.length > 0) {
      if (hasPrimaryFailure) {
        throw new AggregateError(
          [primaryFailure, ...cleanupFailures],
          'TypeScript Link acceptance and cleanup failed',
        )
      }
      if (cleanupFailures.length === 1) throw cleanupFailures[0]
      throw new AggregateError(cleanupFailures, 'TypeScript Link acceptance cleanup failed')
    }
  }
}

/** Build one fresh pairing and the exact configuration shared with a driver. */
async function driverConfig(
  current: AcceptanceSuite,
  language: string,
  deviceName: string,
): Promise<AcceptanceConfig> {
  const pairing = await current.link.createPairing()
  const listStep = corpusStep(current.corpus, 'list')
  const promptStep = corpusStep(current.corpus, 'prompt')
  return {
    schemaVersion: 1,
    language,
    corpusPath: CORPUS_PATH,
    candidateResultPath: join(current.home, `link-acceptance-${language}-candidate.json`),
    pairing,
    sessionId: listStep.targetSessionId,
    controlEndpoint: current.control.endpoint,
    controlToken: current.control.token,
    hostCommit: current.commit,
    clientCommit: current.commit,
    expectedResponseText: promptStep.expectedResponseText,
    deviceName,
  }
}

/** Spawn one native driver with only a temporary config path added to a scrubbed environment. */
async function runNativeDriver(
  current: Pick<AcceptanceSuite, 'ctx' | 'home'>,
  driver: NativeDriver,
  config: AcceptanceConfig,
  cancelSignal: AbortSignal,
): Promise<unknown> {
  const configPath = join(current.home, `link-acceptance-${driver.language}-config.json`)
  if (!pathIsInside(resolve(current.home), resolve(config.candidateResultPath))) {
    throw new Error('native acceptance candidate result must stay inside the temporary Harness home')
  }
  if (await pathExists(config.candidateResultPath)) {
    throw new Error('native acceptance candidate result path must not exist before launch')
  }
  await writeFile(configPath, `${JSON.stringify(config, undefined, 2)}\n`, { mode: 0o600 })
  const [command, ...args] = nativeDriverProcessArgv(driver)
  if (command === undefined) throw new Error('native driver command is missing')
  const deadlineSignal = AbortSignal.timeout(NATIVE_DRIVER_TIMEOUT_MS)
  const child = spawnNativeProcess(
    current.ctx,
    command,
    args,
    current.home,
    configPath,
    AbortSignal.any([cancelSignal, deadlineSignal]),
  )
  activeNativeProcess = child
  let result: Awaited<NativeProcess['done']>
  try {
    result = await settleNativeProcess(child)
  } finally {
    if (activeNativeProcess === child) activeNativeProcess = undefined
  }
  const interruptions = [
    ...(deadlineSignal.aborted ? [`timed out after ${NATIVE_DRIVER_TIMEOUT_MS}ms`] : []),
    ...(cancelSignal.aborted ? ['was cancelled'] : []),
  ]
  if (interruptions.length > 0 || result.exitCode !== 0 || result.signal !== null) {
    const facts = [
      ...interruptions,
      `exit code ${String(result.exitCode)}`,
      `signal ${String(result.signal)}`,
    ]
    const output = readNativeProcessOutput(child, config)
    const outcomeError = new Error(
      `native ${driver.language} acceptance ${facts.join('; ')}`
      + (output === '' ? '' : `:\n${output}`),
    )
    try {
      await removeNativeCandidate(config.candidateResultPath)
    } catch (removalError) {
      throw new AggregateError(
        [outcomeError, removalError],
        'native acceptance failed and candidate removal failed',
      )
    }
    throw outcomeError
  }
  return await readAndRemoveNativeCandidate(config)
}

/** Read a native candidate once, remove it under its own deadline, then decode it. */
async function readAndRemoveNativeCandidate(config: AcceptanceConfig): Promise<unknown> {
  let output: string | undefined
  const failures: unknown[] = []
  try {
    output = await readFile(config.candidateResultPath, 'utf8')
  } catch (error) {
    failures.push(error)
  }
  try {
    await removeNativeCandidate(config.candidateResultPath)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'native acceptance candidate read and removal failed')
  }
  if (output === undefined) throw new Error('native acceptance candidate read returned no data')
  assertNoAcceptanceSecrets(output, config)
  try {
    return JSON.parse(output) as unknown
  } catch {
    throw new Error('native acceptance result is not valid JSON')
  }
}

/** Remove a candidate under its own deadline; an absent file is already contained. */
async function removeNativeCandidate(candidateResultPath: string): Promise<void> {
  try {
    const removal = await settleBeforeAbsoluteDeadline(
      unlink(candidateResultPath),
      performance.now() + NATIVE_CANDIDATE_UNLINK_TIMEOUT_MS,
    )
    if (removal.expired) throw new Error('native acceptance candidate removal timed out')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

/** Select an OS-spawnable argv after external drivers pass the canonical-token check. */
function nativeDriverProcessArgv(driver: NativeDriver): readonly string[] {
  // Node cannot spawn the Gradle .bat wrapper directly. The canonical argv has no
  // caller-controlled token when cmd.exe interprets it.
  return process.platform === 'win32' && driver.language === 'kotlin'
    ? ['cmd.exe', '/d', '/s', '/c', 'apps\\android\\gradlew.bat', ...driver.argv.slice(1)]
    : driver.argv
}

function spawnNativeProcess(
  ctx: Pick<Context, 'subprocess'>,
  command: string,
  args: readonly string[],
  home: string,
  configPath: string,
  signal: AbortSignal,
) {
  return ctx.subprocess.spawn({
    argv: [command, ...args],
    cwd: REPO_ROOT,
    env: {
      DSH_HOME: home,
      DSH_LINK_ACCEPTANCE_CONFIG: configPath,
    },
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: NATIVE_PROCESS_OUTPUT_MAX_BYTES },
      stderr: { maxBytes: NATIVE_PROCESS_OUTPUT_MAX_BYTES },
    },
    graceMs: NATIVE_PROCESS_GRACE_MS,
    signal,
  })
}

async function settleNativeProcess(child: NativeProcess): Promise<Awaited<NativeProcess['done']>> {
  let result: Awaited<NativeProcess['done']> | undefined
  const failures: unknown[] = []
  try {
    result = await child.done
  } catch (error) {
    failures.push(error)
  }
  try {
    child.terminate()
  } catch (error) {
    failures.push(error)
  }
  try {
    if (!await child.waitForExit()) failures.push(new Error('native acceptance process tree remained live'))
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'native acceptance process settlement failed')
  if (result === undefined) throw new Error('native acceptance process omitted its exit outcome')
  return result
}

function readNativeProcessOutput(child: NativeProcess, config: AcceptanceConfig): string {
  const stdout = readCompleteNativeProcessOutput(child.collected.stdout)
  const stderr = readCompleteNativeProcessOutput(child.collected.stderr)
  return redactDriverOutput(
    `${stdout}\n${stderr}`.trim(),
    [config.controlToken, config.pairing.code],
  )
}

function readCompleteNativeProcessOutput(
  reader: NativeProcess['collected']['stdout'],
): string {
  const output = reader?.readFrom(0)
  if (output === undefined || output.lossy) return ''
  return output.text
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writeSanitizedFailure(
  resultPath: string,
  language: NativeArtifact['language'],
  renameDeadline?: number,
): Promise<void> {
  await writeEvidenceAtomically(resultPath, {
    schemaVersion: 1,
    language,
    status: 'FAIL',
    reason: 'host-validation-failed',
  }, renameDeadline)
}

/** Publish PASS only while teardown and the test result remain valid. */
async function publishNativeEvidence(
  artifact: NativeArtifact | undefined,
  publication: NativePublication | undefined,
  failures: unknown[],
  renameDeadline: number,
  invalidated: () => boolean,
): Promise<void> {
  if (artifact === undefined) return
  const failed = invalidated() || failures.length > 0
  if (failed || publication === undefined) {
    if (!failed && publication === undefined) {
      failures.push(new Error('native acceptance completed without validated evidence'))
    }
    await containCleanup(
      writeSanitizedFailure(artifact.resultPath, artifact.language, renameDeadline),
      failures,
    )
    return
  }
  try {
    await writeEvidenceAtomically(
      publication.artifact.resultPath,
      publication.result,
      renameDeadline,
      () => !invalidated(),
    )
  } catch (error) {
    failures.push(error)
    await containCleanup(
      writeSanitizedFailure(artifact.resultPath, artifact.language, renameDeadline),
      failures,
    )
  }
}

/** Replace evidence only after a sibling temporary file is durable and closed. */
async function writeEvidenceAtomically(
  resultPath: string,
  value: object,
  renameDeadline?: number,
  renamePermitted?: () => boolean,
): Promise<void> {
  const resultParent = dirname(resultPath)
  await mkdir(resultParent, { recursive: true })
  const temporaryPath = join(
    resultParent,
    `.${basename(resultPath)}.${String(process.pid)}.${randomUUID()}.tmp`,
  )
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let temporaryOwned = false
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    temporaryOwned = true
    await handle.writeFile(`${JSON.stringify(value, undefined, 2)}\n`, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = undefined
    if (renameDeadline !== undefined && performance.now() >= renameDeadline) {
      throw new Error('Link acceptance evidence rename deadline elapsed')
    }
    if (renamePermitted !== undefined && !renamePermitted()) {
      throw new Error('Link acceptance evidence was invalidated before rename')
    }
    await rename(temporaryPath, resultPath)
  } catch (error) {
    const failures: unknown[] = [error]
    if (handle !== undefined) await containCleanup(handle.close(), failures)
    if (temporaryOwned) {
      try {
        await unlink(temporaryPath)
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') failures.push(unlinkError)
      }
    }
    throw failures.length === 1
      ? error
      : new AggregateError(failures, 'atomic Link acceptance evidence cleanup failed')
  }
}

/** Reject malformed or credential-bearing driver output and require exact 13/13 parity. */
function validateResult(
  value: unknown,
  config: AcceptanceConfig,
  corpus: AcceptanceCorpus,
  hostRecovery: HostRecoveryEvidence,
): AcceptanceResult {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('acceptance result is not serializable JSON')
  }
  if (serialized === undefined) throw new Error('acceptance result is not serializable JSON')
  assertNoAcceptanceSecrets(serialized, config)

  if (!isRecord(value) || !hasExactKeys(value, [
    'clientCommit',
    'contractVersion',
    'corpusSha256',
    'hostCommit',
    'language',
    'linkProtocolVersion',
    'recovery',
    'schemaVersion',
    'sessionFormatVersion',
    'steps',
  ])
    || value.schemaVersion !== 1
    || value.language !== config.language
    || value.corpusSha256 !== corpus.sha256
    || value.hostCommit !== config.hostCommit
    || value.clientCommit !== config.clientCommit
    || value.linkProtocolVersion !== LINK_PROTOCOL_VERSION
    || value.contractVersion !== corpus.contractVersion
    || value.sessionFormatVersion !== SESSION_FORMAT_VERSION
    || !Array.isArray(value.steps)
    || value.steps.length !== STEP_IDS.length) {
    throw new Error(`${config.language} acceptance result is invalid`)
  }
  for (const [index, step] of value.steps.entries()) {
    if (!isRecord(step) || !hasExactKeys(step, ['id', 'status'])
      || step.id !== STEP_IDS[index] || step.status !== 'PASS') {
      throw new Error(`${config.language} acceptance result is invalid`)
    }
  }
  const recovery = isRecord(value.recovery) ? value.recovery : undefined
  const semantics = corpusStep(corpus, 'reconnect').recovery
  if (recovery === undefined || !hasExactKeys(recovery, [
    'afterRepeatedReconnectProjection',
    'beforeRepeatedReconnectProjection',
    'eventReplacementCount',
    'followReplacementCount',
    'offlineSeqCount',
    'preFaultSeq',
    'recoverySnapshotCursor',
    'recoverySnapshotHasMore',
    'repeatedSnapshotCursor',
  ])
    || recovery.preFaultSeq !== hostRecovery.preFaultSeq
    || recovery.recoverySnapshotCursor !== hostRecovery.hostFinalCursor
    || recovery.repeatedSnapshotCursor !== hostRecovery.hostFinalCursor
    || recovery.offlineSeqCount !== hostRecovery.offlineSeqCount
    || recovery.offlineSeqCount < semantics.minimumOfflineSeqAdvance
    || recovery.recoverySnapshotHasMore !== hostRecovery.snapshotHasMore
    || recovery.followReplacementCount !== semantics.expectedFollowReplacementCount
    || recovery.eventReplacementCount !== semantics.expectedEventReplacementCount) {
    throw new Error(`${config.language} acceptance recovery result is invalid`)
  }
  assertDeepStrictEqualWithoutValues(
    recovery.beforeRepeatedReconnectProjection,
    hostRecovery.canonicalProjection,
    `${config.language} acceptance projection before repeated reconnect does not match the Host`,
  )
  assertDeepStrictEqualWithoutValues(
    recovery.afterRepeatedReconnectProjection,
    hostRecovery.canonicalProjection,
    `${config.language} acceptance projection after repeated reconnect does not match the Host`,
  )
  const beforeRepeatedReconnectProjection = recovery.beforeRepeatedReconnectProjection as CompanionDomainState
  const afterRepeatedReconnectProjection = recovery.afterRepeatedReconnectProjection as CompanionDomainState
  return {
    schemaVersion: 1,
    language: config.language,
    corpusSha256: corpus.sha256,
    hostCommit: config.hostCommit,
    clientCommit: config.clientCommit,
    linkProtocolVersion: LINK_PROTOCOL_VERSION,
    contractVersion: corpus.contractVersion,
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    steps: STEP_IDS.map(id => ({ id, status: 'PASS' })),
    recovery: {
      preFaultSeq: hostRecovery.preFaultSeq,
      recoverySnapshotCursor: hostRecovery.hostFinalCursor,
      repeatedSnapshotCursor: hostRecovery.hostFinalCursor,
      offlineSeqCount: hostRecovery.offlineSeqCount,
      recoverySnapshotHasMore: false,
      followReplacementCount: semantics.expectedFollowReplacementCount,
      eventReplacementCount: semantics.expectedEventReplacementCount,
      beforeRepeatedReconnectProjection,
      afterRepeatedReconnectProjection,
    },
  }
}

/**
 * Project a Host-validated candidate into the only PASS value allowed outside
 * the isolated acceptance home.
 * @param result validated candidate with both complete Session projections.
 * @returns aggregate evidence and Host-computed projection digests.
 */
function toPublishedAcceptanceResult(result: AcceptanceResult): PublishedAcceptanceResult {
  const before = result.recovery.beforeRepeatedReconnectProjection
  const after = result.recovery.afterRepeatedReconnectProjection
  assertDeepStrictEqualWithoutValues(
    before,
    after,
    'acceptance projections differ across the repeated reconnect',
  )
  return {
    schemaVersion: 1,
    recordKind: 'privacy-safe-acceptance-summary',
    status: 'PASS',
    language: result.language,
    corpusSha256: result.corpusSha256,
    hostCommit: result.hostCommit,
    clientCommit: result.clientCommit,
    linkProtocolVersion: result.linkProtocolVersion,
    contractVersion: result.contractVersion,
    sessionFormatVersion: result.sessionFormatVersion,
    steps: result.steps.map(({ id, status }) => ({ id, status })),
    recovery: {
      preFaultSeq: result.recovery.preFaultSeq,
      recoverySnapshotCursor: result.recovery.recoverySnapshotCursor,
      repeatedSnapshotCursor: result.recovery.repeatedSnapshotCursor,
      offlineSeqCount: result.recovery.offlineSeqCount,
      recoverySnapshotHasMore: result.recovery.recoverySnapshotHasMore,
      followReplacementCount: result.recovery.followReplacementCount,
      eventReplacementCount: result.recovery.eventReplacementCount,
      projectionItemCount: before.items.length,
      projectionPlanActive: before.planActive,
      projectionTodoCount: before.todos.length,
      projectionGoalCount: before.goals.length,
      projectionToolCallCount: before.toolCalls.length,
      projectionImageCount: before.images.length,
      projectionArtifactCount: before.artifacts.length,
      projectionEqualAfterRepeatedReconnect: true,
      beforeRepeatedReconnectProjectionSha256: projectionSha256(before),
      afterRepeatedReconnectProjectionSha256: projectionSha256(after),
      projectionDigestEncoding: PROJECTION_DIGEST_ENCODING,
    },
  }
}

/**
 * Hash the exact UTF-8 JSON serialization held by the Host.
 * @param projection validated companion projection.
 * @returns lowercase SHA-256 hex digest.
 */
function projectionSha256(projection: CompanionDomainState): string {
  return createHash('sha256').update(JSON.stringify(projection), 'utf8').digest('hex')
}

/** Reject deep inequality without allowing an assertion formatter to inspect either value. */
function assertDeepStrictEqualWithoutValues(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message)
}

function sessionFollowRequest(sessionId: string): Record<string, unknown> {
  return {
    address: { kind: 'session', sessionId },
    maxMessages: 50,
  }
}

async function promptSession(client: LinkClient, sessionId: string, text: string): Promise<unknown> {
  return await client.call('session/prompt', { request: {
    requestId: randomUUID(),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  } })
}

async function expectLinkError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation
  } catch (error) {
    if (error instanceof LinkError && error.code === code) return
    throw new Error(`Link request did not fail with ${code}`)
  }
  throw new Error(`Link request did not fail with ${code}`)
}

/** Read one completed success turn from the live follow generation. */
async function readCompletedTurn(
  stream: AsyncGenerator,
  expectedText: string,
): Promise<{ readonly turn: number }> {
  let turn: number | undefined
  let assistantText: string | undefined
  for (let frameCount = 0; frameCount < 1_000; frameCount += 1) {
    const event = sessionEvent(await nextValue(stream, 'successful turn'))
    if (event === undefined) continue
    const data = requireRecord(event.event.data, `${event.event.type} data`)
    if (event.event.type === 'turn/start' && typeof data.turn === 'number') turn = data.turn
    if (event.event.type === 'assistant/message' && data.turn === turn) {
      assistantText = assistantMessageText(data)
    }
    if (event.event.type === 'turn/end' && data.turn === turn) {
      const reason = requireRecord(data.reason, 'successful turn end reason')
      expect(reason.kind).toBe('completed')
      expect(assistantText).toBe(expectedText)
      return { turn: requireNumber(turn, 'successful turn') }
    }
  }
  throw new Error('session/follow did not finish the successful turn')
}

/** Wait until the second prompt has entered the mock-backed model step. */
async function readStepStartAfter(stream: AsyncGenerator, previousTurn: number): Promise<number> {
  for (let frameCount = 0; frameCount < 1_000; frameCount += 1) {
    const event = sessionEvent(await nextValue(stream, 'stalled turn start'))
    if (event?.event.type !== 'step/start') continue
    const data = requireRecord(event.event.data, 'step/start data')
    if (typeof data.turn === 'number' && data.turn > previousTurn) return data.turn
  }
  throw new Error('session/follow did not publish the stalled step start')
}

/** Read the user-cancelled terminal event for the stalled turn. */
async function readCancelledTurn(
  stream: AsyncGenerator,
  turn: number,
): Promise<{ readonly seq: number }> {
  for (let frameCount = 0; frameCount < 1_000; frameCount += 1) {
    const event = sessionEvent(await nextValue(stream, 'cancelled turn'))
    if (event?.event.type !== 'turn/end') continue
    const data = requireRecord(event.event.data, 'cancelled turn/end data')
    if (data.turn !== turn) continue
    expect(data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    return { seq: event.event.seq }
  }
  throw new Error('session/follow did not publish the cancelled turn end')
}

/** Read the scoped approval waterfall from the authenticated Remote Event generation. */
async function readApprovalFrame(
  stream: AsyncGenerator,
  sessionId: string,
): Promise<{
  readonly eventId: string
  readonly request: Record<string, unknown>
}> {
  for (let frameCount = 0; frameCount < 100; frameCount += 1) {
    const frame = requireRecord(await nextValue(stream, 'approval waterfall'), '$events frame')
    if (frame.type !== 'waterfall' || frame.event !== 'approval/request') continue
    if (typeof frame.eventId !== 'string' || frame.agentId !== sessionId) {
      throw new Error('approval waterfall carried the wrong identity')
    }
    return {
      eventId: frame.eventId,
      request: requireRecord(frame.request, 'approval request'),
    }
  }
  throw new Error('$events did not deliver the approval waterfall')
}

/** Poll the small control result without treating 202 as an error. */
async function waitForApprovalResult(config: AcceptanceConfig): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await controlRequest(config, '/approval/result', 'GET')
    if (response.status === 200) return response.body
    if (response.status !== 202 || response.body.pending !== true) {
      throw new Error(`approval result returned HTTP ${String(response.status)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('approval result remained pending')
}

/** Poll until the Host has committed and independently inspected the offline suffix. */
async function waitForRecoveryStatus(
  config: AcceptanceConfig,
  preFaultSeq: number,
): Promise<{ readonly hostFinalCursor: number; readonly offlineSeqCount: number }> {
  const path = `/recovery/status?preFaultSeq=${String(preFaultSeq)}`
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await controlRequest(config, path, 'GET')
    if (response.status === 202) {
      if (!hasExactKeys(response.body, ['pending']) || response.body.pending !== true) {
        throw new Error('recovery status returned an invalid pending response')
      }
      await new Promise(resolve => setTimeout(resolve, 25))
      continue
    }
    if (response.status !== 200
      || !hasExactKeys(response.body, ['hostFinalCursor', 'offlineSeqCount'])) {
      throw new Error(`recovery status returned HTTP ${String(response.status)}`)
    }
    return {
      hostFinalCursor: requireNumber(response.body.hostFinalCursor, 'recovery host final cursor'),
      offlineSeqCount: requireNumber(response.body.offlineSeqCount, 'recovery offline seq count'),
    }
  }
  throw new Error('recovery status remained pending')
}

async function controlRequest(
  config: AcceptanceConfig,
  path: string,
  method: 'GET' | 'POST',
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(`${config.controlEndpoint}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.controlToken}` },
    signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
  })
  return {
    status: response.status,
    body: requireRecord(await response.json(), `control ${path} response`),
  }
}

async function closeInterruptedStreams(...streams: AsyncGenerator[]): Promise<void> {
  const results = await Promise.allSettled(streams.map(async stream => await stream.return(undefined)))
  const failures: unknown[] = []
  for (const result of results) {
    if (result.status === 'rejected') failures.push(result.reason as unknown)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'interrupted Link streams did not both close')
}

/** Read the first recovery chunk that proves the Host model stream is active. */
async function readFirstAssistantChunkAfter(stream: AsyncGenerator, afterSeq: number): Promise<number> {
  while (true) {
    const frame = sessionEvent(await nextValue(stream, 'recovery assistant chunk'))?.event
    if (frame?.type === 'assistant/chunk' && frame.seq > afterSeq) return frame.seq
  }
}

function assertAuthoritativeSnapshot(
  records: readonly unknown[],
  expectedText: string,
  cancelledSeq: number,
): void {
  const assistantTurns = new Set<number>()
  const completedTurns = new Set<number>()
  let cancelled = false
  for (const record of records) {
    const event = sessionEvent(record)?.event
    if (event === undefined) continue
    const data = requireRecord(event.data, `${event.type} snapshot data`)
    if (event.type === 'assistant/message'
      && typeof data.turn === 'number'
      && assistantMessageText(data) === expectedText) {
      assistantTurns.add(data.turn)
    }
    if (event.type === 'turn/end' && typeof data.turn === 'number') {
      const reason = requireRecord(data.reason, 'snapshot turn/end reason')
      if (reason.kind === 'completed') completedTurns.add(data.turn)
      if (event.seq === cancelledSeq) {
        expect(reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
        cancelled = true
      }
    }
  }
  expect([...assistantTurns].some(turn => completedTurns.has(turn))).toBe(true)
  expect(cancelled).toBe(true)
}

function requireSnapshot(
  value: Record<string, unknown> | undefined,
  sessionId: string,
): { readonly cursor: number; readonly records: readonly unknown[]; readonly hasMore: boolean } {
  const snapshot = requireRecord(value, 'session/follow snapshot')
  const header = requireRecord(snapshot.header, 'session/follow header')
  if (snapshot.type !== 'snapshot' || header.id !== sessionId
    || typeof snapshot.cursor !== 'number' || !Array.isArray(snapshot.records)
    || typeof snapshot.hasMore !== 'boolean' || !isRecord(snapshot.projections)) {
    throw new Error('session/follow opening frame is not a complete snapshot')
  }
  return { cursor: snapshot.cursor, records: snapshot.records, hasMore: snapshot.hasMore }
}

/** Validate follow-history records before the reference fold consumes wire JSON. */
function requireCompanionRecords(records: readonly unknown[]): readonly CompanionRecord[] {
  return records.map((value, index) => {
    const record = requireRecord(value, `recovery record ${String(index)}`)
    const event = requireRecord(record.event, `recovery record ${String(index)} event`)
    if (typeof record.type !== 'string'
      || typeof event.type !== 'string'
      || typeof event.seq !== 'number'
      || !Number.isSafeInteger(event.seq)
      || (event.time !== undefined && typeof event.time !== 'number')) {
      throw new Error(`recovery record ${String(index)} is not a companion fold record`)
    }
    return record as unknown as CompanionRecord
  })
}

function sessionEvent(value: unknown): {
  readonly event: { readonly type: string; readonly seq: number; readonly data: unknown }
} | undefined {
  const frame = requireRecord(value, 'session/follow frame')
  if (frame.type !== 'event') return undefined
  const event = requireRecord(frame.event, 'session event')
  if (typeof event.type !== 'string' || typeof event.seq !== 'number') {
    throw new Error('session/follow emitted an invalid event frame')
  }
  return { event: { type: event.type, seq: event.seq, data: event.data } }
}

function assistantMessageText(data: Record<string, unknown>): string {
  const message = requireRecord(data.message, 'assistant message')
  if (!Array.isArray(message.content)) throw new Error('assistant message omitted content')
  return message.content.map((raw) => {
    const block = requireRecord(raw, 'assistant content block')
    return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
  }).join('')
}

async function nextValue(stream: AsyncGenerator, label: string): Promise<unknown> {
  const timeout = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    timeout.reject(new Error(`${label} timed out`))
  }, 30_000)
  try {
    const next = await Promise.race([stream.next(), timeout.promise])
    if (next.done) throw new Error(`${label} ended before its value`)
    return next.value
  } finally {
    clearTimeout(timer)
  }
}

function corpusStep<Id extends StepId>(
  corpus: AcceptanceCorpus,
  id: Id,
): Extract<AcceptanceStep, { readonly id: Id }> {
  const step = corpus.steps.find(candidate => candidate.id === id)
  if (step === undefined) throw new Error(`acceptance corpus omitted ${id}`)
  return step as Extract<AcceptanceStep, { readonly id: Id }>
}

function requireClient(value: LinkClient | undefined): LinkClient {
  if (value === undefined) throw new Error('Link client is not paired')
  return value
}

function requireStream(value: AsyncGenerator | undefined, name: string): AsyncGenerator {
  if (value === undefined) throw new Error(`${name} is not open`)
  return value
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be non-empty`)
  return value
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`)
  return value
}

function requireRecoveryResult(value: RecoveryAcceptanceResult | undefined): RecoveryAcceptanceResult {
  if (value === undefined) throw new Error('acceptance reconnect omitted recovery evidence')
  return value
}

function requireApprovalOutcome(value: unknown): ApprovalOutcome {
  if (value !== 'allowed-once') throw new Error('acceptance approval outcome must be allowed-once')
  return value
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function requireSuite(): AcceptanceSuite {
  if (suite === undefined) throw new Error('Link native acceptance suite is unavailable')
  return suite
}

function redactDriverOutput(output: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (redacted, secret) => secret === '' ? redacted : redacted.replaceAll(secret, '[REDACTED]'),
    output,
  )
}

function assertNoAcceptanceSecrets(serialized: string, config: AcceptanceConfig): void {
  if ([config.controlToken, config.pairing.code].some(secret =>
    secret !== '' && serialized.includes(secret))) {
    throw new Error('acceptance result contains credential material')
  }
}

function writeJson(response: import('node:http').ServerResponse, status: number, value: object): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => {
      server.off('listening', ready)
      reject(error)
    }
    const ready = (): void => {
      server.off('error', fail)
      resolve()
    }
    server.once('error', fail)
    server.once('listening', ready)
    server.listen(0, '127.0.0.1')
  })
}

async function waitFor(
  condition: () => Promise<void>,
  label: string,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await condition()
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  throw new Error(`${label} timed out`, { cause: lastError })
}

async function containCleanup(cleanup: Promise<unknown>, failures: unknown[]): Promise<void> {
  try {
    await cleanup
  } catch (error) {
    failures.push(error)
  }
}

type DeadlineSettlement<T> =
  | { readonly expired: true }
  | { readonly expired: false; readonly value: T }

/** Treat a winner resumed at or after the absolute deadline as expired. */
async function settleBeforeAbsoluteDeadline<T>(
  operation: Promise<T>,
  deadline: number,
): Promise<DeadlineSettlement<T>> {
  const remaining = deadline - performance.now()
  if (remaining <= 0) return { expired: true }
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<DeadlineSettlement<T>>((resolveExpired) => {
    timer = setTimeout(() => { resolveExpired({ expired: true }) }, remaining)
  })
  let winner: DeadlineSettlement<T>
  try {
    winner = await Promise.race([
      operation.then(value => ({ expired: false, value }) as const),
      expired,
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  return winner.expired || performance.now() >= deadline
    ? { expired: true }
    : winner
}

/** Bound teardown before evidence publication; late cleanup has no publication path. */
async function settleCleanupBeforeDeadline(
  cleanup: Promise<unknown[]>,
  deadline: number,
): Promise<unknown[]> {
  const result = await settleBeforeAbsoluteDeadline(
    cleanup.catch((error: unknown) => [error]),
    deadline,
  )
  return result.expired
    ? [new Error('Link native acceptance teardown exceeded its absolute deadline')]
    : result.value
}

async function cleanupAcceptanceSuite(current: AcceptanceSuite | undefined): Promise<unknown[]> {
  const failures: unknown[] = []
  await stopActiveNativeProcess(failures)
  if (current === undefined) return failures
  await containCleanup(current.control.close(), failures)
  await containCleanup(current.ctx.fiber.dispose(), failures)
  await containCleanup(current.mock.close(), failures)
  await containCleanup(
    rm(current.home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    failures,
  )
  return failures
}

async function stopActiveNativeProcess(failures: unknown[]): Promise<void> {
  const child = activeNativeProcess
  activeNativeProcess = undefined
  if (child === undefined) return
  try {
    child.terminate()
  } catch (error) {
    failures.push(error)
  }
  await containCleanup(child.done, failures)
  await containCleanup(child.waitForExit(), failures)
}

function restoreDshHome(): void {
  const snapshot = dshHomeSnapshot
  dshHomeSnapshot = undefined
  if (snapshot === undefined) return
  if (snapshot.present && snapshot.value !== undefined) process.env.DSH_HOME = snapshot.value
  else delete process.env.DSH_HOME
}

function markSuiteFailed(): void {
  suiteFailed = true
}

/** Select the shipped acceptance suite or one process-isolated runner regression. */
function registerRequestedSuite(): void {
  const regression = process.env.DSH_LINK_ACCEPTANCE_INTERNAL_REGRESSION
  switch (regression) {
    case undefined:
      registerAcceptanceSuite()
      return
    case 'pass-publication':
      registerPassPublicationRegression()
      return
    case 'sensitive-mismatch':
      registerSensitiveMismatchRegression()
      return
    case 'event-loop-deadline':
      registerEventLoopDeadlineRegression()
      return
    case 'test-timeout-publication':
      registerProcessTreePublicationRegression('test-timeout')
      return
    case 'native-driver-cancellation':
      registerProcessTreePublicationRegression('driver-cancellation')
      return
    default:
      throw new Error(`unsupported Link acceptance internal regression ${regression}`)
  }
}

function registerPassPublicationRegression(): void {
  let fixture: PublicationRegressionFixture | undefined
  beforeAll(async () => {
    fixture = await preparePublicationRegression()
  })
  afterAll(async () => {
    const current = requirePublicationRegression(fixture)
    const failures: unknown[] = []
    await publishNativeEvidence(
      current.artifact,
      current.publication,
      failures,
      performance.now() + 5_000,
      () => false,
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'PASS publication regression teardown failed')
    }
  }, 10_000)
  describe('Link acceptance PASS publication regression', () => {
    it('prepares privacy-safe evidence for atomic publication', () => {
      const publication = requirePublicationRegression(fixture).publication.result
      expect(publication.status).toBe('PASS')
      expect(publication.steps).toHaveLength(STEP_IDS.length)
    })
  })
}

interface SensitiveMismatchRegressionFixture {
  readonly artifact: NativeArtifact
  readonly home: string
  readonly corpus: AcceptanceCorpus
  readonly config: AcceptanceConfig
  readonly candidate: AcceptanceResult
}

function registerSensitiveMismatchRegression(): void {
  let fixture: SensitiveMismatchRegressionFixture | undefined
  beforeAll(async () => {
    const publication = await preparePublicationRegression()
    const home = join(dirname(publication.artifact.resultPath), 'candidate-home')
    await mkdir(home)
    const corpus = await readCorpus()
    const config: AcceptanceConfig = {
      ...processTreeRegressionConfig(join(home, 'candidate.json')),
      corpusPath: CORPUS_PATH,
    }
    const before = publicationRegressionProjection()
    const after = { ...before, planActive: false }
    const candidate: AcceptanceResult = {
      ...publicationRegressionCandidate(before, after),
      corpusSha256: corpus.sha256,
      contractVersion: corpus.contractVersion,
    }
    await writeEvidenceAtomically(config.candidateResultPath, candidate)
    fixture = { artifact: publication.artifact, home, corpus, config, candidate }
  })
  afterAll(async () => {
    const current = requireSensitiveMismatchRegression(fixture)
    const failures: unknown[] = []
    await containCleanup(rm(current.home, { recursive: true, force: true }), failures)
    await publishNativeEvidence(
      current.artifact,
      undefined,
      failures,
      performance.now() + 5_000,
      () => true,
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'sensitive mismatch regression teardown failed')
    }
  }, 10_000)
  describe('Link acceptance sensitive mismatch regression', () => {
    it('rejects private unequal projections without formatting their values', async () => {
      const current = requireSensitiveMismatchRegression(fixture)
      const received = await readAndRemoveNativeCandidate(current.config)
      if (await pathExists(current.config.candidateResultPath)) {
        throw new Error('sensitive mismatch candidate remained after its bounded read')
      }
      const hostRecovery: HostRecoveryEvidence = {
        preFaultSeq: 6,
        hostFinalCursor: 7,
        offlineSeqCount: 1,
        snapshotHasMore: false,
        canonicalProjection: current.candidate.recovery.beforeRepeatedReconnectProjection,
      }
      let validationRejected = false
      try {
        validateResult(received, current.config, current.corpus, hostRecovery)
      } catch (error) {
        validationRejected = error instanceof Error
          && error.message === 'swift acceptance projection after repeated reconnect does not match the Host'
      }
      if (!validationRejected) {
        throw new Error('sensitive mismatch validation did not use its fixed rejection')
      }
      let conversionRejected = false
      try {
        toPublishedAcceptanceResult(current.candidate)
      } catch (error) {
        conversionRejected = error instanceof Error
          && error.message === 'acceptance projections differ across the repeated reconnect'
      }
      if (!conversionRejected) {
        throw new Error('sensitive mismatch conversion did not use its fixed rejection')
      }
    })
  })
}

function requireSensitiveMismatchRegression(
  fixture: SensitiveMismatchRegressionFixture | undefined,
): SensitiveMismatchRegressionFixture {
  if (fixture === undefined) throw new Error('sensitive mismatch regression fixture is unavailable')
  return fixture
}

function registerEventLoopDeadlineRegression(): void {
  let fixture: PublicationRegressionFixture | undefined
  beforeAll(async () => {
    fixture = await preparePublicationRegression()
  })
  afterAll(async () => {
    const current = requirePublicationRegression(fixture)
    const teardownStartedAt = performance.now()
    const cleanupDeadline = teardownStartedAt + 10
    const cleanup = Promise.resolve().then((): unknown[] => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40)
      return []
    })
    const failures = await settleCleanupBeforeDeadline(cleanup, cleanupDeadline)
    await publishNativeEvidence(
      current.artifact,
      current.publication,
      failures,
      teardownStartedAt + 5_000,
      () => false,
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'event-loop deadline regression teardown failed')
    }
  }, 10_000)
  describe('Link acceptance deadline regression', () => {
    it('prepares PASS evidence before teardown crosses its deadline', () => {
      expect(requirePublicationRegression(fixture).publication.result.steps).toHaveLength(STEP_IDS.length)
    })
  })
}

function registerProcessTreePublicationRegression(
  mode: 'driver-cancellation' | 'test-timeout',
): void {
  let fixture: PublicationRegressionFixture | undefined
  let processContext: Context | undefined
  beforeAll(async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(LocalSubprocessRuntime)
      fixture = await preparePublicationRegression()
      processContext = ctx
    } catch (error) {
      await ctx.fiber.dispose()
      throw error
    }
  })
  afterAll(async () => {
    const current = requirePublicationRegression(fixture)
    const failures: unknown[] = []
    const observationPath = processTreeRegressionPath(current.artifact.resultPath)
    let observation: ProcessTreeRegressionObservation | undefined
    try {
      observation = await readProcessTreeRegressionObservation(observationPath)
      let terminatedBeforeCleanup = false
      try {
        await waitForProcessTreeRegressionExit(observation)
        terminatedBeforeCleanup = true
      } catch (error) {
        failures.push(error)
      }
      await containCleanup(
        writeEvidenceAtomically(
          observationPath,
          { ...observation, terminatedBeforeCleanup },
        ),
        failures,
      )
    } catch (error) {
      failures.push(error)
    }
    await stopActiveNativeProcess(failures)
    if (processContext !== undefined) {
      await containCleanup(processContext.fiber.dispose(), failures)
      processContext = undefined
    }
    if (observation !== undefined) {
      await terminateProcessTreeRegressionProcesses(observation, failures)
    }
    await publishNativeEvidence(
      current.artifact,
      current.publication,
      failures,
      performance.now() + 5_000,
      () => suiteFailed,
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'process-tree publication regression cleanup failed')
    }
  }, 20_000)
  if (mode === 'test-timeout') {
    describe('Link acceptance test-timeout regression', () => {
      it('terminates the native process tree and keeps FAIL evidence after timing out', async ({ signal }) => {
        onTestFailed(markSuiteFailed)
        const { driverRun, observationPath } = startProcessTreeRegressionDriver(
          requirePublicationRegression(fixture),
          requireProcessTreeRegressionContext(processContext),
          signal,
        )
        await Promise.race([
          driverRun.then((): never => {
            throw new Error('process-tree regression driver exited before the timeout')
          }),
          waitForProcessTreeRegressionReady(observationPath),
        ])
        await driverRun
      }, PROCESS_TREE_REGRESSION_TIMEOUT_MS)
    })
    return
  }
  describe('Link acceptance native-driver cancellation regression', () => {
    it('rejects cancellation even when the direct child exits successfully', async () => {
      onTestFailed(markSuiteFailed)
      const current = requirePublicationRegression(fixture)
      const controller = new AbortController()
      const { driverRun, observationPath } = startProcessTreeRegressionDriver(
        current,
        requireProcessTreeRegressionContext(processContext),
        controller.signal,
        true,
      )
      await Promise.race([
        driverRun.then((): never => {
          throw new Error('process-tree regression driver exited before cancellation')
        }),
        waitForProcessTreeRegressionReady(observationPath),
      ])
      markSuiteFailed()
      controller.abort('native-driver cancellation regression')
      const error = await driverRun.then(
        (): never => { throw new Error('cancelled native driver returned a candidate result') },
        (reason: unknown) => reason,
      )
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toContain('was cancelled')
      expect(message).toContain('exit code ')
      expect(message).toContain('signal ')
      expect(message.includes(PROCESS_TREE_REGRESSION_CONTROL_TOKEN.slice(
        -PROCESS_TREE_RETAINED_SECRET_SUFFIX_BYTES,
      ))).toBe(false)
      if (await pathExists(processTreeRegressionCandidatePath(current.artifact.resultPath))) {
        throw new Error('cancelled native driver retained its candidate result')
      }
      if (process.platform !== 'win32') expect(message).toContain('exit code 0')
    }, 15_000)
  })
}

function startProcessTreeRegressionDriver(
  current: PublicationRegressionFixture,
  ctx: Context,
  signal: AbortSignal,
  emitLossyOutput = false,
): { readonly driverRun: Promise<unknown>; readonly observationPath: string } {
  const observationPath = processTreeRegressionPath(current.artifact.resultPath)
  const config = processTreeRegressionConfig(
    processTreeRegressionCandidatePath(current.artifact.resultPath),
  )
  const driver: NativeDriver = {
    language: 'swift',
    argv: [
      process.execPath,
      '--input-type=module',
      '--eval',
      PROCESS_TREE_REGRESSION_DRIVER_SOURCE,
      ...(emitLossyOutput ? ['lossy-output'] : []),
    ],
    resultPath: current.artifact.resultPath,
  }
  return {
    driverRun: runNativeDriver(
      { ctx, home: dirname(current.artifact.resultPath) },
      driver,
      config,
      signal,
    ),
    observationPath,
  }
}

function requireProcessTreeRegressionContext(ctx: Context | undefined): Context {
  if (ctx === undefined) throw new Error('process-tree regression subprocess context is unavailable')
  return ctx
}

const PROCESS_TREE_REGRESSION_DRIVER_SOURCE = `
import { spawn } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const configPath = process.env.DSH_LINK_ACCEPTANCE_CONFIG
if (configPath === undefined) throw new Error('process-tree regression config is missing')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (process.env.DSH_HOME === undefined
  || resolve(process.env.DSH_HOME) !== resolve(dirname(config.candidateResultPath))) {
  throw new Error('process-tree regression DSH_HOME does not own the candidate result')
}
const childSentinelPresent = Object.hasOwn(process.env, 'DSH_LINK_ACCEPTANCE_REGRESSION_TOKEN')
process.on('SIGTERM', () => { process.exit(0) })
setTimeout(() => process.exit(124), 40_000)
const grandchild = spawn(process.execPath, [
  '--input-type=module',
  '--eval',
  "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(124), 40_000); process.send?.({ ready: true, sentinelPresent: Object.hasOwn(process.env, 'DSH_LINK_ACCEPTANCE_REGRESSION_TOKEN') })",
], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  windowsHide: true,
})
if (grandchild.pid === undefined) throw new Error('process-tree regression grandchild did not start')
let grandchildSentinelPresent
await new Promise((resolveReady, rejectReady) => {
  grandchild.once('error', rejectReady)
  grandchild.once('exit', (code, signal) => {
    rejectReady(new Error('process-tree regression grandchild exited before readiness: ' + code + '/' + signal))
  })
  grandchild.once('message', message => {
    if (typeof message === 'object' && message !== null && message.ready === true
      && typeof message.sentinelPresent === 'boolean') {
      grandchildSentinelPresent = message.sentinelPresent
      resolveReady()
    } else {
      rejectReady(new Error('process-tree regression grandchild sent malformed readiness'))
    }
  })
})
if (grandchildSentinelPresent === undefined) {
  throw new Error('process-tree regression grandchild omitted its environment observation')
}
if (process.argv[1] === 'lossy-output') {
  const retainedPaddingBytes = ${NATIVE_PROCESS_OUTPUT_MAX_BYTES}
    - ${PROCESS_TREE_RETAINED_SECRET_SUFFIX_BYTES}
  await new Promise(resolveOutput => {
    process.stdout.write(config.controlToken + 'x'.repeat(retainedPaddingBytes), resolveOutput)
  })
}
writeFileSync(config.candidateResultPath, JSON.stringify({ candidate: true }) + '\\n', { mode: 0o600 })
const observationPath = resolve(dirname(config.candidateResultPath), '${PROCESS_TREE_RESULT_NAME}')
const temporaryPath = observationPath + '.' + process.pid + '.tmp'
writeFileSync(
  temporaryPath,
  JSON.stringify({
    childPid: process.pid,
    childSentinelPresent,
    grandchildPid: grandchild.pid,
    grandchildSentinelPresent,
    ready: true,
  }) + '\\n',
  { mode: 0o600 },
)
renameSync(temporaryPath, observationPath)
`

function processTreeRegressionPath(resultPath: string): string {
  return join(dirname(resultPath), PROCESS_TREE_RESULT_NAME)
}

function processTreeRegressionCandidatePath(resultPath: string): string {
  return join(dirname(resultPath), PROCESS_TREE_CANDIDATE_NAME)
}

function processTreeRegressionConfig(candidateResultPath: string): AcceptanceConfig {
  return {
    schemaVersion: 1,
    language: 'swift',
    corpusPath: CORPUS_PATH,
    candidateResultPath,
    pairing: {
      v: 1,
      kind: 'dsh-link-pairing',
      hostId: 'timeout-regression-host',
      hostName: 'Timeout Regression Host',
      endpoint: 'https://127.0.0.1',
      spkiFingerprint: '0'.repeat(64),
      code: 'timeout-regression-code',
      expiresAt: Number.MAX_SAFE_INTEGER,
    },
    sessionId: 'timeout-regression-session',
    controlEndpoint: 'http://127.0.0.1',
    controlToken: PROCESS_TREE_REGRESSION_CONTROL_TOKEN,
    hostCommit: '0'.repeat(40),
    clientCommit: '0'.repeat(40),
    expectedResponseText: 'unused',
    deviceName: 'Timeout Regression Driver',
  }
}

async function waitForProcessTreeRegressionReady(
  path: string,
): Promise<ProcessTreeRegressionObservation> {
  let observation: ProcessTreeRegressionObservation | undefined
  await waitFor(async () => {
    const seed = await readProcessTreeRegressionSeed(path)
    const snapshot = PROCESS_INSPECTOR.snapshot()
    const tree = snapshot.tree(seed.childPid)
    const child = tree.find(identity => identity.pid === seed.childPid)
    const grandchild = tree.find(identity => identity.pid === seed.grandchildPid)
    if (child === undefined || grandchild === undefined
      || !snapshot.alive(child) || !snapshot.alive(grandchild)) {
      throw new Error('process-tree regression did not observe both live processes')
    }
    const candidate = {
      ...seed,
      childStarted: child.started,
      grandchildStarted: grandchild.started,
    }
    await writeEvidenceAtomically(path, candidate)
    observation = candidate
  }, 'process-tree regression readiness')
  if (observation === undefined) throw new Error('process-tree regression readiness was not recorded')
  return observation
}

async function waitForProcessTreeRegressionExit(
  observation: ProcessTreeRegressionObservation,
): Promise<void> {
  await waitFor(() => {
    const snapshot = PROCESS_INSPECTOR.snapshot()
    const running = processTreeRegressionIdentities(observation)
      .filter(identity => snapshot.alive(identity))
    if (running.length > 0) {
      throw new Error(`process-tree regression left running pids: ${running.map(({ pid }) => pid).join(', ')}`)
    }
    return Promise.resolve()
  }, 'process-tree regression cancellation')
}

async function readProcessTreeRegressionObservation(
  path: string,
): Promise<ProcessTreeRegressionObservation> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  const seed = parseProcessTreeRegressionSeed(value)
  if (!isRecord(value)) throw new Error('process-tree regression observation is malformed')
  const childStarted = requireProcessTreeRegressionStarted(value.childStarted, 'child')
  const grandchildStarted = requireProcessTreeRegressionStarted(value.grandchildStarted, 'grandchild')
  if (value.terminatedBeforeCleanup !== undefined
    && typeof value.terminatedBeforeCleanup !== 'boolean') {
    throw new Error('process-tree regression settlement is malformed')
  }
  return {
    ...seed,
    childStarted,
    grandchildStarted,
    ...(value.terminatedBeforeCleanup === undefined
      ? {}
      : { terminatedBeforeCleanup: value.terminatedBeforeCleanup }),
  }
}

async function readProcessTreeRegressionSeed(path: string): Promise<ProcessTreeRegressionSeed> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  return parseProcessTreeRegressionSeed(value)
}

function parseProcessTreeRegressionSeed(value: unknown): ProcessTreeRegressionSeed {
  if (!isRecord(value) || value.ready !== true
    || typeof value.childSentinelPresent !== 'boolean'
    || typeof value.grandchildSentinelPresent !== 'boolean') {
    throw new Error('process-tree regression observation is malformed')
  }
  const childPid = requireProcessTreeRegressionPid(value.childPid, 'child')
  const grandchildPid = requireProcessTreeRegressionPid(value.grandchildPid, 'grandchild')
  if (childPid === grandchildPid) {
    throw new Error('process-tree regression child and grandchild pids must differ')
  }
  return {
    childSentinelPresent: value.childSentinelPresent,
    childPid,
    grandchildSentinelPresent: value.grandchildSentinelPresent,
    grandchildPid,
    ready: true,
  }
}

function requireProcessTreeRegressionPid(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0
    || value === process.pid) {
    throw new Error(`process-tree regression ${label} pid is invalid`)
  }
  return value
}

function requireProcessTreeRegressionStarted(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`process-tree regression ${label} start identity is invalid`)
  }
  return value
}

function processTreeRegressionIdentities(
  observation: ProcessTreeRegressionObservation,
): readonly ProcessIdentity[] {
  return [
    { pid: observation.grandchildPid, started: observation.grandchildStarted },
    { pid: observation.childPid, started: observation.childStarted },
  ]
}

async function terminateProcessTreeRegressionProcesses(
  observation: ProcessTreeRegressionObservation,
  failures: unknown[],
): Promise<void> {
  const identities = processTreeRegressionIdentities(observation)
  for (const identity of identities) {
    try {
      PROCESS_INSPECTOR.signalProcess(identity, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failures.push(error)
    }
  }
  await containCleanup(waitFor(() => {
    const snapshot = PROCESS_INSPECTOR.snapshot()
    const running = identities.filter(identity => snapshot.alive(identity))
    if (running.length > 0) {
      throw new Error(`process-tree regression cleanup left pids: ${running.map(({ pid }) => pid).join(', ')}`)
    }
    return Promise.resolve()
  }, 'process-tree regression fallback cleanup'), failures)
}

interface PublicationRegressionFixture {
  readonly artifact: NativeArtifact
  readonly publication: NativePublication
}

/** Non-empty private projection used to prove publication emits only aggregates. */
function publicationRegressionProjection(): CompanionDomainState {
  return {
    cursor: 7,
    items: [{ seq: 7, kind: 'assistant/message', text: SENSITIVE_PROJECTION_SENTINEL }],
    planActive: true,
    todos: [{ text: 'private todo', status: 'pending' }],
    goals: [{ id: 'goal-1', title: 'private goal', state: 'active' }],
    toolCalls: [{
      id: 'call-1',
      seq: 6,
      name: 'private_tool',
      arguments: '{}',
      phase: 'completed',
      resultText: 'private result',
    }],
    images: [{
      attachmentId: 'attachment-1',
      mediaType: 'image/png',
      width: 1,
      height: 1,
      name: 'private.png',
    }],
    artifacts: [{
      id: 'artifact-1',
      kind: 'text',
      title: 'private artifact',
      status: 'ready',
    }],
  }
}

/** Candidate shared by positive and mismatch publication regressions. */
function publicationRegressionCandidate(
  before: CompanionDomainState,
  after: CompanionDomainState = before,
): AcceptanceResult {
  return {
    schemaVersion: 1,
    language: 'swift',
    corpusSha256: '0'.repeat(64),
    hostCommit: '0'.repeat(40),
    clientCommit: '0'.repeat(40),
    linkProtocolVersion: LINK_PROTOCOL_VERSION,
    contractVersion: LINK_CONTRACT_VERSION,
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    steps: STEP_IDS.map(id => ({ id, status: 'PASS' })),
    recovery: {
      preFaultSeq: 6,
      recoverySnapshotCursor: 7,
      repeatedSnapshotCursor: 7,
      offlineSeqCount: 1,
      recoverySnapshotHasMore: false,
      followReplacementCount: 2,
      eventReplacementCount: 2,
      beforeRepeatedReconnectProjection: before,
      afterRepeatedReconnectProjection: after,
    },
  }
}

async function preparePublicationRegression(): Promise<PublicationRegressionFixture> {
  const resultValue = process.env.DSH_LINK_ACCEPTANCE_RESULT
  if (resultValue === undefined || !isAbsolute(resultValue)) {
    throw new Error('publication regression requires an absolute result path')
  }
  const resultPath = resolve(resultValue)
  if (await pathExists(resultPath)) {
    throw new Error('publication regression result path must not exist')
  }
  const artifact: NativeArtifact = { language: 'swift', resultPath }
  await writeEvidenceAtomically(resultPath, {
    schemaVersion: 1,
    language: artifact.language,
    status: 'FAIL',
    reason: 'regression-awaiting-after-all',
  })
  const candidate = JSON.parse(JSON.stringify(
    publicationRegressionCandidate(publicationRegressionProjection()),
  )) as AcceptanceResult
  return {
    artifact,
    publication: {
      artifact,
      result: toPublishedAcceptanceResult(candidate),
    },
  }
}

function requirePublicationRegression(
  fixture: PublicationRegressionFixture | undefined,
): PublicationRegressionFixture {
  if (fixture === undefined) throw new Error('publication regression fixture is unavailable')
  return fixture
}

registerRequestedSuite()
