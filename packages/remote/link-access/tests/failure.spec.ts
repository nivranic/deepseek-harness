/** Public carrier failures over real TLS must not expose parser input or internal exception text. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { carrierRequest, issueSigned, mountCarrier, pairDevice, type CarrierHarness, type TestDevice } from './link-harness.ts'

let harness: CarrierHarness
let device: TestDevice

beforeAll(async () => {
  harness = await mountCarrier()
  device = await pairDevice(harness, 'failure-observer')
}, 60_000)

afterAll(async () => {
  await harness.close()
})

it('records fixed parser and internal failure responses without exception payloads', async () => {
  const responses: Array<{ name: string; status: number; json: unknown }> = []
  const malformed = 'PRIVATE_REQUEST_SENTINEL is not JSON'
  for (const [name, path] of [
    ['pairing-parser', '/link/pair'],
    ['unary-parser', '/api/session/prompt'],
    ['stream-parser', '/link/stream/probe%2Fticks'],
  ] as const) {
    const response = await issueSigned(harness.endpoint, device, path, 'POST', malformed)
    responses.push({ name, status: response.status, json: response.json })
  }
  // Trust-store I/O may fail after authentication or after parsing a pairing request.
  const identity = vi.spyOn(harness.ctx.deviceTrust, 'hostIdentity').mockRejectedValueOnce(
    new Error('PRIVATE_EXCEPTION_SENTINEL at /private/host-state.sqlite'),
  )
  try {
    const response = await issueSigned(harness.endpoint, device, '/link/describe', 'POST', '')
    responses.push({ name: 'host-identity', status: response.status, json: response.json })
  } finally {
    identity.mockRestore()
  }
  const pairing = vi.spyOn(harness.ctx.deviceTrust, 'consumePairing').mockRejectedValueOnce(
    new Error('PRIVATE_EXCEPTION_SENTINEL at /private/device-state.sqlite'),
  )
  try {
    const response = await carrierRequest(harness.endpoint, '/link/pair', {
      method: 'POST', body: JSON.stringify({ code: 'fixture-code', deviceName: 'fixture', devicePublicKey: 'bm90LWRlcg==' }),
    })
    responses.push({ name: 'pairing-store', status: response.status, json: response.json })
  } finally {
    pairing.mockRestore()
  }
  await expect(JSON.stringify(responses, null, 2) + '\n').toMatchFileSnapshot('./expected/carrier-errors.json')
})
