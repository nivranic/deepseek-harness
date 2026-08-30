/**
 * The carrier-level session slice over the shipped desktop composition: the
 * settings switch binds the real TLS carrier, a real device pairs through it,
 * and the paired device reaches the real session stack — `session/list`
 * through the shared `/api` chain, the `$events` Remote stream, and the
 * approval-answer refusal behind the independent switch. This is the
 * acceptance core of the cross-device plan's remote slice, LLM-free by
 * design: prompt replay rides the snapshot harness, not this composition.
 */

import { createHash, generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { RpcId } from '@deepseek-ai/dsh-client-connection'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { linkSigningInput } from '@deepseek-ai/dsh-link-access/protocol'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

async function bootComposition(home: string): Promise<Context> {
  const settingsFile = join(home, 'settings.yaml')
  const patches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', DESKTOP_PATCH),
    { id: 'settings', config: { path: settingsFile, watch: false } },
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
    { id: 'link-access', config: { dshHome: home, host: '127.0.0.1', port: 0 } },
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
/** One (unsigned or signed) carrier request, resolved to status and JSON. */
function carrierCall(
  endpoint: string,
  path: string,
  body: string,
  device?: PairedDevice,
  options: { readonly headersOnly?: boolean } = {},
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

/** The gateway Remote wire body for one unary call. */
function wireBody(method: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'client-request',
    rpcId: RpcId(`link-${method}`),
    method,
    payload: { args },
  })
}

let ctx: Context
let home: string

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-link-slice-'))
  await writeFile(join(home, 'settings.yaml'), '{}\n')
  ctx = await bootComposition(home)
}, 120_000)

afterAll(async () => {
  if (ctx !== undefined) await ctx.fiber.dispose()
})

describe('the carrier-level session slice', () => {
  it('flips the switch, pairs, reaches the session stack, and gates approvals', async () => {
    const link = ctx.get('linkAccess')!
    await expect(link.endpoint()).resolves.toBeUndefined()

    // The settings switch binds the real carrier through the live bridge.
    const remote = settingsNamespace('remote')
    await ctx.settings.update(remote, { enabled: true, deviceName: 'Slice Host' })
    await viWaitFor(async () => {
      if (await link.endpoint() === undefined) throw new Error('carrier not bound yet')
    })
    const endpoint = await link.endpoint() as string

    // Pair a real device through the pairing ingress.
    const pairing = await link.createPairing()
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const paired = await carrierCall(endpoint, '/link/pair', JSON.stringify({
      code: pairing.code,
      deviceName: 'Slice Phone',
      devicePublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    }))
    expect(paired.status).toBe(200)
    const device: PairedDevice = {
      deviceId: (paired.json as { deviceId: string }).deviceId,
      privateKey,
    }

    // The real SessionController answers through the carrier's /api chain.
    const sessions = await carrierCall(endpoint, '/api/session/list', wireBody('session/list', { _request: {} }), device)
    expect(sessions.status).toBe(200)
    expect((sessions.json as { result: { ok: boolean } }).result.ok).toBe(true)

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
    await ctx.settings.update(remote, { enabled: false })
    await viWaitFor(async () => {
      if (await link.endpoint() !== undefined) throw new Error('carrier still bound')
    })
  }, 60_000)
})

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
