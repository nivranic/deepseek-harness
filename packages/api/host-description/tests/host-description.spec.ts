import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import * as HostDescription from '../src/index.ts'

const resources: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of resources.splice(0).reverse()) await dispose()
})

async function harness(transports: HostDescription.HostTransport[] = ['http', 'websocket']) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-host-description-'))
  resources.push(() => rm(directory, { recursive: true, force: true }))
  const ctx = new Context()
  resources.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGateway)
  const owner = ctx.plugin(HostDescription, { identityFile: join(directory, '.host-id'), transports })
  await owner
  return { ctx, owner }
}

class Feature extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'descriptionFixture', {
      namespace: 'fixture',
      capabilities: [{ id: 'fixture.read.v1', methods: ['read'] }],
    })
  }

  @Remote
  read(): string {
    return 'available'
  }
}

it('returns stable identity and three independently owned version fields through Remote', async () => {
  const { ctx } = await harness()
  const before = Date.now()
  const descriptor = ctx.hostDescription.describe()
  expect(descriptor.hostId).toMatch(/^[0-9a-f-]{36}$/u)
  expect(descriptor.apiProtocolVersion).toBe(1)
  expect(descriptor.sessionFormatVersion).toBe(SESSION_FORMAT_VERSION)
  expect(descriptor.productVersion).toMatch(/^\d+\.\d+\.\d+/u)
  expect(descriptor.platform).toBe(process.platform)
  expect(descriptor.arch).toBe(process.arch)
  expect(descriptor.serverTime).toBeGreaterThanOrEqual(before)
  expect(descriptor.serverTime).toBeLessThanOrEqual(Date.now())
  await expect(ctx.typertGateway.invoke({ namespace: 'host', method: 'describe', args: {} }))
    .resolves.toMatchObject({ hostId: descriptor.hostId, capabilities: ['host.describe.v1', 'host.negotiate.v1'] })
  const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-description.json', import.meta.url), 'utf8'))
  expect({ ...descriptor, hostId: '<HostId>', productVersion: '<ProductVersion>', platform: '<Platform>', arch: '<Arch>', serverTime: 0 })
    .toEqual(expected)
})

it('reflects capability owner removal without a second registry or cached flags', async () => {
  const { ctx } = await harness()
  const feature = ctx.plugin(Feature)
  await feature
  expect(ctx.hostDescription.describe().capabilities).toEqual(['fixture.read.v1', 'host.describe.v1', 'host.negotiate.v1'])
  await feature.dispose()
  expect(ctx.hostDescription.describe().capabilities).toEqual(['host.describe.v1', 'host.negotiate.v1'])
})

it('reports the Desktop carrier without claiming an HTTP listener', async () => {
  const { ctx, owner } = await harness(['desktop-pipe'])
  expect(ctx.hostDescription.describe().transports).toEqual(['desktop-pipe'])
  await owner.dispose()
  expect(ctx.get('hostDescription')).toBeUndefined()
  expect(ctx.typertGateway.capabilities()).toEqual([])
})


it('selects the highest shared protocol while retaining the legacy discovery view', async () => {
  const { ctx } = await harness()
  const legacy = ctx.hostDescription.describe()
  expect(legacy.apiProtocolVersion).toBe(1)
  expect(legacy.supportedApiProtocolVersions).toEqual([2, 1])
  for (const offers of [[1, 2], [2, 1], [99, 2]]) {
    await expect(ctx.typertGateway.invoke({ namespace: 'host', method: 'negotiate', args: { supportedApiProtocolVersions: offers } }))
      .resolves.toMatchObject({ hostId: legacy.hostId, apiProtocolVersion: 2 })
  }
  expect(ctx.hostDescription.negotiate([1]).apiProtocolVersion).toBe(1)
  expect(() => ctx.hostDescription.negotiate([99])).toThrow(expect.objectContaining({ code: 'gateway/protocol-unsupported' }))
  for (const offers of [[], [1, 1], [0], [-1], [1.5], [NaN]]) {
    expect(() => ctx.hostDescription.negotiate(offers)).toThrow(expect.objectContaining({ code: 'gateway/arguments-invalid' }))
  }
})
