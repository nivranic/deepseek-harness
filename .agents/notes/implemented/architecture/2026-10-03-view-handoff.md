# Agent Note: Section 26 Web view-handoff generation and receive side

Status: implemented

English | [中文](2026-10-03-view-handoff.zh.md)

## Problem

Section 26 shipped both codec ends — `ClientSessions.encodeViewLocation` / `openViewLocation` behind the sessions face, consumed by Android and mirrored by the Swift contract — but the Web itself had no capture affordance: a user reading a session on the desktop Web app could not hand the position to another device, and a Web page receiving a handoff link did nothing with it. The traceability ledger held this back as "the real cross-device QR/link channel is shell work".

## Decision

- New package `@deepseek-ai/dsh-client-ui-view-handoff` (the `ui-open-in-app` recipe: a client bundle mounted by the web-app profile). The capture side occupies the `conversation.session.header.actions` seat (order 20) as one quiet share action; the receive side starts from the plugin's `apply`.
- The anchor is the Chat timeline's last Turn `turn/start` seq — the same target the receiving side's turn-jump loader reveals (`loadThrough`'s contract names "a turn's `turn/start` seq"), so what is copied is exactly what will be revealed.
- The link is the current page's `origin + pathname + '#dsh-view=' + payload`: URL fragments never travel to a server, which is what makes this the minimal honest channel for "carries a viewing position, not a transport". QR rendering stays shell work.
- Both ends gate on Host admission through the same signal `encodeViewLocation` requires (the current generation carrying a Host descriptor): the action stays hidden before admission or without a Turn anchor, and the receiver's `waitForAdmission` defers the open so a payload can never reach the wrong Host. A received fragment is consumed on read (cleared immediately) — refresh or retry cannot loop; an open failure reports loud and never retries. A refused clipboard degrades to the action's `title` showing the link.
- `ISessions` widened with the two verbs — the interface's own doc names this "the explicit act of widening what features may do to the sessions domain", and a feature package consuming `ctx.sessions` is that act. `TestSessions` implements both through the real codec (one fixed test Host), and `FixtureSession.loadThrough`'s fail-loud stub now names the seq it was asked to reach.

## Alternatives considered

- **A share/push transport:** excluded by §26's own line — the position moves, the runtime never does; transports are future relay work.
- **Implementing inside `ui-conversation`:** the capture action and fragment receive evolve independently of the conversation skeleton; the seat keeps the header's owner in charge of layout exactly as `ui-open-in-app` does.
- **A `hashchange` listener:** polling-free but racy against late plugin mounts; the apply-time one-shot read covers both boot and refresh with one code path.

## Consequences

- The header actions seat gains its fourth occupant; the four neighborhood suites (skeleton, header-overflow, both host-switch lanes) stay green untouched.
- The `ISessions` widening ripples compile-time to every implementer — `TestSessions` and the conversation-registry inline fixture now fail loud on the two verbs, keeping the double honest with the face.

## Open work

- QR rendering, real cross-device delivery channels, and physical-device acceptance stay shell/section work; fragment routing under SPA routers that manage `location.hash` themselves is untested.
