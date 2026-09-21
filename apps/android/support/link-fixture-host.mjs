/**
 * Minimal Host-side Link fixture for the Android emulator lane: pairs one
 * device over the QR payload protocol, verifies Ed25519 request signatures,
 * admits the four-key signed device admission on every business RPC and
 * stream open (signature over `deviceId\ntimestamp\nnonce`, acceptance
 * window, replay ledger), answers the unary and stream endpoints the
 * companion shell drives, and refuses `workspaceFiles/read` with the
 * classified failure envelope `gateway/permission-denied` so the shell's
 * GatewayFailurePresentation can be exercised against a live server. HTTPS
 * rides the committed self-signed fixture certificate whose SPKI digest the
 * pairing payload pins, so the TLS-plus-pinning path the real protocol uses
 * stays exercised. Run with node; `--port` selects the listen port (default
 * 18080) and the pairing code is `fixture-code-1`.
 * @module apps/android/support/link-fixture-host.mjs
 */
import { createServer } from 'node:https'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAdmissionTracker } from './link-admission.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 18080)
const pairingCode = 'fixture-code-1'
/** deviceId → base64 SPKI DER of the device's Ed25519 key, registered at pair. */
const devices = new Map()
const admissions = createAdmissionTracker(deviceId => devices.get(deviceId))

const log = (event, fields = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

const bodySha256Hex = body => createHash('sha256').update(body).digest('hex')

/**
 * Verify the three credential headers against the device key registered at
 * pair, mirroring the host-side rule of the carrier's request-signature
 * vocabulary: base64 Ed25519 over `timestamp\nPOST\npath\nsha256hex(body)`.
 */
function verifySignature(req, body, path) {
  const deviceId = req.headers['x-dsh-device-id']
  const timestamp = req.headers['x-dsh-timestamp']
  const signature = req.headers['x-dsh-signature']
  const spkiB64 = deviceId === undefined ? undefined : devices.get(deviceId)
  if (spkiB64 === undefined || timestamp === undefined || signature === undefined) return false
  const input = `${timestamp}\nPOST\n${path}\n${bodySha256Hex(body)}`
  try {
    const key = createPublicKey({ key: Buffer.from(spkiB64, 'base64'), format: 'der', type: 'spki' })
    return verify(null, Buffer.from(input, 'utf8'), key, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

const description = {
  linkProtocolVersion: 1,
  contractVersion: 1,
  hostVersion: '0.1.2-fixture',
  hostId: 'h-fixture',
  hostName: 'Link Fixture Host',
  runtimeClass: 'full',
  sessionFormatVersion: 0,
  allowRemoteApproval: false,
  capabilities: {
    session: { list: true, history: true, follow: true, prompt: true, cancel: true },
    workspace: { follow: true },
    interaction: { approval: true, question: true },
  },
}

/** One unary server response envelope: `{ type, rpcId, result }`. */
const response = (rpcId, result) =>
  JSON.stringify({ type: 'server-response', rpcId, result })

const ok = (rpcId, value) => response(rpcId, { ok: true, value })
const refused = (rpcId, code, message, details) =>
  response(rpcId, { ok: false, error: { code, message, details } })

const handle = (req, res) => {
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const path = req.url ?? '/'
    if (req.method !== 'POST') {
      log('method-not-allowed', { path, method: req.method })
      res.writeHead(405).end()
      return
    }
    if (path === '/link/pair') {
      const payload = JSON.parse(body.toString('utf8'))
      if (payload.code !== pairingCode) {
        log('pair-rejected', { code: payload.code })
        res.writeHead(403).end()
        return
      }
      devices.set('d-fixture-1', payload.devicePublicKey)
      log('pair-accepted', { deviceName: payload.deviceName, deviceId: 'd-fixture-1', platform: payload.platform ?? null })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        deviceId: 'd-fixture-1', hostId: 'h-fixture', hostName: 'Link Fixture Host',
        role: 'observer', linkProtocolVersion: 1,
      }))
      return
    }
    const signatureVerified = verifySignature(req, body, path)
    if (!signatureVerified) {
      log('signature-rejected', { path, deviceId: req.headers['x-dsh-device-id'] })
      res.writeHead(401).end()
      return
    }
    log('request-verified', { path })
    if (path === '/link/describe') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(description))
      return
    }
    if (path.startsWith('/link/stream/')) {
      const open = JSON.parse(body.toString('utf8'))
      const admission = open.args === undefined || !('device' in open.args) ? undefined : open.args.device
      if (admission === undefined) {
        log('admission-missing', { path })
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.end(`${JSON.stringify({ k: 'e', c: 'gateway/arguments-invalid', m: 'device admission required', d: {} })}\n`)
        return
      }
      const verdict = admissions.verify(admission)
      if (!verdict.ok) {
        log('admission-rejected', { path, code: verdict.code })
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.end(`${JSON.stringify({ k: 'e', c: verdict.code, m: verdict.message, d: verdict.details })}\n`)
        return
      }
      log('admission-verified', { path, deviceId: verdict.deviceId, nonce: verdict.nonce })
      // One workspace record over the follow stream; unknown streams stay
      // frameless and open so unrelated watchers do not flap.
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      if (path.endsWith('/workspace/follow')) {
        res.write(`${JSON.stringify({ k: 'v', v: { records: [{ id: 'ws-fixture', title: 'Fixture Workspace' }] } })}\n`)
      }
      return
    }
    if (path.startsWith('/api/')) {
      const request = JSON.parse(body.toString('utf8'))
      const rpcId = request.rpcId
      const admission = request.payload === undefined || !('device' in request.payload) ? undefined : request.payload.device
      if (admission === undefined) {
        log('admission-missing', { path })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(refused(rpcId, 'gateway/arguments-invalid', 'device admission required', {}))
        return
      }
      const verdict = admissions.verify(admission)
      if (!verdict.ok) {
        log('admission-rejected', { path, code: verdict.code })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(refused(rpcId, verdict.code, verdict.message, verdict.details))
        return
      }
      log('admission-verified', { path, deviceId: verdict.deviceId, nonce: verdict.nonce })
      if (path === '/api/session/list') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(ok(rpcId, { items: [] }))
        return
      }
      if (path === '/api/workspaceFiles/list') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(ok(rpcId, { entries: [{ name: 'notes.md', type: 'file', size: 12 }] }))
        return
      }
      if (path === '/api/workspaceFiles/read') {
        // The classified refusal the emulator lane exists to drive: the
        // observer role may not read file contents.
        log('refusal-served', { path, code: 'gateway/permission-denied' })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(refused(rpcId, 'gateway/permission-denied', 'the observer role may not read file contents', {
          endpoint: 'workspaceFiles/read', role: 'observer',
        }))
        return
      }
      log('unknown-method-refused', { path })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(refused(rpcId, 'gateway/unknown-method', `no fixture handler for ${path}`, { endpoint: path }))
      return
    }
    log('unhandled', { path })
    res.writeHead(404).end()
  })
}

const server = createServer({
  key: readFileSync(resolve(here, 'fixture-host-key.pem')),
  cert: readFileSync(resolve(here, 'fixture-host-cert.pem')),
}, handle)

server.listen(port, '127.0.0.1', () => {
  log('listening', { port, pairingCode })
})
