/**
 * The carrier-level session slice over the shipped desktop composition: the
 * settings switch binds the real TLS carrier, a real device pairs through it,
 * and the paired device reaches the real session stack — `session/list`
 * through the shared `/api` chain, the `$events` Remote stream, and the
 * approval-answer refusal behind the independent switch, and two-controller
 * settlement through a real Host approval. The slice stays LLM-free by
 * design: prompt replay rides the snapshot harness, not this composition.
 */

import { createHash, generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { RpcId, type ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { linkSigningInput } from '@deepseek-ai/dsh-link-access/protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const DESKTOP_PATCH = join(REPO_ROOT, 'packages/bundle/desktop-app/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

/** One paired device's wire identity. */
interface PairedDevice {
  readonly deviceId: string
  readonly privateKey: KeyObject
}

/** One carrier answer. */
interface CarrierAnswer {
  readonly status: number
  readonly json: unknown
}

interface CarrierCallOptions {
  readonly headersOnly?: boolean
  readonly signal?: AbortSignal
}

/** One persistent device-bound Remote Event generation. */
interface CarrierEventStream {
  readonly clientId: string
  readonly frames: Array<Readonly<Record<string, unknown>>>
  close(): Promise<void>
}

/** One delivered Host approval request. */
interface ApprovalFrame extends Readonly<Record<string, unknown>> {
  readonly type: 'waterfall'
  readonly event: 'approval/request'
  readonly eventId: string
  readonly agentId: string
  readonly request: Readonly<Record<string, unknown>>
}

interface EnvironmentSnapshot {
  readonly present: boolean
  readonly value: string | undefined
}

type ControllerName = 'A' | 'B'

type GatewayDispatch = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<ConnectionRpcResult<unknown>>

interface GatewayDispatchHost {
  dispatchRpc: GatewayDispatch
}

interface InteractionDispatchBarrier {
  readonly arrivals: ReadonlySet<ControllerName>
  release(controller: ControllerName): void
  releaseAll(): void
  waitForQuiescence(): Promise<void>
  restore(): void
}

async function bootComposition(home: string): Promise<Context> {
  const settingsFile = join(home, 'settings.yaml')
  const patches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', DESKTOP_PATCH),
    { id: 'settings', config: { path: settingsFile, watch: false } },
    { id: 'credentials', config: { path: join(home, '.credentials.yaml'), watch: false } },
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    // The link rows pin their durable state into this test's home, never the
    // developer's own $DSH_HOME.
    { id: 'device-trust', config: { path: join(home, 'device-trust.sqlite') } },
    {
      id: 'link-access',
      config: {
        dshHome: home,
        host: '127.0.0.1',
        port: 0,
        pairingAccess: { sessions: ['session-visible'], workspaces: [] },
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
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  return await boot('dsh-test', join(profileDir, 'cordis.yml'), patches, (bootCtx) => {
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

/** One (unsigned or signed) carrier request, resolved to status and JSON. */
function carrierCall(
  endpoint: string,
  path: string,
  body: string,
  device?: PairedDevice,
  options: CarrierCallOptions = {},
): Promise<CarrierAnswer> {
  const url = new URL(endpoint)
  const headers: Record<string, string> = body === ''
    ? {}
    : { 'content-type': 'application/json' }
  if (device !== undefined) {
    const timestamp = String(Date.now())
    const digest = createHash('sha256').update(body).digest('hex')
    const signature = edSign(
      null,
      Buffer.from(linkSigningInput(timestamp, 'POST', path, digest)),
      device.privateKey,
    ).toString('base64')
    headers['x-dsh-device-id'] = device.deviceId
    headers['x-dsh-timestamp'] = timestamp
    headers['x-dsh-signature'] = signature
  }
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      host: url.hostname,
      port: url.port,
      path,
      method: 'POST',
      rejectUnauthorized: false,
      headers,
      ...options.signal === undefined ? {} : { signal: options.signal },
    }, (response) => {
      if (options.headersOnly === true) {
        // A Remote stream never ends on its own; the slice only proves it opens.
        const status = response.statusCode ?? 0
        response.destroy()
        resolve({ status, json: undefined })
        return
      }
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try {
          resolve({ status: response.statusCode ?? 0, json: JSON.parse(text) as unknown })
        } catch {
          resolve({ status: response.statusCode ?? 0, json: undefined })
        }
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    if (body !== '') request.write(body)
    request.end()
  })
}

/** Pair one controller through the live TLS pairing ingress. */
async function pairController(
  endpoint: string,
  link: { createPairing(): Promise<{ readonly code: string }> },
  deviceName: string,
): Promise<PairedDevice> {
  const pairing = await link.createPairing()
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const paired = await carrierCall(endpoint, '/link/pair', JSON.stringify({
    code: pairing.code,
    deviceName,
    devicePublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  }))
  if (paired.status !== 200 || !isRecord(paired.json)
    || typeof paired.json.deviceId !== 'string' || paired.json.role !== 'controller') {
    throw new Error(`${deviceName} did not pair as a controller`)
  }
  return { deviceId: paired.json.deviceId, privateKey }
}

/** Register one observer in the shipped trust store under the same scoped pairing grant. */
async function pairObserver(
  root: Context,
  link: { createPairing(): Promise<{ readonly code: string }> },
  deviceName: string,
): Promise<PairedDevice> {
  const pairing = await link.createPairing()
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const trust = root.get('deviceTrust') as {
    consumePairing(
      code: string,
      device: { readonly name: string; readonly publicKeySpki: string },
      role: 'observer',
      access: { readonly sessions: readonly string[]; readonly workspaces: readonly string[] },
    ): Promise<{ readonly deviceId: string; readonly role: 'observer' }>
  }
  const paired = await trust.consumePairing(
    pairing.code,
    {
      name: deviceName,
      publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    },
    'observer',
    { sessions: ['session-visible'], workspaces: [] },
  )
  if (paired.role !== 'observer') throw new Error(`${deviceName} did not pair as an observer`)
  return { deviceId: paired.deviceId, privateKey }
}

/** Open the device's persistent `$events` stream and retain decoded value frames. */
function openCarrierEventStream(endpoint: string, device: PairedDevice): Promise<CarrierEventStream> {
  const path = '/link/stream/%24events'
  const body = JSON.stringify({ args: {} })
  const timestamp = String(Date.now())
  const digest = createHash('sha256').update(body).digest('hex')
  const signature = edSign(
    null,
    Buffer.from(linkSigningInput(timestamp, 'POST', path, digest)),
    device.privateKey,
  ).toString('base64')
  const url = new URL(endpoint)
  return new Promise((resolve, reject) => {
    const frames: Array<Readonly<Record<string, unknown>>> = []
    const closed = Promise.withResolvers<undefined>()
    let buffer = ''
    let openingSettled = false
    let closing = false
    let terminalError: unknown
    let closePromise: Promise<void> | undefined
    const fail = (error: unknown): void => {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (!closing && terminalError === undefined) terminalError = failure
      if (openingSettled) return
      openingSettled = true
      reject(failure)
    }
    const request = httpsRequest({
      host: url.hostname,
      port: url.port,
      path,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'x-dsh-device-id': device.deviceId,
        'x-dsh-timestamp': timestamp,
        'x-dsh-signature': signature,
        'content-type': 'application/json',
      },
    }, (response) => {
      if (response.statusCode !== 200) {
        fail(new Error(`Remote Event stream returned HTTP ${String(response.statusCode ?? 0)}`))
        response.resume()
        return
      }
      response.on('data', (chunk: Buffer) => {
        try {
          buffer += chunk.toString('utf8')
          let newline = buffer.indexOf('\n')
          while (newline >= 0) {
            const line = buffer.slice(0, newline)
            buffer = buffer.slice(newline + 1)
            newline = buffer.indexOf('\n')
            if (line === '') continue
            const envelope = JSON.parse(line) as unknown
            if (!isRecord(envelope) || envelope.k !== 'v' || !isRecord(envelope.v)) {
              throw new Error('Remote Event stream emitted an invalid NDJSON value frame')
            }
            const frame = envelope.v
            frames.push(frame)
            if (!openingSettled) {
              if (frame.type !== 'ready' || typeof frame.clientId !== 'string') {
                throw new Error('Remote Event stream did not begin with a ready frame')
              }
              openingSettled = true
              resolve({
                clientId: frame.clientId,
                frames,
                close: async () => {
                  closePromise ??= (async () => {
                    closing = true
                    response.destroy()
                    request.destroy()
                    await closed.promise
                    if (terminalError !== undefined) throw terminalError
                  })()
                  await closePromise
                },
              })
            }
          }
        } catch (error) {
          fail(error)
          request.destroy()
        }
      })
      response.on('end', () => {
        if (!closing) fail(new Error('Remote Event stream ended unexpectedly'))
        closed.resolve(undefined)
      })
      response.on('error', (error) => {
        fail(error)
        closed.resolve(undefined)
      })
      response.on('close', () => {
        if (!closing) fail(new Error('Remote Event stream closed unexpectedly'))
        closed.resolve(undefined)
      })
    })
    request.on('error', (error) => {
      fail(error)
      closed.resolve(undefined)
    })
    request.write(body)
    request.end()
  })
}

/** The gateway Remote wire body for one unary call. */
function wireBody(method: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'client-request',
    rpcId: RpcId(`link-${method}`),
    method,
    payload: { args },
  })
}

let ctx: Context | undefined
let home: string | undefined
let dshHomeSnapshot: EnvironmentSnapshot | undefined

beforeAll(async () => {
  dshHomeSnapshot = {
    present: Object.hasOwn(process.env, 'DSH_HOME'),
    value: process.env.DSH_HOME,
  }
  try {
    home = await mkdtemp(join(tmpdir(), 'dsh-link-slice-'))
    process.env.DSH_HOME = home
    await writeFile(join(home, 'settings.yaml'), '{}\n')
    const booted = await bootComposition(home)
    ctx = booted
    await booted.sessionController.create({ sessionId: SessionId('session-visible'), cwd: home })
    await booted.sessionController.create({ sessionId: SessionId('session-hidden'), cwd: home })
  } catch (error) {
    const failures: unknown[] = [error]
    try {
      failures.push(...await cleanupSuiteResources())
    } finally {
      restoreDshHome()
    }
    if (failures.length === 1) throw error
    throw new AggregateError(failures, 'link-session-slice setup and cleanup failed')
  }
}, 120_000)

afterAll(async () => {
  const failures: unknown[] = []
  try {
    failures.push(...await cleanupSuiteResources())
  } finally {
    restoreDshHome()
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'link-session-slice teardown failed')
  }
})

describe('the carrier-level session slice', () => {
  it('flips the switch, pairs, reaches the session stack, and gates approvals', async () => {
    const root = requireComposition()
    const link = root.get('linkAccess')!
    await expect(link.endpoint()).resolves.toBeUndefined()

    // The settings switch binds the real carrier through the live bridge.
    const remote = settingsNamespace('remote')
    await root.settings.update(remote, {
      enabled: true,
      allowRemoteApproval: false,
      deviceName: 'Slice Host',
    })
    await viWaitFor(async () => {
      if (await link.endpoint() === undefined) throw new Error('carrier not bound yet')
    })
    const endpoint = await link.endpoint() as string

    // Pair a real device through the pairing ingress.
    const device = await pairController(endpoint, link, 'Slice Phone')

    // The real SessionController answers through the carrier's /api chain.
    const sessions = await carrierCall(endpoint, '/api/session/list', wireBody('session/list', { _request: {} }), device)
    expect(sessions.status).toBe(200)
    expect((sessions.json as { result: { ok: boolean } }).result.ok).toBe(true)
    expect(JSON.stringify(sessions.json)).toContain('session-visible')
    expect(JSON.stringify(sessions.json)).not.toContain('session-hidden')

    const hiddenSession = await carrierCall(
      endpoint,
      '/api/session/prompt',
      wireBody('session/prompt', { request: { sessionId: 'session-hidden' } }),
      device,
    )
    expect(hiddenSession.status).toBe(403)
    expect(hiddenSession.json).toMatchObject({ error: 'forbidden', reason: 'session-scope' })

    const hiddenResource = await carrierCall(
      endpoint,
      '/api/session/attachment',
      wireBody('session/attachment', {
        request: { sessionId: 'session-hidden', attachmentId: 'attachment-secret' },
      }),
      device,
    )
    expect(hiddenResource.status).toBe(403)
    expect(hiddenResource.json).toMatchObject({ error: 'forbidden', reason: 'resource-scope' })

    const hiddenPath = await carrierCall(
      endpoint,
      '/api/workspaceFiles/read',
      wireBody('workspaceFiles/read', { workspaceId: 'workspace-hidden', path: '../secret' }),
      device,
    )
    expect(hiddenPath.status).toBe(403)
    expect(hiddenPath.json).toMatchObject({ error: 'forbidden', reason: 'path-scope' })

    // The real Remote stream plane opens over NDJSON.
    const events = await carrierCall(endpoint, '/link/stream/$events', JSON.stringify({ args: {} }), device, { headersOnly: true })
    expect(events.status).toBe(200)

    // The independent approval switch refuses the interaction answer before
    // dispatch, exactly as the plan's "can prompt never means can approve" rule.
    const answer = await carrierCall(
      endpoint,
      '/api/$events/result',
      wireBody('$events/result', { clientId: 'none', eventId: 'none', outcome: { kind: 'next' } }),
      device,
    )
    expect(answer.status).toBe(403)
    expect(answer.json).toMatchObject({ error: 'forbidden', reason: 'approval-disabled' })

    // Flipping the switch back unbinds the carrier.
    await root.settings.update(remote, {
      enabled: false,
      allowRemoteApproval: false,
      deviceName: 'Slice Host',
    })
    await viWaitFor(async () => {
      if (await link.endpoint() !== undefined) throw new Error('carrier still bound')
    })
  }, 60_000)

  it('settles two controller orders once and refuses the observer and losing controller', async () => {
    const root = requireComposition()
    const link = root.get('linkAccess')!
    const remote = settingsNamespace('remote')
    const streams: CarrierEventStream[] = []
    let failure: unknown
    try {
      await root.settings.update(remote, {
        enabled: true,
        allowRemoteApproval: true,
        deviceName: 'Multi-device Host',
      })
      await viWaitFor(async () => {
        if (await link.endpoint() === undefined || !link.isRemoteApprovalAllowed()) {
          throw new Error('remote approval carrier not ready')
        }
      })
      const endpoint = await link.endpoint() as string
      const observer = await pairObserver(root, link, 'Observer')
      const controllerA = await pairController(endpoint, link, 'Controller A')
      const controllerB = await pairController(endpoint, link, 'Controller B')
      const observerStream = await openCarrierEventStream(endpoint, observer)
      streams.push(observerStream)
      const controllerAStream = await openCarrierEventStream(endpoint, controllerA)
      streams.push(controllerAStream)
      const controllerBStream = await openCarrierEventStream(endpoint, controllerB)
      streams.push(controllerBStream)
      const agent = root.agents.get(SessionId('session-visible'))
      if (agent === undefined) throw new Error('visible Session has no live Agent')

      await exerciseApprovalWinner(root, endpoint, agent, {
        observer: { device: observer, stream: observerStream },
        A: { device: controllerA, stream: controllerAStream },
        B: { device: controllerB, stream: controllerBStream },
      }, 'A', 1)
      await exerciseApprovalWinner(root, endpoint, agent, {
        observer: { device: observer, stream: observerStream },
        A: { device: controllerA, stream: controllerAStream },
        B: { device: controllerB, stream: controllerBStream },
      }, 'B', 2)
    } catch (error) {
      failure = error
    }

    const failures: unknown[] = failure === undefined ? [] : [failure]
    for (const stream of streams.reverse()) {
      try {
        await stream.close()
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await root.settings.update(remote, {
        enabled: false,
        allowRemoteApproval: false,
        deviceName: 'Multi-device Host',
      })
      await viWaitFor(async () => {
        if (await link.endpoint() !== undefined) throw new Error('carrier still bound')
      })
    } catch (error) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'multi-device acceptance and cleanup failed')
  }, 60_000)

  it('keeps a closing dispatch barrier open for later, pre-aborted, and waiting-aborted arrivals', async () => {
    const clientIds: Readonly<Record<ControllerName, string>> = {
      A: 'barrier-client-a',
      B: 'barrier-client-b',
    }
    const payload = (controller: ControllerName): unknown => ({ args: {
      clientId: clientIds[controller],
      eventId: 'barrier-event',
      outcome: { kind: 'result', value: 'allowed-once' },
    } })

    const dispatched: ControllerName[] = []
    const originalDispatch: GatewayDispatch = async (_endpoint, request) => {
      dispatched.push(controllerFromGatewayPayload(request, clientIds))
      return { ok: true, value: undefined }
    }
    const gateway: GatewayDispatchHost = { dispatchRpc: originalDispatch }
    const barrier = installInteractionDispatchBarrier(gateway, clientIds)
    const requests: Array<Promise<ConnectionRpcResult<unknown>>> = []
    try {
      const first = gateway.dispatchRpc('$events/result', payload('A'), new AbortController().signal)
      requests.push(first)
      expect(barrier.arrivals).toEqual(new Set<ControllerName>(['A']))
      barrier.releaseAll()
      await first

      const lateAbort = new AbortController()
      lateAbort.abort(new Error('cleanup already started'))
      const late = gateway.dispatchRpc('$events/result', payload('B'), lateAbort.signal)
      requests.push(late)
      await Promise.resolve()
      expect(dispatched).toEqual(['A', 'B'])
      await late
      barrier.restore()
      await barrier.waitForQuiescence()
      expect(barrier.arrivals).toEqual(new Set<ControllerName>(['A', 'B']))
    } finally {
      barrier.releaseAll()
      barrier.restore()
      await Promise.allSettled(requests)
      await barrier.waitForQuiescence()
    }
    expect(gateway.dispatchRpc).toBe(originalDispatch)

    const abortedDispatches: ControllerName[] = []
    const abortedOriginal: GatewayDispatch = async (_endpoint, request) => {
      abortedDispatches.push(controllerFromGatewayPayload(request, clientIds))
      return { ok: true, value: undefined }
    }
    const abortedGateway: GatewayDispatchHost = { dispatchRpc: abortedOriginal }
    const abortedBarrier = installInteractionDispatchBarrier(abortedGateway, clientIds)
    try {
      const abort = new AbortController()
      abort.abort(new Error('request already aborted'))
      const request = abortedGateway.dispatchRpc('$events/result', payload('A'), abort.signal)
      await Promise.resolve()
      expect(abortedDispatches).toEqual(['A'])
      await request
      abortedBarrier.restore()
      await abortedBarrier.waitForQuiescence()
    } finally {
      abortedBarrier.releaseAll()
      abortedBarrier.restore()
      await abortedBarrier.waitForQuiescence()
    }
    expect(abortedGateway.dispatchRpc).toBe(abortedOriginal)

    const waitingDispatches: ControllerName[] = []
    const waitingOriginal: GatewayDispatch = async (_endpoint, request) => {
      waitingDispatches.push(controllerFromGatewayPayload(request, clientIds))
      return { ok: true, value: undefined }
    }
    const waitingGateway: GatewayDispatchHost = { dispatchRpc: waitingOriginal }
    const waitingBarrier = installInteractionDispatchBarrier(waitingGateway, clientIds)
    const waitingAbort = new AbortController()
    const waitingRequest = waitingGateway.dispatchRpc('$events/result', payload('A'), waitingAbort.signal)
    try {
      expect(waitingBarrier.arrivals).toEqual(new Set<ControllerName>(['A']))
      expect(waitingDispatches).toEqual([])
      waitingAbort.abort(new Error('request aborted while waiting'))
      await Promise.resolve()
      expect(waitingDispatches).toEqual(['A'])
      await waitingRequest
      waitingBarrier.restore()
      await waitingBarrier.waitForQuiescence()
    } finally {
      waitingBarrier.releaseAll()
      waitingBarrier.restore()
      await Promise.allSettled([waitingRequest])
      await waitingBarrier.waitForQuiescence()
    }
    expect(waitingGateway.dispatchRpc).toBe(waitingOriginal)
  })
})

/** Run one controlled first-valid-answer order over the live Host interaction. */
async function exerciseApprovalWinner(
  root: Context,
  endpoint: string,
  agent: Agent,
  participants: {
    readonly observer: { readonly device: PairedDevice; readonly stream: CarrierEventStream }
    readonly A: { readonly device: PairedDevice; readonly stream: CarrierEventStream }
    readonly B: { readonly device: PairedDevice; readonly stream: CarrierEventStream }
  },
  winner: ControllerName,
  turn: number,
): Promise<void> {
  const loser: ControllerName = winner === 'A' ? 'B' : 'A'
  const outcomes: Record<ControllerName, ApprovalOutcome> = {
    A: 'allowed-once',
    B: 'rejected',
  }
  const toolName = `g1-multi-controller-${winner.toLowerCase()}-wins`
  const before = agent.session.events.length
  const interactionAbort = new AbortController()
  agent.session.append('turn/start', { turn })
  const hostOutcome = root.approval.request({
    agent,
    toolName,
    reason: `deterministic Controller ${winner} winner`,
    signal: interactionAbort.signal,
  })
  let dispatchBarrier: InteractionDispatchBarrier | undefined
  const answerAborts: AbortController[] = []
  const answerRequests: Promise<CarrierAnswer>[] = []
  let primaryFailure: unknown
  try {
    const [frameA, frameB] = await Promise.all([
      waitForApprovalFrame(participants.A.stream, toolName),
      waitForApprovalFrame(participants.B.stream, toolName),
    ])
    expect(frameA.eventId).toBe(frameB.eventId)
    expect(frameA.agentId).toBe('session-visible')
    expect(frameB.agentId).toBe('session-visible')
    const eventId = frameA.eventId
    const gateway = root.get('typertGateway') as unknown as GatewayDispatchHost & {
      readonly wireStream: {
        isRemoteEventDeliveryPending(clientId: string, eventId: string): boolean
      }
    }
    expect(gateway.wireStream.isRemoteEventDeliveryPending(participants.A.stream.clientId, eventId)).toBe(true)
    expect(gateway.wireStream.isRemoteEventDeliveryPending(participants.B.stream.clientId, eventId)).toBe(true)
    expect(gateway.wireStream.isRemoteEventDeliveryPending(participants.observer.stream.clientId, eventId)).toBe(false)
    expect(participants.observer.stream.frames.some(frame => isApprovalFrame(frame, toolName))).toBe(false)

    const observerAttempt = await answerApproval(
      endpoint,
      participants.observer.device,
      participants.A.stream.clientId,
      eventId,
      'allowed-once',
    )
    expect(observerAttempt.status).toBe(403)
    expect(observerAttempt.json).toMatchObject({ error: 'forbidden', reason: 'role' })

    dispatchBarrier = installInteractionDispatchBarrier(gateway, {
      A: participants.A.stream.clientId,
      B: participants.B.stream.clientId,
    })
    const aborts = {
      A: new AbortController(),
      B: new AbortController(),
    }
    answerAborts.push(aborts.A, aborts.B)
    const submissions = {
      A: answerApproval(
        endpoint,
        participants.A.device,
        participants.A.stream.clientId,
        eventId,
        outcomes.A,
        aborts.A.signal,
      ),
      B: answerApproval(
        endpoint,
        participants.B.device,
        participants.B.stream.clientId,
        eventId,
        outcomes.B,
        aborts.B.signal,
      ),
    }
    answerRequests.push(submissions.A, submissions.B)
    // Link records each generation claim before calling the shared `/api`
    // handler, so reaching this Host barrier proves both answers were admitted.
    await viWaitFor(async () => {
      if (dispatchBarrier?.arrivals.size !== 2) {
        throw new Error('both controller answers have not reached the Host dispatch barrier')
      }
    })
    expect(dispatchBarrier.arrivals).toEqual(new Set<ControllerName>(['A', 'B']))
    expect(gateway.wireStream.isRemoteEventDeliveryPending(participants.A.stream.clientId, eventId)).toBe(true)
    expect(gateway.wireStream.isRemoteEventDeliveryPending(participants.B.stream.clientId, eventId)).toBe(true)

    dispatchBarrier.release(winner)
    const winningResponse = await submissions[winner]
    assertVoidSuccess(winningResponse, `Controller ${winner}`)
    await expect(hostOutcome).resolves.toBe(outcomes[winner])
    await viWaitFor(async () => {
      const cancellations = participants[loser].stream.frames.filter(
        frame => frame.type === 'cancel' && frame.eventId === eventId,
      )
      if (cancellations.length !== 1) {
        throw new Error(`Controller ${loser} received ${String(cancellations.length)} cancellations instead of one`)
      }
    })

    dispatchBarrier.release(loser)
    const losingResponse = await submissions[loser]
    assertVoidSuccess(losingResponse, `Controller ${loser}`)
    dispatchBarrier.restore()
    await dispatchBarrier.waitForQuiescence()
    dispatchBarrier = undefined

    const lateResponse = await answerApproval(
      endpoint,
      participants[loser].device,
      participants[loser].stream.clientId,
      eventId,
      outcomes[loser],
    )
    expect(lateResponse.status).toBe(403)
    expect(lateResponse.json).toMatchObject({ error: 'forbidden', reason: 'interaction' })
    expect(gateway.wireStream.isRemoteEventDeliveryPending(participants.A.stream.clientId, eventId)).toBe(false)
    expect(gateway.wireStream.isRemoteEventDeliveryPending(participants.B.stream.clientId, eventId)).toBe(false)
    expect(participants[loser].stream.frames.filter(
      frame => frame.type === 'cancel' && frame.eventId === eventId,
    )).toHaveLength(1)

    await Promise.resolve()
    const audit = agent.session.events.slice(before).filter(
      event => event.type === 'approval/asked' || event.type === 'approval/decided',
    )
    expect(audit).toHaveLength(2)
    expect(audit[0]).toMatchObject({ type: 'approval/asked', data: { toolName } })
    expect(audit[1]).toMatchObject({
      type: 'approval/decided',
      data: { id: audit[0]?.data.id, outcome: outcomes[winner] },
    })
  } catch (error) {
    primaryFailure = error
  }

  const cleanupFailures: unknown[] = []
  if (primaryFailure !== undefined) {
    dispatchBarrier?.releaseAll()
    try {
      dispatchBarrier?.restore()
    } catch (error) {
      cleanupFailures.push(error)
    }
    interactionAbort.abort(primaryFailure)
    for (const abort of answerAborts) abort.abort(primaryFailure)
    await Promise.allSettled(answerRequests)
    await hostOutcome.catch(() => undefined)
  }
  if (dispatchBarrier !== undefined) {
    try {
      dispatchBarrier.restore()
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      await dispatchBarrier.waitForQuiescence()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  try {
    agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
  } catch (error) {
    cleanupFailures.push(error)
  }
  if (primaryFailure !== undefined && cleanupFailures.length === 0) throw primaryFailure
  if (primaryFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      `Controller ${winner} winner round and cleanup failed`,
    )
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0]
  if (cleanupFailures.length > 1) {
    throw new AggregateError(cleanupFailures, `Controller ${winner} winner cleanup failed`)
  }
}

/** Hold admitted interaction answers at the Host immediately before Gateway settlement. */
function installInteractionDispatchBarrier(
  gateway: GatewayDispatchHost,
  clientIds: Readonly<Record<ControllerName, string>>,
): InteractionDispatchBarrier {
  const originalDispatch = gateway.dispatchRpc.bind(gateway)
  const releases = new Map<ControllerName, PromiseWithResolvers<undefined>>()
  let activeDispatches = 0
  let passThrough = false
  let restored = false
  const dispatchSpy = vi.spyOn(gateway, 'dispatchRpc').mockImplementation(async (
    endpoint,
    payload,
    signal,
  ) => {
    if (endpoint !== '$events/result') return await originalDispatch(endpoint, payload, signal)
    const controller = controllerFromGatewayPayload(payload, clientIds)
    if (releases.has(controller)) {
      throw new Error(`Controller ${controller} reached the interaction dispatch barrier twice`)
    }
    const release = Promise.withResolvers<undefined>()
    releases.set(controller, release)
    activeDispatches += 1
    try {
      if (!passThrough && !signal.aborted) {
        const stopWaiting = (): void => { release.resolve(undefined) }
        signal.addEventListener('abort', stopWaiting, { once: true })
        try {
          await release.promise
        } finally {
          signal.removeEventListener('abort', stopWaiting)
        }
      }
      return await originalDispatch(endpoint, payload, signal)
    } finally {
      activeDispatches -= 1
    }
  })

  return {
    get arrivals() {
      return new Set(releases.keys())
    },
    release: (controller) => {
      const release = releases.get(controller)
      if (release === undefined) {
        throw new Error(`Controller ${controller} has not reached the interaction dispatch barrier`)
      }
      release.resolve(undefined)
    },
    releaseAll: () => {
      passThrough = true
      for (const release of releases.values()) release.resolve(undefined)
    },
    waitForQuiescence: async () => {
      await viWaitFor(async () => {
        if (activeDispatches !== 0) {
          throw new Error(`${String(activeDispatches)} interaction dispatches remain active`)
        }
      })
    },
    restore: () => {
      if (restored) return
      dispatchSpy.mockRestore()
      restored = true
    },
  }
}

function controllerFromGatewayPayload(
  payload: unknown,
  clientIds: Readonly<Record<ControllerName, string>>,
): ControllerName {
  const envelope = requireRecord(payload, 'Gateway interaction payload')
  const args = requireRecord(envelope.args, 'Gateway interaction arguments')
  if (args.clientId === clientIds.A) return 'A'
  if (args.clientId === clientIds.B) return 'B'
  throw new Error('Gateway interaction payload carried an unknown Client generation')
}

function assertVoidSuccess(response: CarrierAnswer, name: string): void {
  expect(response.status, `${name} response status`).toBe(200)
  const envelope = requireRecord(response.json, `${name} response`)
  const result = requireRecord(envelope.result, `${name} result`)
  expect(result).toEqual({ ok: true })
  expect(result).not.toHaveProperty('value')
}

/** Submit one controller-shaped result over the device-authenticated unary route. */
function answerApproval(
  endpoint: string,
  device: PairedDevice,
  clientId: string,
  eventId: string,
  outcome: ApprovalOutcome,
  signal?: AbortSignal,
): Promise<CarrierAnswer> {
  return carrierCall(
    endpoint,
    '/api/$events/result',
    wireBody('$events/result', {
      clientId,
      eventId,
      outcome: { kind: 'result', value: outcome },
    }),
    device,
    signal === undefined ? {} : { signal },
  )
}

/** Wait for one named approval frame without racing network scheduling. */
async function waitForApprovalFrame(stream: CarrierEventStream, toolName: string): Promise<ApprovalFrame> {
  let selected: ApprovalFrame | undefined
  await viWaitFor(async () => {
    selected = stream.frames.find(frame => isApprovalFrame(frame, toolName))
    if (selected === undefined) throw new Error(`${toolName} was not delivered`)
  })
  return selected as ApprovalFrame
}

function isApprovalFrame(frame: Readonly<Record<string, unknown>>, toolName: string): frame is ApprovalFrame {
  return frame.type === 'waterfall'
    && frame.event === 'approval/request'
    && typeof frame.eventId === 'string'
    && typeof frame.agentId === 'string'
    && isRecord(frame.request)
    && frame.request.toolName === toolName
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`)
  return value
}

function requireComposition(): Context {
  if (ctx === undefined) throw new Error('link-session-slice composition is not available')
  return ctx
}

/** Dispose the composition before deleting its isolated Harness home. */
async function cleanupSuiteResources(): Promise<unknown[]> {
  const failures: unknown[] = []
  const current = ctx
  ctx = undefined
  if (current !== undefined) {
    try {
      await current.fiber.dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  const currentHome = home
  home = undefined
  if (currentHome !== undefined) {
    try {
      await rm(currentHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}

function restoreDshHome(): void {
  const snapshot = dshHomeSnapshot
  if (snapshot === undefined) return
  dshHomeSnapshot = undefined
  if (snapshot.present && snapshot.value !== undefined) {
    process.env.DSH_HOME = snapshot.value
  } else {
    delete process.env.DSH_HOME
  }
}

/** Poll an async condition with the suite's clock budget. */
async function viWaitFor(condition: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await condition()
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  await condition()
}
