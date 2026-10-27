import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  Config,
  SESSION_LOG_FILENAME,
  SESSION_LOG_EXPORT_PATH,
  apply,
  inject,
} from '../src/index.ts'
import { SESSION_LOG_ZIP_MTIME } from '../src/archive.ts'

const sid = (value: string): SessionId => value as SessionId

function readHandle(id: string): SessionHandle {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sid(id),
    createdAt: 1,
    isSeeded: false,
    cwd: '/workspace',
    delegationDepth: 0,
  }
  return {
    id: header.id,
    header,
    access: 'read',
    read: async () => ({ eventState: 'detached', events: [] }),
    close: async () => {},
  } as unknown as SessionHandle
}

async function mounted(
  withServices: boolean,
  traceSession?: () => Promise<{ readonly descendants: readonly unknown[] }>,
): Promise<{
  readonly connection: HostConnectionService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  ctx.provide('commands', { register: () => () => {} } as never)
  if (withServices) {
    ctx.provide('sessionQuery', {
      traceSession: traceSession ?? (async () => ({ descendants: [] })),
    } as never)
    ctx.provide('sessionPersistence', {
      stat: async (id: SessionId) => ({ header: readHandle(String(id)).header }),
      open: async (id: SessionId) => readHandle(String(id)),
    } as never)
    ctx.provide('attachments', {
      readImage: async () => { throw new Error('fixture has no images') },
    } as never)
  }
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber
  return { connection, dispose: () => fiber.dispose() }
}

describe('Session log export Fetch route', () => {
  it('registers one GET/HEAD route and removes it with the plugin fiber', async () => {
    const { connection, dispose } = await mounted(true)
    const shared = connection.createSharedFetchHandler('/api')

    const response = await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`,
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
    expect(strFromU8(files[SESSION_LOG_FILENAME] as Uint8Array)).toContain('"id":"session-1"')

    const head = await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`, { method: 'HEAD' },
    ))
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()

    await dispose()
    expect((await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`,
    ))).status).toBe(404)
  })

  it('serves a deterministic archive with exact length headers', async () => {
    const { connection, dispose } = await mounted(true)
    const shared = connection.createSharedFetchHandler('/api')
    const url = `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`

    const first = await shared.fetch(new Request(url))
    expect(first.status).toBe(200)
    expect(first.headers.get('accept-ranges')).toBe('bytes')
    // A plain download streams one generation and carries no Content-Length.
    expect(first.headers.get('content-length')).toBeNull()
    const full = new Uint8Array(await first.arrayBuffer())

    const second = new Uint8Array(await (await shared.fetch(new Request(url))).arrayBuffer())
    expect(second).toEqual(full)

    // The DOS date/time fields of the first local file header carry the fixed
    // entry mtime, expected here through fflate's own local-time encoding.
    const stamp = new Date(SESSION_LOG_ZIP_MTIME)
    const dosTime = (stamp.getHours() << 11) | (stamp.getMinutes() << 5) | Math.floor(stamp.getSeconds() / 2)
    const dosDate = ((stamp.getFullYear() - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate()
    expect(full.subarray(10, 14)).toEqual(new Uint8Array([
      dosTime & 0xff, dosTime >> 8, dosDate & 0xff, dosDate >> 8,
    ]))

    const head = await shared.fetch(new Request(url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    expect(head.headers.get('content-length')).toBe(String(full.byteLength))
    expect(head.headers.get('accept-ranges')).toBe('bytes')

    await dispose()
  })

  it('answers satisfiable byte ranges with 206 partial bodies', async () => {
    const { connection, dispose } = await mounted(true)
    const shared = connection.createSharedFetchHandler('/api')
    const url = `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`
    const full = new Uint8Array(await (await shared.fetch(new Request(url))).arrayBuffer())

    const fromFifth = await shared.fetch(new Request(url, { headers: { range: 'bytes=5-' } }))
    expect(fromFifth.status).toBe(206)
    expect(fromFifth.headers.get('content-range')).toBe(`bytes 5-${full.byteLength - 1}/${full.byteLength}`)
    expect(fromFifth.headers.get('content-length')).toBe(String(full.byteLength - 5))
    expect(new Uint8Array(await fromFifth.arrayBuffer())).toEqual(full.subarray(5))

    const whole = await shared.fetch(new Request(url, { headers: { range: 'bytes=0-' } }))
    expect(whole.status).toBe(206)
    expect(whole.headers.get('content-range')).toBe(`bytes 0-${full.byteLength - 1}/${full.byteLength}`)
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(full)

    const firstTen = await shared.fetch(new Request(url, { headers: { range: 'bytes=0-9' } }))
    expect(firstTen.status).toBe(206)
    expect(firstTen.headers.get('content-range')).toBe(`bytes 0-9/${full.byteLength}`)
    const firstTenBytes = new Uint8Array(await firstTen.arrayBuffer())
    expect(firstTenBytes).toEqual(full.subarray(0, 10))

    // A resume splice: the two partial bodies reassemble the whole archive.
    const rest = await shared.fetch(new Request(url, { headers: { range: 'bytes=10-' } }))
    const restBytes = new Uint8Array(await rest.arrayBuffer())
    const spliced = new Uint8Array(full.byteLength)
    spliced.set(firstTenBytes)
    spliced.set(restBytes, 10)
    expect(spliced).toEqual(full)

    // A last byte past the end clamps to the archive's final byte.
    const clamped = await shared.fetch(new Request(url, { headers: { range: 'bytes=2-999999999' } }))
    expect(clamped.status).toBe(206)
    expect(clamped.headers.get('content-range')).toBe(`bytes 2-${full.byteLength - 1}/${full.byteLength}`)
    expect(new Uint8Array(await clamped.arrayBuffer())).toEqual(full.subarray(2))

    // A start deep enough to skip whole source chunks before the tail.
    const tail = await shared.fetch(new Request(url, { headers: { range: `bytes=${full.byteLength - 3}-` } }))
    expect(tail.status).toBe(206)
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(full.subarray(full.byteLength - 3))

    await dispose()
  })

  it('answers 416 past the end and ignores other Range forms', async () => {
    const { connection, dispose } = await mounted(true)
    const shared = connection.createSharedFetchHandler('/api')
    const url = `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`
    const full = new Uint8Array(await (await shared.fetch(new Request(url))).arrayBuffer())

    const unsatisfiable = await shared.fetch(new Request(
      url, { headers: { range: `bytes=${full.byteLength}-` } },
    ))
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get('content-range')).toBe(`bytes */${full.byteLength}`)

    for (const range of ['bytes=-5', 'bytes=0-9,20-29', 'bytes=9-5', 'items=0-9', 'BYTES=0-9']) {
      const ignored = await shared.fetch(new Request(url, { headers: { range } }))
      expect(ignored.status, range).toBe(200)
      expect(ignored.headers.get('content-range'), range).toBeNull()
      expect(ignored.headers.get('accept-ranges'), range).toBe('bytes')
      await ignored.body?.cancel()
    }

    const badHead = await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}`, { method: 'HEAD' },
    ))
    expect(badHead.status).toBe(400)
    expect(badHead.body).toBeNull()

    await dispose()
  })

  it('answers 500 when a range request fails mid-generation', async () => {
    const { connection, dispose } = await mounted(
      true,
      () => { throw new Error('lineage lookup failed') },
    )
    const shared = connection.createSharedFetchHandler('/api')
    const response = await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1&includeDescendants=true`,
      { headers: { range: 'bytes=0-' } },
    ))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('session log export failed to read the stored log')
    const head = await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1&includeDescendants=true`,
      { method: 'HEAD' },
    ))
    expect(head.status).toBe(500)
    expect(head.body).toBeNull()
    await dispose()
  })

  it('validates the query before reporting missing export services', async () => {
    const { connection, dispose } = await mounted(false)
    const shared = connection.createSharedFetchHandler('/api')
    expect((await shared.fetch(new Request(`http://host${SESSION_LOG_EXPORT_PATH}`))).status).toBe(400)
    expect((await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1&includeDescendants=1`,
    ))).status).toBe(400)
    expect((await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`,
    ))).status).toBe(500)
    await dispose()
  })

  it('validates the compression level', () => {
    expect(Config({})).toEqual({ compressionLevel: 6 })
    expect(Config({ compressionLevel: 0 })).toEqual({ compressionLevel: 0 })
    expect(Config({ compressionLevel: 9 })).toEqual({ compressionLevel: 9 })
    for (const compressionLevel of [-1, 10, 1.5]) {
      expect(() => Config({ compressionLevel } as never)).toThrow()
    }
  })
})
