// Boots the shipped Web composition over the built dist this lane already uses
// and asserts what that composition produces: the model-visible tool catalog
// and file-reference guidance plus its HTTP, retry, sandbox, and approval defaults.
// No browser and no model call — these are composition facts, and the browser
// scenarios in this lane cover the surface itself.
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Empty type imports carry the tools/sandboxPolicy/approval Context merges.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-telemetry'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH = join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
const FILE_REFERENCE_PROMPT = fileURLToPath(new URL(
  './expected/web-runtime-context/file-reference-prompt.expected.md', import.meta.url,
))
const SHELL_TOOL = process.platform === 'win32' ? 'pwsh' : 'bash'
const SHELL_COMMAND = process.platform === 'win32'
  ? "Write-Output 'SHIPPED_BACKGROUND_OK'"
  : 'printf SHIPPED_BACKGROUND_OK'
const SHELL_JOB_ID = `${SHELL_TOOL}-1`

/**
 * The catalog the shipped Web composition puts in front of the model, minus the
 * ripgrep-dependent pair below. The absences are deliberate, not incidental
 * gaps: the `cordis_*` toolset executes model-written JavaScript that no
 * sandbox row confines, and `mcp_*` servers spawn outside `ctx.shell`.
 * `web_fetch` is present because public-address enforcement and one-shot
 * approval now confine its model-selected request target. The composition
 * Agent Note owns the rationale and its sources.
 */
const EXPECTED_TOOLS = [
  'artifact_create',
  'artifact_read',
  'ask_user_question',
  SHELL_TOOL,
  'create_goal',
  'edit',
  'exit_plan_mode',
  'get_goal',
  'interrupt_agent',
  'job_kill',
  'job_list',
  'job_output',
  'list_agents',
  'ralph',
  'read',
  'read_image',
  'send_message',
  'skill',
  'subagent',
  'subagent_fork',
  'todo_write',
  'update_goal',
  'web_fetch',
  'web_search',
  'workflow',
  'write',
].toSorted()

/**
 * `glob` and `grep` come from `dsh-tool-fs-search`, which spawns the PACKAGED
 * ripgrep binary (`@vscode/ripgrep`) through the subprocess seam, so the pair
 * is always present on every host — asserted as fixed members, not a host
 * dependency.
 */
const RIPGREP_TOOLS = ['glob', 'grep']

let scaffold: WebScaffold | undefined

afterEach(async () => {
  await scaffold?.close()
  scaffold = undefined
})

/** Boot the shipped Web layers while leaving their telemetry row untouched. */
async function bootDefaultTelemetryComposition(harnessHome: string): Promise<Context> {
  const profileDir = join(harnessHome, 'profiles', 'telemetry-default')
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, home: harnessHome })
  await mkdir(profileDir, { recursive: true })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  return await boot('dsh-test', rootConfig, [
    ...loadOverlayPatches('shipped telemetry default e2e', BASE_PATCH),
    ...loadOverlayPatches('shipped telemetry default e2e', WEB_PATCH),
    { id: 'settings', config: { dshHome: harnessHome } },
    { id: 'credentials', config: { dshHome: harnessHome } },
    { id: 'session-persistence-jsonl', config: { root: join(harnessHome, 'sessions') } },
    { id: 'storage-json', config: { root: join(harnessHome, 'storages') } },
    { id: 'agent-presets', config: { default: 'standard', includeUserRoot: false } },
    { id: 'session-title-llm', disabled: true },
    {
      id: 'webserver',
      config: {
        host: '127.0.0.1', port: 0, compression: 'gzip',
        compressionLevel: 1, compressionThresholdBytes: 1024,
      },
    },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: true } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    { id: 'llm-deepseek', disabled: true },
  ], (ctx) => {
    provideCmdline(ctx, { args: [], exit: () => {} })
  })
}

it('keeps the shipped telemetry row mounted but silent when mode is unset', async () => {
  const collector = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  })
  let requestCount = 0
  collector.on('request', () => { requestCount += 1 })
  const environmentKeys = [
    'DSH_HOME',
    'DSH_TELEMETRY_DISABLED',
    'DSH_TELEMETRY_MODE',
    'DSH_TELEMETRY_OTLP_URL',
  ] as const
  const originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]))
  let harnessHome: string | undefined
  let ctx: Context | undefined
  try {
    collector.listen(0, '127.0.0.1')
    await once(collector, 'listening')
    const address = collector.address()
    if (address === null || typeof address === 'string') throw new Error('telemetry collector has no port')
    const collectorUrl = `http://127.0.0.1:${String(address.port)}/v1/logs`

    harnessHome = await mkdtemp(join(tmpdir(), 'dsh-web-telemetry-default-'))
    process.env.DSH_HOME = harnessHome
    Reflect.deleteProperty(process.env, 'DSH_TELEMETRY_DISABLED')
    Reflect.deleteProperty(process.env, 'DSH_TELEMETRY_MODE')
    process.env.DSH_TELEMETRY_OTLP_URL = collectorUrl

    ctx = await bootDefaultTelemetryComposition(harnessHome)
    const telemetryEntry = [...ctx.loader.entries()]
      .find(entry => entry.options.id === 'session-telemetry-otel')
    expect(telemetryEntry?.options.name).toBe('@deepseek-ai/dsh-session-telemetry-otel')
    expect(telemetryEntry?.disabled).toBe(false)
    expect(telemetryEntry?.fiber).toBeDefined()
    expect(telemetryEntry?.fiber?.config).toMatchObject({
      mode: 'DISABLED',
      exporter: { url: collectorUrl },
    })
    expect(ctx.sessionTelemetry.sharing).toBe('disabled')

    const handle = await ctx.agents.create({
      sessionId: SessionId('shipped-telemetry-default'),
      meta: { cwd: harnessHome },
    })
    try {
      const execution = await ctx.commands.execute(
        handle.agent,
        '/feedback remains local',
        [],
        new AbortController().signal,
      )
      expect(execution?.result.kind).toBe('success')
      if (execution?.result.kind !== 'success') throw new Error('feedback command did not succeed')
      expect(execution.result.text).toContain('Session sharing is disabled.')
    } finally {
      await handle.dispose()
    }

    await ctx.fiber.dispose()
    ctx = undefined
    expect(requestCount).toBe(0)
  } finally {
    const cleanupFailures: unknown[] = []
    if (ctx !== undefined) {
      await Promise.resolve(ctx.fiber.dispose()).catch((error: unknown) => cleanupFailures.push(error))
    }
    try {
      for (const key of environmentKeys) {
        const value = originalEnvironment[key]
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
    } catch (error) {
      cleanupFailures.push(error)
    }
    if (harnessHome !== undefined) {
      await rm(harnessHome, { recursive: true, force: true }).catch((error: unknown) => cleanupFailures.push(error))
    }
    try {
      collector.closeAllConnections()
    } catch (error) {
      cleanupFailures.push(error)
    }
    if (collector.listening) {
      await new Promise<void>((resolve, reject) => {
        collector.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
        .catch((error: unknown) => cleanupFailures.push(error))
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, 'shipped telemetry default e2e cleanup failed')
    }
  }
}, 120_000)

it('injects the module bootstrap when the webServer provider activates later', async () => {
  scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
  const index = await scaffold.hostFetch('/')
  const indexBody = await index.text()
  expect(indexBody).toContain('window.__ModuleLoader__=')
  expect(indexBody).toContain('globalThis["__DSH_BOOT__"] = ')
})

it('assembles the shipped Web transport, catalog, guidance, and defaults', async () => {
  scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
  const ctx = scaffold.ctx
  const index = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}`, {
    headers: { 'accept-encoding': 'gzip' },
  })
  expect(index.headers.get('content-encoding')).toBe('gzip')
  expect(index.headers.get('vary')).toContain('Accept-Encoding')
  await index.body?.cancel()
  expect(ctx.llm.providerRetryPolicy('deepseek-official')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "maxRetries": 5,
      "mode": "normal",
      "retryableCodes": [
        "EMPTY_RESPONSE",
        "RATE_LIMIT",
        "SERVER",
        "TIMEOUT",
        "TRANSPORT",
      ],
    }
  `)
  await ctx.settings.update(settingsNamespace('llm-deepseek'), {
    retryPolicy: { mode: 'always', maxRetries: 5 },
  })
  expect(ctx.llm.providerRetryPolicy('deepseek-official')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "mode": "always",
    }
  `)
  await ctx.settings.update(settingsNamespace('llm-pi-ai'), {
    providers: {
      openai: {},
      anthropic: { retryPolicy: { mode: 'always' } },
    },
  })
  expect(ctx.llm.providerRetryPolicy('openai')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "maxRetries": 5,
      "mode": "normal",
      "retryableCodes": [
        "EMPTY_RESPONSE",
        "RATE_LIMIT",
        "SERVER",
        "TIMEOUT",
        "TRANSPORT",
      ],
    }
  `)
  expect(ctx.llm.providerRetryPolicy('anthropic')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "mode": "always",
    }
  `)
  // The catalog belongs to an AGENT, not to the process: every model-facing row
  // now lives in a preset mounted under one session's scope, so the global
  // layer holds nothing and a caller must name the agent to see anything. This
  // composes from the deployment default — what a session that names no preset
  // gets — which is the shape this test has always been about.
  expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([])
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-composition'),
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    const names = ctx.tools.schemas(handle.agent).map(schema => schema.name).sort()
    expect(names.filter(name => !RIPGREP_TOOLS.includes(name))).toEqual(EXPECTED_TOOLS)
    // The packaged ripgrep binary ships with the dependency, so the pair is a
    // fixed roster member on every host.
    expect(names.filter(name => RIPGREP_TOOLS.includes(name))).toEqual(RIPGREP_TOOLS)
    const fileReferenceSection = (await ctx.systemPrompt.assemble({ scope: handle.agent })).sections
      .find(section => section.name === 'ui:deliverable-file-references')
    expect(fileReferenceSection?.text).toBe(readFileSync(FILE_REFERENCE_PROMPT, 'utf8').trimEnd())
  } finally {
    await handle.dispose()
  }
  // `workspace-write` is not "the workspace and nothing else": the shared roots
  // helper always admits the temp directories too. Pinning it against an
  // explicit mode keeps the claim independent of this surface's default, and
  // keeps a future sandbox-confinement test from being run inside /tmp — where an
  // "escape" write succeeds by design and reads as a sandbox failure.
  expect(writableRoots(scaffold.ctx.sandboxPolicy.resolve({ mode: 'workspace-write' }))).toEqual(
    expect.arrayContaining([canonicalPath('/tmp'), canonicalPath(tmpdir())]),
  )
  expect(scaffold.ctx.sandboxPolicy.defaultMode).toBe('workspace-write')
  expect(scaffold.ctx.approval.config.policy).toBe('ask')
  expect(scaffold.ctx.permissionPresets.defaultPreset).toBe('workspace-write')

  const commandHandle = await scaffold.ctx.agents.create({
    sessionId: SessionId('shipped-command-catalog'),
    meta: { cwd: scaffold.workspaceCwd },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  try {
    expect(scaffold.ctx.commands.list(commandHandle.agent)).toContainEqual({
      name: 'feedback',
      description: 'record feedback about this session',
      input: { hint: '<text>' },
    })
  } finally {
    await commandHandle.dispose()
  }
}, 120_000)

it('lets a preset producer reach the background-job registry', async () => {
  scaffold = await launchWebScaffold()
  const ctx = scaffold.ctx
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-background-job'),
    meta: { cwd: scaffold.workspaceCwd },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    const signal = new AbortController().signal
    // The platform shell tool is a preset row and `tasks` is a host registry; the producer
    // resolves it with `ctx.get`, so a registry hidden behind a preset realm
    // fails here — with every task control still listed in the catalog above.
    const started = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-shell-background'),
      name: SHELL_TOOL,
      arguments: {
        command: SHELL_COMMAND,
        description: 'shipped background probe',
        run_in_background: true,
      },
      agent: handle.agent,
    })
    expect({ isError: started.isError, content: started.content }).toEqual({
      isError: false,
      content: [{ type: 'text', text: `started background job ${SHELL_JOB_ID}` }],
    })

    // The controller reads what the producer started: same registry, one
    // owner. A per-preset registry would list nothing here even on success.
    const listed = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-task-list'),
      name: 'job_list',
      arguments: {},
      agent: handle.agent,
    })
    expect(listed.isError).toBe(false)
    expect(listed.content).toEqual([
      { type: 'text', text: expect.stringContaining(`${SHELL_JOB_ID} [${SHELL_TOOL}]`) as unknown as string },
    ])

    // The full round trip: the output a host-plane producer wrote is collected
    // through a preset-plane control, which is the linkage the realm severed.
    const collected = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-task-output'),
      name: 'job_output',
      arguments: { job_id: SHELL_JOB_ID, wait: true },
      agent: handle.agent,
    })
    expect(collected.isError).toBe(false)
    expect(collected.content).toEqual([
      { type: 'text', text: expect.stringContaining('SHIPPED_BACKGROUND_OK') as unknown as string },
    ])
  } finally {
    await handle.dispose()
  }
}, 120_000)
