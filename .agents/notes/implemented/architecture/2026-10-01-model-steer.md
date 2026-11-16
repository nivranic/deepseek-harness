# Agent Note: Steer submissions join the shared capability contract (§30)

Status: implemented

English | [中文](2026-10-01-model-steer.zh.md)

## Problem

Section 30 requires the legacy steer promise to continue only through the shared contract: `HostDescriptor` capabilities advertise `model.select.v1` and `model.steer.v1`, and clients render by capability with no per-platform vocabulary. `model.steer.v1` was never advertised — the steer promise rode the `session/prompt` mode argument bare, the Web composer offered steering by an implicit address rule instead of a capability gate, and the Android companion hardcoded `mode: "queue"` with no steer entry at all.

## Decision

- `SESSION_REMOTE_CAPABILITIES` advertises `model.steer.v1` over the existing `prompt` method. The entry deliberately overlaps `session.control.v1` (both declare `prompt.send` for `prompt`), so the gateway's first-matching-capability permission lookup is order-independent for this method.
- `ComposerControlAvailability` gains `steer`, computed as the advertisement plus an admitting prompt path; the Web input bar renders the explicit steer submission only when both hold, and one-shot subagent addresses queue instead of steering (only ordinary Sessions and continuable children accept new turns). Running-versus-idle stays Host-owned: the client sends intent (`mode: "steer"`), the Host turns it into `agent.steer`, and an idle driver starts a turn.
- Android observes the capability through `NativeObservedCapability.MODEL_STEER` (no separate endpoint — the promise rides `prompt`), renders 转向发送 beside the queue send, and `submitPrompt` grows a `steer` parameter that selects the wire mode; the default `queue` wire is byte-identical to before.
- The steer entry keeps the composer to the one row the acceptance lanes exercise against the soft keyboard, with a two-character label (转向): a full-width label (转向发送) overflows the row on phone widths, squeezes the draft field until it grows vertically, and collapses the session list — a regression the admitted-prompt-retry lane caught through its pending card scrolling out of the composed tree. Every tag the acceptance vocabulary addresses stays put.
- The acceptance lane pairs a real AVD companion to a replay Host, submits one steer draft, and proves exactly one device-signed `session/prompt` dispatch carrying `mode: "steer"` whose recorded turn settles, plus the cleared pending prompt.

## Alternatives considered

- **A dedicated steer endpoint:** the promise already rides `prompt`'s mode argument; a second method would split admission (attachment receipts, requestId dedup, permission) across two paths for no contract gain.
- **Deriving steer availability from observed turn state:** a client cannot know turn state at tap time; the Host owns running/idle semantics, so the client only gates on the advertisement and sends the intent.
- **Unconditional steer entry:** violates section 30's capability-rendered rule and would submit `mode: "steer"` to Hosts that never promised it.

## Consequences

- Every Host advertises `model.steer.v1` today, so the unadvertised path is exercised by unit tests only (capability withholding is a code-level change, not a configuration knob).
- Web steer submissions against one-shot subagents queue like ordinary prompts, and Android queue submissions are unchanged on the wire.
- The Host capability detail list grows a localized 转向发送 entry, the support-export snapshot gains the `model.steer.v1` observed-capability key, and the advertisement order in `HostDescriptor.capabilities` stays sorted output.

## Open work

- The other half of section 30 — the Android model-select composition entry — remains open; `model.select.v1` is advertised and the Web picker exists, the Android side has no select UI yet.
- Real-device qualification stays open; the lane runs on a local AVD replay Host.
