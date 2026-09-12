/** Fault injection stays in this worker; the running server uses its unchanged HTTP entry point. */
import { Server } from 'node:http'
import { parentPort } from 'node:worker_threads'
import { NoiseCipherState } from '../noise.mjs'

const counters = new Map()
for (const method of ['encryptWithAd', 'decryptWithAd']) {
  const original = NoiseCipherState.prototype[method]
  NoiseCipherState.prototype[method] = function (...args) {
    const key = this.key.toString('hex')
    if (counters.has(key)) {
      this.n = counters.get(key)
      counters.delete(key)
    }
    return original.apply(this, args)
  }
}
parentPort.on('message', ({ key, counter }) => {
  counters.set(key, BigInt(counter))
  parentPort.postMessage({ armed: true })
})

const listen = Server.prototype.listen
Server.prototype.listen = function (...args) {
  this.once('listening', () => parentPort.postMessage({ port: this.address().port }))
  return listen.call(this, 0, '127.0.0.1', args.at(-1))
}
await import('../server.mjs')
