# Agent Note: The Session header chip publishes every section 29 location fact

Status: implemented

English | [中文](2026-10-01-session-location-chip.zh.md)

## Problem

Section 29 requires each Session to expose Host, runtime mode, workspace, permission preset, and online state, with a lean long-lived chip at the top (`● Work PC · Windows`). The running-location chip carried only Host name/platform plus the section 10 permission tier; runtime mode, workspace, and the live online state had no surfaced home, and the section 34 remaining list still called the desktop split diff open even though the diff-split-view increment had shipped it.

## Decision

- The chip's visible text stays lean — Host facts, then the workspace directory name, then the permission tier, then a state word only while the connection is not ready — while the `title` attribute additionally publishes the runtime mode (`Full runtime`, read off the descriptor) and the full workspace path, so every section 29 fact is reachable without widening the header.
- `ConversationSessionHeaderInjected.hooks` gains `connectionState` (the same `ConnectionHandle.state` observable the root composer gate reads), so the header observes §18's connection vocabulary directly instead of inferring anything from Host-fact presence. The dot keeps its success tone for ready/unobserved, takes the business tone while connecting/authenticating/reconnecting, and the warn tone for the seven blocked states, each paired with a short localized state word (`session.locationState.*`).
- The workspace name is the last path segment of the session summary's `cwd`; a session the list has not caught up with (no summary row) simply omits the segment and the title path, the same absence semantics the chip already used for an undescribed Host.
- The section 34 remaining text is corrected in the same change: the desktop split diff is delivered evidence (per-tab toggle over the shared pairing), leaving real-device qualification as that section's open item.

## Alternatives considered

- **Render all five facts inline:** the specification's own chip example is two segments; a five-segment chip crowds the header on phone widths, and the title keeps the complete set one hover away.
- **Reuse the composer gate copy for state words:** `connection.gate.*` strings are sentence-length recovery guidance; the chip needs one-word status, so it owns a `session.locationState.*` short-form set over the same vocabulary.
- **Derive online state from Host facts:** Host facts persist across a dropped connection (they describe the last established generation), which would show offline sessions as online; only the connection observable knows the live state.

## Consequences

- Section 29's five location facts are each published on the header surface with localized short forms in both languages; any connection-state regression in the §18 vocabulary fails the chip matrix.
- Hosts that never negotiate a descriptor show no runtime-mode segment (the fact is unknown, not defaulted), keeping the chip honest about what the generation actually carried.
- The chip remains a display surface: it navigates nowhere and gates nothing; the composer gate and the roster switch keep their own mechanisms.

## Open work

- The chip shows the summary's workspace directory; a workspace-picker quick action from the chip is deliberately out of scope (the composer and hero already own workspace switching).
- Lite runtime mode has no producer yet (`runtimeMode: 'full'` is today's only value); when a Lite Host exists, its label joins the title without further wiring.
