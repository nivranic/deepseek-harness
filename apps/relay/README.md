# DSH Relay Rendezvous

English | [中文](README.zh.md)

The self-hostable rendezvous shell of the cross-device plan (chapters 68/69): a zero-dependency Node HTTP service — device registration, reference-only envelope forwarding, draining by poll, the push stream (connect flushes the pending queue, then live envelopes arrive as NDJSON lines; a connected device keeps nothing queued), and presence derived from open streams (same-account streams receive device-online/offline lines; the presence endpoint answers the roster's online state). The relay is never a session database, workspace replica, or authority; the Windows/macOS host keeps full session authority. The protocol is pinned by the Android and Apple rendezvous cores in their lanes; this shell mirrors it for self-hosting.

## Running

```sh
node apps/relay/server.mjs        # PORT env overrides the default 8787
```

Endpoints: `POST /relay/register` `{accountId, deviceId, platform, pushToken?}` → `{token}`; `POST /relay/publish` `{accountId, kind, sessionId, eventId?, turn?}` → `{delivered}`; `GET /relay/poll?token=…` → the pending reference envelopes, drained; `GET /relay/stream?token=…` → the same envelopes as NDJSON lines — connect flushes the pending queue, then live publishes arrive on the open stream (an unknown token gets a clean empty close; a streamed device keeps nothing queued, so poll and stream never double-deliver); `GET /relay/presence?accountId=…` → `[{deviceId, platform, online}]`, the roster with online derived from open streams. Stream lines are bare reference envelopes, or `{"type":"presence","deviceId":…,"online":…}` when a same-account device's last stream opens or closes; presence lines are ephemeral — never queued for offline devices, which read the roster instead. TLS terminates in front; APNs/FCM push wakeup rides the `pushToken` slot when delivery lands.

## Boundaries

- LAN-direct stays the primary transport; this rendezvous is the forwarding path.
- Envelopes carry references only — never source code, prompt, credential, or diff content (chapter 70).
- Noise TLS and APNs/FCM push delivery are the relay lane's future steps; this shell is the PoC foundation.
