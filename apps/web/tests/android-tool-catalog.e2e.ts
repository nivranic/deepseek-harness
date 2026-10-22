/** Live tool-catalog fetch (specification §32) from the current real Host through the production Kotlin client. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { launchWebScaffold } from './scaffold.ts'
import { startAndroidGatewayDriver } from './android-gateway-driver.ts'

/** One Kotlin-parsed descriptor as the driver emits it — the shared contract's six fields. */
interface ServedDescriptor {
  id: string
  version: number
  risk: string
  permissions: string[]
  supportsLite: boolean
  supportsRemote: boolean
}

it.skipIf(!process.env.DSH_ANDROID_JAVA)('the paired Kotlin client fetches the live Host catalog once and caches the parse', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
    // The shipped Web composition parks every model-facing tool behind preset
    // realms, so its global catalog serves an empty list; the sanctioned Cordis
    // insert gives the global view shipped tool ids to serve through tools/list.
    cordisTools: true,
  })
  let driver: Awaited<ReturnType<typeof startAndroidGatewayDriver>> | undefined
  let catalogFetches = 0
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    if (request.namespace === 'tools' && request.method === 'list') catalogFetches++
    return invoke(request)
  })
  try {
    driver = await startAndroidGatewayDriver(process.env.DSH_ANDROID_JAVA!)
    const { request: command } = driver
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const issuance = scaffold.ctx.deviceTrust.issuePairing('viewer')
    const payload = { kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issuance.code, expiresAt: issuance.expiresAt, role: issuance.role }
    expect((await command({ op: 'pair', payload })).type).toBe('ok')

    // The paired fetch returns the Host's current global declaration after the
    // Kotlin contract's strict parse: the same descriptors the Host catalog serves.
    const fetched = await command({ op: 'toolDescriptors' })
    expect(fetched.type).toBe('ok')
    const served = fetched.value as ServedDescriptor[]
    expect(served.length).toBeGreaterThan(0)
    expect(served).toEqual([...scaffold.ctx.tools.list().tools])
    // Every fetched id the shipped projection also carries declares identical fields.
    const shipped = JSON.parse(await readFile(
      fileURLToPath(new URL('../../../packages/core/tools/tool-descriptors.json', import.meta.url)), 'utf8'),
    ) as { tools: ServedDescriptor[] }
    const shippedById = new Map(shipped.tools.map(tool => [tool.id, tool]))
    expect(served.some(tool => shippedById.has(tool.id))).toBe(true)
    for (const tool of served) {
      const shippedTool = shippedById.get(tool.id)
      if (shippedTool !== undefined) expect(tool, tool.id).toEqual(shippedTool)
    }

    // One fetch reached the Host; the repeated op walks the client-side cache.
    expect(catalogFetches).toBe(1)
    expect((await command({ op: 'toolDescriptors' })).value).toEqual(fetched.value)
    expect(catalogFetches).toBe(1)
    expect((await command({ op: 'close' })).type).toBe('ok')
    expect(await driver.stop()).toBe(0)
  } finally {
    await driver?.kill()
    spy.mockRestore()
    await scaffold.close()
  }
}, 90_000)
