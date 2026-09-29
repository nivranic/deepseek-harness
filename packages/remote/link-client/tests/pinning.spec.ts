/** Observe decrypted server bytes before declaring that an incorrect SPKI pin was refused. */
import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:https'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ensureHostTlsMaterial } from '@deepseek-ai/dsh-link-access/src/tls.ts'
import { LinkClient } from '../src/index.ts'

describe('LinkClient certificate pin before request transmission', () => {
  it.each(['pair', 'describe', 'call', 'stream', 'matching-pin'] as const)('observes server bytes for %s', async (operation) => {
    const prefix = join(tmpdir(), 'dsh-link-pinning-')
    const root = await mkdtemp(prefix)
    try {
      const material = await ensureHostTlsMaterial(root)
      let requests = 0, plaintextBytes = 0
      const sockets = new Set<Duplex>()
      const closed: Promise<void>[] = []
      const server = createServer({ key: material.keyPem, cert: material.certPem }, (request, response) => {
        requests++
        request.resume()
        request.once('end', () => { response.end('{}') })
      })
      server.on('secureConnection', (socket) => {
        socket.on('data', (data: Buffer) => { plaintextBytes += data.byteLength })
      })
      server.on('connection', (socket) => {
        sockets.add(socket)
        closed.push(new Promise(resolveClose => socket.once('close', () => {
          sockets.delete(socket)
          resolveClose()
        })))
      })
      let client: LinkClient | undefined
      try {
        await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('Test TLS server has no TCP address')
        const endpoint = `https://127.0.0.1:${String(address.port)}`
        const spkiFingerprint = operation === 'matching-pin' ? material.spkiFingerprint : '00'.repeat(32)
        const pinned = new LinkClient({ endpoint, spkiFingerprint, deviceId: 'synthetic-device',
          deviceKey: generateKeyPairSync('ed25519').privateKey })
        client = pinned
        const signal = AbortSignal.timeout(5_000)
        const operations = {
          pair: () => LinkClient.pair({ v: 1, kind: 'dsh-link-pairing', endpoint, spkiFingerprint,
            hostId: 'synthetic-host', hostName: 'Synthetic Host', code: 'synthetic-code', expiresAt: Date.now() + 30_000,
          }, { deviceName: 'Synthetic Device' }),
          call: () => pinned.call('probe/echo', { value: 'synthetic-body' }, signal),
          stream: () => pinned.openStream('probe/ticks', { value: 'synthetic-body' }, signal).next(),
          describe: () => pinned.describe(signal),
          'matching-pin': () => pinned.describe(signal),
        }
        const request = operations[operation]()
        if (operation === 'matching-pin') await expect(request).resolves.toEqual({})
        else await expect(request).rejects.toThrow('fingerprint')
        await client.dispose()
        // Let the peer consume bytes until natural close; forced teardown could conceal a leak.
        await Promise.all(closed)
        expect(closed).toHaveLength(1)
        if (operation === 'matching-pin') {
          expect(requests).toBe(1)
          expect(plaintextBytes).toBeGreaterThan(0)
        } else {
          expect(requests).toBe(0)
          expect(plaintextBytes).toBe(0)
        }
      } finally {
        await client?.dispose()
        for (const socket of sockets) socket.destroy()
        await Promise.all(closed)
        await new Promise<void>((resolveClose, rejectClose) => server.close((error) => {
          if (error) rejectClose(error)
          else resolveClose()
        }))
      }
    } finally {
      if (!resolve(root).startsWith(prefix)) throw new Error('Refusing cleanup outside the test directory')
      await rm(root, { recursive: true, force: true })
    }
  })
})
