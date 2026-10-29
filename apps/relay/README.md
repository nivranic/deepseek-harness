# DSH Relay Rendezvous

English | [中文](README.zh.md)

The self-hostable rendezvous shell of the cross-device plan (chapters 68/69): a zero-dependency Node HTTP service — device registration, reference-only envelope forwarding, draining by poll, the push stream (connect flushes the pending queue, then live envelopes arrive as encrypted frames; a connected device keeps nothing queued), and presence derived from open streams (same-account streams receive device-online/offline frames; the presence endpoint answers the roster's online state). Every rendezvous endpoint is Noise-encrypted; the relay is never a session database, workspace replica, or authority, and the Windows/macOS host keeps full session authority. The protocol is pinned by the Android and Apple rendezvous cores in their lanes; this shell mirrors it for self-hosting.

## Running

```sh
node apps/relay/server.mjs        # PORT env overrides the default 8787
node apps/relay/selftest.mjs      # local assertions over the full flow; exit 0 = pass
node apps/relay/gen-relay-vectors.mjs  # regenerate the fixed-key Noise vectors, then sync the two native copies
```

## Transport encryption

The transport is Noise_XX_25519_ChaChaPoly_SHA256 (`noise.mjs`), carried over HTTP: `POST /relay/noise/hello` (body = handshake message 1) answers message 2 plus the `x-relay-session` header — the handshake transcript hash after message 2, which the client verifies against its own transcript; `POST /relay/noise/complete` (body = message 3) answers one encrypted ack frame `{"ok":true}` proving key confirmation. Every rendezvous body is then one or more transport frames — a u16 big-endian length prefix, then ChaCha20-Poly1305 ciphertext under the split session keys with empty associated data and a 64-bit little-endian counter nonce:

- `POST /relay/register` — framed `{accountId, deviceId, platform, pushToken?}` → framed `{token}`
- `POST /relay/publish` — framed `{accountId, kind, sessionId, eventId?, turn?}` → framed `{delivered}`
- `POST /relay/poll` — framed `{token}` → zero or more framed pending envelopes, drained
- `POST /relay/stream` — framed `{token, streamKey}`: the stream rides the client-generated 32-byte one-time key inside the encrypted request, so live pushes never share a counter with HTTP responses. Connect flushes the pending queue, then live publishes and same-account presence changes arrive as one frame each; an unknown token gets a clean empty close, and a streamed device keeps nothing queued, so poll and stream never double-deliver.
- `POST /relay/presence` — framed `{accountId}` → framed `[{deviceId, platform, online}]`, the roster with online derived from open streams. Presence frames are ephemeral — never queued for offline devices, which read the roster instead; a stream frame is a bare reference envelope, or `{"type":"presence","deviceId":…,"online":…}` when a same-account device's last stream opens or closes.

A Noise session idles out after 15 minutes; the answer is 410 and the client handshakes again. An id the relay never established also answers 410. The handshake endpoints stay plaintext — Noise conceals the static keys inside messages 2 and 3, so the bytes are public by design.

## Cross-implementation proof

No CI lane runs this Node service, so interop is pinned by fixed-key vectors: `gen-relay-vectors.mjs` drives one full handshake and both traffic directions under pinned X25519 scalars and writes `vectors/relay-noise-vectors.json`; copies live in the Android and Apple test bundles, and their Noise ports must reproduce the handshake bytes, session id, channel binding, split keys, and every frame exactly.

## Boundaries

- LAN-direct stays the primary transport; this rendezvous is the forwarding path.
- Noise terminates at the relay (the relay routes by account, so it reads the envelopes it decrypts): this is link security against network observers, not end-to-end secrecy between host and device.
- Envelopes carry references only — never source code, prompt, credential, or diff content (chapter 70).
- APNs/FCM push delivery rides the `pushToken` slot when delivery lands.
