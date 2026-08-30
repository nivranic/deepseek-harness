# DSH Relay Rendezvous

English | [中文](README.zh.md)

The self-hostable rendezvous shell of the cross-device plan (chapters 68/69): a zero-dependency Node HTTP service — device registration, reference-only envelope forwarding, and draining by poll. The relay is never a session database, workspace replica, or authority; the Windows/macOS host keeps full session authority. The protocol is pinned by the Android and Apple rendezvous cores in their lanes; this shell mirrors it for self-hosting.

## Running

```sh
node apps/relay/server.mjs        # PORT env overrides the default 8787
```

Endpoints: `POST /relay/register` `{accountId, deviceId, platform, pushToken?}` → `{token}`; `POST /relay/publish` `{accountId, kind, sessionId, eventId?, turn?}` → `{delivered}`; `GET /relay/poll?token=…` → the pending reference envelopes, drained. TLS terminates in front; APNs/FCM push wakeup rides the `pushToken` slot when delivery lands.

## Boundaries

- LAN-direct stays the primary transport; this rendezvous is the forwarding path.
- Envelopes carry references only — never source code, prompt, credential, or diff content (chapter 70).
- WebSocket streaming, presence subscriptions, and push delivery are the relay lane's future steps; this shell is the PoC foundation.
