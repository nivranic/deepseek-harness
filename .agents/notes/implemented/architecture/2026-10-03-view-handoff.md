# Agent Note: Section 26 Web view-handoff generation and receive side

Status: implemented

English | [中文](2026-10-03-view-handoff.zh.md)

## Problem

A viewing link must identify a durable Session position without carrying credentials or migrating an Agent. The receiving browser must verify its authenticated Host before looking up the target Session.

## Decision

- `@deepseek-ai/dsh-client-ui-view-handoff` owns the private v1 codec, capture action, QR delivery, and one-shot fragment receiver. Its header action occupies `conversation.session.header.actions`.
- The anchor is the Chat timeline's last Turn `turn/start` seq — the same target the receiving side's turn-jump loader reveals (`loadThrough`'s contract names "a turn's `turn/start` seq"), so what is copied is exactly what will be revealed.
- The link uses the current page's `origin + pathname + '#dsh-view=' + payload`. Query credentials are excluded; the recipient authenticates independently.
- Both ends use authenticated `host.describe()` discovery for the current connection generation. A different Host is rejected before Session navigation. Replacement or disposal aborts pending opens; late discovery replies cannot restore admission. Receive failures use a localized root notice.
- Session Controller owns retained history, Conversation owns View selection and focus requests, and Workspace owns the visible Session reference. The handoff plugin composes these services without adding codec methods to `ISessions`.

## Alternatives considered

- **A share/push transport:** excluded by §26's own line — the position moves, the runtime never does; transports are future relay work.
- **Implementing inside `ui-conversation`:** the capture action and fragment receive evolve independently of the conversation skeleton; the seat keeps the header's owner in charge of layout exactly as `ui-open-in-app` does.
- **A `hashchange` listener:** polling-free but racy against late plugin mounts; the apply-time one-shot read covers both boot and refresh with one code path.

## Consequences

- A received fragment is consumed once. Inaccessible history and missing Turn anchors leave the current conversation visible and report failure.
- Presentation requests remain on the exact Session binding until the registered renderer creates its store. Releasing that binding discards unconsumed requests.

## Open work

- Physical-device acceptance and fragment routing under SPA routers that manage `location.hash` themselves remain unverified.
