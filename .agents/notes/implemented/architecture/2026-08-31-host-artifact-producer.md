# Agent Note: The Host Artifact Producer

Status: implemented

English | [中文](2026-08-31-host-artifact-producer.zh.md)

## Problem

The artifact vocabulary shipped without a producer: no host code created artifacts or journaled the events, so the pane stayed consumable-in-principle only, and `LinkSessionEventKind` still listed its old tags with nothing live to observe. Chapter 56 fixes the split the producer must honor — the journal carries references, metadata, and status; content bytes live in a resource channel.

## Decision

`dsh-artifact` grows from vocabulary-only into the seam owner: `ctx.artifacts` (`ArtifactStore`: `put`/`get`/`remove` by reference id — the same shape the Lite stores expose) plus the model-facing `artifact_create` tool. One call authors one complete artifact: the tool requires an owning agent session, trims and validates `kind` and `title`, mints `art-<uuid>`, journals `artifact/created`, writes the UTF-8 bytes through the channel, and journals `artifact/status` — `ready` on success, `failed` with the channel's error surfaced otherwise. Artifact ids crossing model, wire, durable-log, or filesystem inputs match one portable grammar: `art-`, then an ASCII letter/digit/hyphen body that starts and ends with a letter or digit, at most 128 characters total. `artifact_read` validates before channel lookup, the Session Remote controller validates before dispatch, the event invariant validates before persistence, and every local-backend operation validates again before deriving a filename; the retention sweep ignores foreign `.artifact` names. `dsh-artifact-local` is the shipped channel: one atomic `<id>.artifact` file below `<DSH_HOME>/artifacts` (owner-only mode, exclusive-create temp renamed over the target — `writeFileAtomic` gained `Uint8Array` content support for it), absent reads null, remove is silent. A durable invariant companion also enforces non-empty trimmed kind and title, the closed status set, and the open-turn relationship, deliberately silent on orphan statuses — a legal no-op in every fold. `LinkSessionEventKind` grows the two artifact tags (15 now), regenerated through the existing drift gate into the Swift and Kotlin models; no native fold changed, since they already consume the raw event records. The shipped base bundle mounts both the tool and backend for rosterless applications. The Web and desktop overlays disable the process-wide `dsh-artifact` row, leave `dsh-artifact-local` on the host plane, and mount `dsh-artifact` in the `standard`, `ptc`, and `cordis` agent presets; the `minimal` preset intentionally omits it. The tool-schema catalog boots the real pair over a throwaway home and documents the generated schemas, while the Web round-trip and desktop composition suites pin the scoped catalogs.

## Consequences

The model can produce and read first-class artifacts end to end: journaled for replay and companion rendering, with bytes durable on the host. The remote artifact pane becomes live when a paired device follows a session that calls the tool. [Binary inputs](2026-08-31-artifact-binary-input.md), [paged reads](2026-08-31-artifact-paged-reads.md), and [retention](2026-09-01-artifact-retention.md) specify the current extensions to this producer.

## Alternatives considered

Content-addressed storage (the attachment family's model) was deferred — artifacts are authored per call under a minted reference id, and dedupe buys nothing until retention exists; the id-keyed channel mirrors the Lite stores instead, keeping the seam symmetric across runtimes. Journaling the content inline (or base64 in the event) was rejected outright — chapter 56 forbids content on the journal. Queueing status events for offline devices of the relay is out of scope — presence of artifacts travels by journal replay, not push.
