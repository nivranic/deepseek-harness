---
description: "Host and Client session control: create, resume, prompt, follow history, and project live session state."
kind: "package-reference"
---
# Session Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-session-controller` owns the Host `ctx.sessionController` service and the generated Client `session`, `skills`, and `fileReferences` Remote namespaces. It serves Session lifecycle and history, the Host-generation model catalog, user-invocable skill discovery, and Agent-scoped file references. Use it through API Gateway when a Client needs operations addressed by a Session.

## Table of Contents

- [Use this package](#use-this-package)
- [Session media references](#session-media-references)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

The file-reference adapter declares `file-reference.list.v1`; the skill directory declares `skill.catalog.v1`. These operation sets describe discovery APIs independently of file viewers, Session candidates, and skill invocation. Mounted providers and permission checks still determine each operation result.

-----

<a id="use-this-package"></a>
## Use this package

A fork whose child-title update fails rejects with the original rename `RemoteError`; the already published child remains addressable.

The independent `session.search.v1` and `session.attachment.v1` capabilities admit content search and durable image reads. API Gateway rejects an unadvertised operation before carrier dispatch and cancels pending reads with their Connection generation. Attachment authorization still requires a reference in the addressed Session log.

Client child catalogs require `subagent.catalog.v1`. Connection generation withdrawal clears catalog contents, open menus, pending refresh ownership and parent-availability hints while retaining durable addresses and resident selected Sessions. Late catalog replies cannot publish data or remove replacement requests. Addressed child prompt and interrupt replies also retain their originating Host and cannot publish stale errors or acknowledgement state after replacement.

`session.rename-at.v1` exposes `renameAt(SessionRenameAtRequest)` with `sessionId`, raw `title`, and `expectedRevision` (title event seq or null). The title owner rejects a changed baseline with `session/revision-conflict`, except that an identical normalized user-pinned title returns its original acceptance. `ISession.prepareRename()` captures that revision before editing and retains it on retries; missing projection data fails without sending. Hosts without the capability and direct `rename()` calls retain unconditional rename semantics. This is conditional mutation safety, not a durable mutation-id receipt ledger.

The Client control stream waits for an admitted Host advertising `session.control.v1` before opening; the event journal similarly requires `session.follow.v1`. Journal reconnection retains the published history until a capable generation supplies its replacement snapshot. Capability absence leaves it dormant until a capable generation arrives; disposal cancels that wait and releases its observer. The shared `./capabilities` declaration is used by Host advertisement and Client operation admission.

History pages and follow opening snapshots carry one `{ type: 'event', event: SessionWireEvent }` record per durable Session event. The Client retains each accepted record as one durable `SessionEventLikeEntry`; Assistant token boundaries remain inside the compact stream on `assistant/message` or `assistant/attempt`. Tool arguments, result content, failures, and `tool/result.data.meta` pass through unchanged; the controller does not resolve a Tool definition, run a presenter, or attach UI data.

This owner declares `session.follow.v1` (follow and page), `session.control.v1` (control, prompt, queue update, and cancel), `session.manage.v1` (list, create, rename, and fork), and `model.select.v1` (catalog and selection). [Host discovery](../host-description/README.md) reports these operation sets while their Remote definitions are available; their presence does not promise mutation retry safety.

The additional `session.cancel-turn.v1` capability exposes `cancelTurn({ sessionId, turnStartSeq })`. The Host cancels only when `turnStartSeq` equals the current `activeTurnStart` projection; a stale target or explicit null is an accepted no-op. The Client captures this target per click and reports unavailable state rather than guessing before the projection arrives. Hosts without this capability use the legacy current-activity `cancel` operation, which does not promise delayed-retry safety. Neither operation resumes a cold Agent, and targeted cancellation retains pending inbox work.

For continuable children, `subagent.interrupt-turn.v1` selects `subagents.interruptTurnByParent`. The Client captures `subagentTiming.active.startSeq` on each click, or null for a known idle projection. Missing timing or a missing active target fails before dispatch; it cannot fall back to a less specific operation on a Host advertising addressed interruption. A Host without that capability uses the legacy parent-addressed interrupt. The Host remains responsible for parent authority and target matching.

The Client journal validates exact V3 event envelopes before publishing follow snapshots, live entries, or history pages. It reuses the browser-safe Session validators for required surface markers, exact replacement endpoints, earlier unique source seqs, embedded Assistant provenance, request-header omissions, and tool-error consistency. Invalid records fail without field stripping or normalization; range membership and source existence remain durable-log checks on the Host.

Each endpoint states its activation policy. List reads only stored headers and projection-cache rows: it never calls per-session stat or opens a cold Session body. A current-format cache identity may supply every list hint; a lifecycle-matching predecessor cache may supply only its version-compatible title as a stale display fact, never as an authoritative fold seed. Search, attachment, history pages, log following, and skill discovery can inspect persistence without activating an Agent. Queue mutation and cancellation require live state; model, rename, prompt, and file-reference operations may resolve or resume an ordinary Session. Prompt rejects content with neither non-whitespace text nor an attachment before resolving the Agent or appending Session events; queue edits accept only non-empty text content. Prompt admission consumes opaque receipts from the injected [`fileUploads`](../../client/file-upload/README.md) Host service and resolves every same-Agent receipt before sending the complete ordered content list through `ctx.attachments`. Prompt retries reuse the first acceptance for their `requestId` without inserting another message. Durable inbox insertion records preserve that receipt after claim or removal, including the interval before `user/message` is logged. Admission rechecks immediately before insertion after asynchronous attachment work; failed admission without an insertion remains retryable. Reusing an accepted identity never submits replacement content. Create and fork are the only operations that create a new Agent directly. The service applies one preset-aware resume policy and subagent ownership fence to its own methods and to the Typert Agent and Session lookups used by other Remote namespaces. Queue mutation has one narrow exception: a live child whose current projected identity is continuable and comes from its own non-seed suffix accepts the ordinary Edit, Remove, and QueueDock Steer actions across both inbox destinations. One-shot, missing, unknown, corrupt, seed-only, or cold children remain rejected without resume. The skill catalog uses a live Agent when present or the recorded preset's standing scope when cold, so listing never starts an Agent. The [declared-file service](../../client/ui-deliverables/README.md) uses the Host-local `workspaceDesktop()` and `openWorkspacePath()` methods after authorizing and resolving a recorded file. These helpers are absent from the Session Remote namespace. The local `action: "reveal"` selects file-manager navigation; omission opens the default application.

The Client adapter exposes `SessionEventStream`, a Gateway `RemoteJournalStream` bound to one ordinary or direct-subagent address. It opens follow before the initial page, publishes only contiguous `replace`, `prepend`, `append`, and `settle-assistant` changes, and repairs reconnect or sequence gaps through a tail page. Backwards paging has two verbs: `loadOlder()` pulls one 50-message page, and `loadThrough(seq)` — the turn-jump loader — loops 200-message pages until the window covers the target seq, lowering a shared target on repeated calls, stopping on a page that makes no progress, and reporting busy through the same `loadingOlder` snapshot bit. The Web adapter explicitly opts into cursorless Assistant frames: each opening carries the active attempt's `startedAfterSeq`, `nextIndex`, and compact stream, and every stream member becomes a Client-only `assistant/live-chunk` entry ordered between durable cursors. The Host captures a follower-local arrival ordinal with that baseline and suppresses buffered frames at or before the cut; a replacement Agent may restart frame revision at one. A durable `assistant/message` or `assistant/attempt` arriving after an active opening stays staged only when its seq follows `startedAfterSeq` and its Turn and Step match; the matching end type, seq, and index publishes one named settlement delta that retires the attempt's transient rows and adds the durable entry while earlier same-step retries remain visible. Revision, dense-index, or settlement gaps for a known attempt reopen follow, while a controller that missed the start ignores unknown-attempt frames and publishes their durable settlement normally. An abandoned end publishes a settlement delta without a durable entry so its transient rows retire immediately. A durable gap-repair page has no Assistant baseline, so its held notification reopens follow once for a paired page and baseline. Every history record covers exactly its event seq. A business, persistence, or unresolved continuity failure terminates the stream, while only physical carrier loss selects automatic resumption. `SessionControlStream` is a Gateway `RemoteSnapshotStream`; every generation opens with a complete process-local baseline, so reconnect replaces queue, jobs, and projection state instead of treating transient values as durable events. For each inbox change, the Host publishes the projection frame first and derives the queue replacement from that same validated post-fold value, so listener registration order cannot produce a stale queue frame.Client Agent contexts provide the identity used by the independent [`fileUpload`](../../client/file-upload/README.md) service; Session objects expose lifecycle, prompt, queue, and history operations rather than file transfer.

The Session object also carries local submission echoes: `session.beginSubmission` inserts one into `SessionSnapshot.pendingSubmissions` synchronously, before the caller serializes and prompts, so a conversation UI can show the message on the submit click's own frame. The echo stores ordered image previews and durable file references. Session derives its `transcript`, `queued`, or `steering` placement from the current running state and requested delivery mode, then retains that placement while serialization is in flight. The prompt's `requestId` is the correlation identity: the Host echoes it as the durable user source's `rpcId`, and queue occurrences project it as `SessionQueuedItem.rpcId`. An echo retires one animation frame after its durable event or queue occurrence is observed, immediately when its identified prompt fails or is abandoned, and as failed on disposal. Each retirement fires `onRetire` exactly once; an observed retirement includes the ordered durable attachment references so the composer can release successful cards while preserving failed drafts. Echoes are Client memory only; reload and reconnect rebuild the conversation from durable events alone.


The user-invocable `skills/list` metadata includes the winning provider’s optional instruction-file `path`. The composer can preview that file without loading every skill body or activating a cold Agent.

<a id="session-media-references"></a>
## Session media references

`SessionMediaReferences` mounts `GET|HEAD /api/file?path=<absolute path>` on the authenticated `connection.fetch` channel when `connection`, `fs`, and `attachments` are composed. It reads ordinary files through `ctx.fs`, including temporary paths outside registered workspaces and files in remote providers. Neither directory containment nor MIME categories restrict access; `mime-types` supplies the response type, with `application/octet-stream` for unknown extensions. GET reuses `readBytes` for preflight and ongoing byte limits; HEAD reads metadata only. All files use `ctx.attachments.imageLimits.maxImageBytes` (normally 20 MiB); exceeding this limit returns 413. Responses contain the complete file, ignore Range, and carry `private, no-store`, `nosniff`, and a sandbox CSP so directly opened HTML/SVG cannot execute with the API origin. The Client rewrite lives in `ui-chat` (`AssistantMarkdown`); audio/video responses are available, while Markdown audio/video player nodes remain separate work.

-----

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `nativeOpen` | platform-detected | Whether Session workspace paths can be handed to a native desktop opener |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-api-session-controller) is the exhaustive source for accepted fields and their JSDoc.

-----

<a id="model-experience"></a>
## Model Experience

None, as invoked Agent commands own any model-visible effect.

#### KV Cache effect

No direct effect; model requests remain owned by the Agent and LLM packages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The image byte cap does not validate decoded dimensions or pixel count.
- Control baselines represent process-local state and therefore cannot reconstruct jobs after a Host restart.
- A failed follow resumption remains visible to the caller instead of retrying indefinitely.
- The raw browser upload is one streaming HTTP request without resumable offsets; a retry sends the file again from byte zero.
- File-reference completion uses the shared Agent lookup and can resume a cold Session; the `skills/list` catalog is the non-activating alternative for skill metadata.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Every page and frame is checked against the addressed durable Session.
