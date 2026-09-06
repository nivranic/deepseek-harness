/** Real HTTP regressions for exhausted session and independent stream traffic keys. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import { RelayClient } from './client.mjs'
import { NoiseCipherState, decodeFrames, encodeFrame } from './noise.mjs'

const EMPTY = Buffer.alloc(0)
const MAX = (1n << 64n) - 1n
const envelope = index => ({ kind: 'task-completed', sessionId: `s${index}`, turn: index })

async function start(t) {
  const worker = new Worker(new URL('./tests/server-fixture.mjs', import.meta.url), { stdout: true, stderr: true })
  t.after(() => worker.terminate())
  const [{ port }] = await once(worker, 'message')
  const base = `http://127.0.0.1:${port}`
  const client = new RelayClient(base)
  const token = await client.register({ accountId: 'acct', deviceId: 'phone', platform: 'android' })
  return {
    client, token, base,
    async arm(key, counter) {
      const ack = once(worker, 'message')
      worker.postMessage({ key: key.toString('hex'), counter: String(counter) })
      assert.deepEqual((await ack)[0], { armed: true })
    },
    async post(path, value, session = client.session) {
      return await fetch(`${base}${path}`, {
        method: 'POST', headers: { 'x-relay-session': session.id },
        body: encodeFrame(session.send.encryptWithAd(EMPTY, Buffer.from(JSON.stringify(value)))),
      })
    },
  }
}

for (const direction of ['send', 'recv']) {
  test(`server retires a session after ${direction} exhaustion`, { timeout: 10_000 }, async t => {
    const fixture = await start(t)
    const { client, arm, base } = fixture
    const oldId = client.session.id
    // Server directions are the reverse of this client's split states.
    await arm(client.session[direction === 'send' ? 'recv' : 'send'].key, MAX)
    await assert.rejects(client.presence('acct'), /HTTP 410/u)
    assert.equal(client.session, null)
    const old = await fetch(`${base}/relay/presence`, {
      method: 'POST', headers: { 'x-relay-session': oldId }, body: EMPTY,
    })
    assert.equal(old.status, 410, 'retired id no longer addresses any traffic keys')
    await old.arrayBuffer()
    assert.equal((await client.presence('acct')).length, 1)
    assert.notEqual(client.session.id, oldId)
  })
}

test('poll retains its entire queue when encryption exhausts partway through the response', { timeout: 10_000 }, async t => {
  const { client, token, arm } = await start(t)
  await client.publish('acct', envelope(1))
  await client.publish('acct', envelope(2))
  await arm(client.session.recv.key, MAX - 1n)
  await assert.rejects(client.poll(token), /HTTP 410/u)
  assert.deepEqual(await client.poll(token), [envelope(1), envelope(2)])
  assert.deepEqual(await client.poll(token), [])
})

for (const phase of ['backlog', 'live']) {
  test(`stream exhaustion during ${phase} closes the old key and retains unsent envelopes`, { timeout: 10_000 }, async t => {
    const { client, token, arm, post } = await start(t)
    const key = Buffer.alloc(32, phase === 'backlog' ? 1 : 2)
    if (phase === 'backlog') {
      await client.publish('acct', envelope(1))
      await client.publish('acct', envelope(2))
    }
    await arm(key, MAX - 1n)
    const response = await post('/relay/stream', { token, streamKey: key.toString('hex') })
    assert.equal(response.status, 200)
    if (phase === 'live') {
      assert.equal((await client.presence('acct'))[0].online, true)
      await client.publish('acct', envelope(1))
      await client.publish('acct', envelope(2))
    }
    const frames = decodeFrames(Buffer.from(await response.arrayBuffer()))
    assert.equal(frames.length, 1)
    const decrypt = new NoiseCipherState(key)
    decrypt.n = MAX - 1n
    assert.deepEqual(JSON.parse(decrypt.decryptWithAd(EMPTY, frames[0])), envelope(1))
    assert.equal((await client.presence('acct'))[0].online, false)
    await client.publish('acct', envelope(3))
    assert.deepEqual(await client.poll(token), [envelope(2), envelope(3)])
    assert.deepEqual(await client.poll(token), [])
  })
}

test('stream requests reject malformed one-time keys before opening a stream', { timeout: 10_000 }, async t => {
  const { token, post } = await start(t)
  for (const streamKey of [null, '', 'a'.repeat(63), 'g'.repeat(64), '00'.repeat(33)]) {
    const response = await post('/relay/stream', { token, streamKey })
    assert.equal(response.status, 400)
    await response.arrayBuffer()
  }
})
