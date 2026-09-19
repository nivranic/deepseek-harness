---
description: "Application Remote assembly: selects typed Host capabilities and forwarded events for Client consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-remotes

English | [中文](README.zh.md)

## Summary

Two-sided BFF for Host Remote capabilities selected by this application. The Host entry owns the forwarded-event selection and registers its application event source with API Gateway; the Client entry imports generated `/remote` artifacts as runtime values, mounts each contribution through `ctx.remote.$mount()`, and re-exports their declaration merges. Client business packages depend on this facade rather than the Gateway implementation or individual Remote runtime entries.

## Table of Contents

- [Use this package](#use-this-package)
- [Forwarded Host events](#forwarded-host-events)
- [Build boundary](#build-boundary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

File references, Session candidates and skill catalogs have independent owner-declared operation sets. Admission rejects a missing discovery capability before dispatch; Client features use the same declaration types without importing Host implementations.

The selected `presentedFiles` contribution supplies desktop metadata and verified native actions for persisted delivery declarations. Gateway admission checks its three owner-declared capabilities independently; the native Host and filesystem still enforce availability and path policy.

-----

<a id="use-this-package"></a>
## Use this package

Settings admission uses the Settings Controller’s shared read, write, document-opening and preset-directory declarations. Calls missing their exact operation set return `host/capability-unavailable` before dispatch; preset capabilities cannot authorize or substitute for these Settings operation sets. This facade exposes the declaration type to Client consumers without a cross-plugin runtime export. Configuration UI beyond the preset consumer still needs its own capability-driven entry behavior.

Agent Preset admission uses the owning package’s shared catalog, selection, and management declarations. Each operation requires its specific advertised capability before unary dispatch; another operation set cannot substitute for it. Settings-owned operations are not covered by these declarations.

Session calls require the current generation's advertised operation capability. The Client checks the Session owner's shared declarations before unary or stream dispatch; a missing capability returns `host/capability-unavailable` without sending the operation. These declarations cover Session follow, control, management, and model selection, not every mounted namespace. Capability admission does not replace Host authorization.

[`@deepseek-ai/dsh-api-session-controller`](../session-controller/README.md) owns Agent and Session identity policy, including the Typert lookup resolvers used by other namespaces. This package only selects and mounts that generated Session contribution; it does not duplicate activation policy.

The generated `host` contribution exposes `ctx.remote.host.describe()`. Its [owner](../host-description/README.md) supplies persistent identity, independent versions, and current declared capabilities; this facade re-exports `HostDescriptor`, `HostId`, and `HostTransport` as Client-safe types.

The Client assembly mounts Commands, credentials, settings, Goal, dynamic Cordis, file and Session references, read-only Host plugin inventory, message feedback, Session Controller, and Workspace Controller contributions. Cordis effect ownership withdraws every contribution when this assembly unloads, while `@deepseek-ai/dsh-api-gateway/client` owns descriptor validation, traced namespace Services, direct and scoped methods, invocation, streams, and cancellation. The Client entry consumes the shared `TypertClientRemote` interface through Cordis and does not import the concrete Gateway. It re-exports the Gateway Client face's declaration merges type-only, so a consumer reaching the forwarded-event vocabulary through this facade gains no runtime edge to the Gateway implementation.

This facade is also the front door for the wire type vocabulary a Client package names. It re-exports, type-only, the Remote failure vocabulary (`RemoteResult`, `RemoteFailure`, `RemoteErrorCode`, `RemoteErrorDetailsMap`), the Host facts (`RemoteHostFacts`), and each selected domain's client-safe payload types, so a Client feature package imports one specifier instead of reaching into `dsh-typert-protocol`, the Gateway, or an owner's Host entry. Two kinds of package deliberately skip this door: the API-layer packages this assembly itself selects — importing it back would close a dependency cycle — and their tests, which take the failure vocabulary from `dsh-typert-protocol` directly. A UI package's tests instead take the `RemoteError` constructor from [`dsh-client-test-runtime`](../../test-support/client-runtime/README.md).

The Client assembly owns discovery and protocol admission. It validates the protocol-1 `host.describe` representation with the generated codec and requires `host.describe.v1`. Hosts advertising `host.negotiate.v1` must supply valid version offers; the Client selects the highest shared protocol, calls `host.negotiate`, and verifies the selected version and unchanged Host identity. A Host without either negotiation field uses protocol 1 without probing a missing method. Contradictory metadata, negotiation failure, and changed identity fail closed without a downgrade. The validated `HostId` supplies Gateway’s interaction reply scope independently of the display name, home path and version; it identifies retained answers but grants no authority to answer.

The admitted `HostDescriptor` is available as `ctx.remote.$host.descriptor` and belongs to the existing Connection generation. It remains absent until the Host event stream is ready and is cleared when the generation is lost; every replacement repeats discovery. Initial callers can cancel independently without cancelling shared discovery. While disconnected or reconnecting, new business calls return `gateway/connection-unavailable` instead of queuing a later mutation; admitted calls cancelled by generation loss are never replayed. This package owns no second connection store or retry loop. Its Client face can be reused by Web or a future TUI providing the same React-free `ctx.remote` API. The selected protocol belongs to that generation and encodes unary calls, streams, and event replies. Selected UI owners consume the admitted capabilities and generation; complete cross-platform UI acceptance remains unverified.

Host discovery reports `authenticating` before its first `host/describe` request checks Host access. A successful carrier response resumes connection establishment before protocol validation and negotiation; generation readiness still requires the event ready frame. Cancellation from either progress notification prevents subsequent work. The callback exposes no credential and performs no additional authentication request.

-----

<a id="forwarded-host-events"></a>
## Forwarded Host events

`src/remote-events.ts` holds `API_REMOTE_FORWARDED_EVENTS`, the allowlist of Host Cordis events this application forwards without renaming, and therefore the legal key set of `ctx.remote.$on`; each entry also selects ordinary emission or Agent-scoped waterfall delivery. The type-only `src/types.ts` derives its selection face. Forwarding one more event requires one entry in that array: the type projection, consumer key face, and Host forwarding loop all derive from it.

The listener signature is not restated here. Each allowlisted event's Cordis `Events` declaration lives in its owner package's client-safe `./types` export, and both faces of this package pull those declarations in. The Host face additionally asserts every entry against `TypertForwardableEventEntry`: an `emit` entry must be a declared one-way event, while a `waterfall` entry must be a declared Agent-scoped waterfall whose final parameter is its same-result `next()` callback.

The Host entry registers an independent allowlist listener set and queue for each Client stream. It rejects non-JSON ordinary-event arguments before enqueueing. For a waterfall, it projects only the top-level Agent identity and JSON request fields; a Client result must also be lossless JSON, while `next()` delegates to the following Host listener. Each scoped waterfall request must carry its routed Agent directly as `request.agent`; the Host rejects a missing or mismatched identity before forwarding. The source attaches all listeners synchronously before `ctx.typertGateway.registerRemoteEvents()` exposes Gateway's internal `$events` logical stream, so its first `ready` item proves that incremental delivery is active and carries the Host home for Client path display. Withdrawing the registration aborts active streams.

Approval and Question entries explicitly declare their interaction kind and required response permission. The Host source attaches the routed Agent's Session identity; Gateway owns the pending record and protocol-specific delivery. The shared allowlist imports these types from Gateway's neutral `/protocol` leaf, so it does not introduce Host Context declarations into the Client program. This metadata does not implement device trust or response authorization.

<a id="build-boundary"></a>
## Build boundary

Most repository packages belong to one TypeScript face: Host packages are registered in the root `tsconfig.host.json`, and Client packages in the root `tsconfig.client.json`. This package splits because its Host entry must participate in the Host Typert graph, while `src/client/index.ts` cannot compile until Host tsdown has generated the business packages' `/remote` declarations.

This package's root `tsconfig.json` is only a solution that references `tsconfig.host.json` and `tsconfig.client.json`. The Host aggregate and direct Host consumers reference the former, while the Client aggregate and direct Client consumers reference the latter; the package-root solution must not enter either aggregate's dependency graph. The two projects own disjoint source files and `.tsbuildinfo` files but share the `lib/types` output directory, with one deliberate exception: `src/remote-events.ts` and `src/types.ts` are listed in BOTH faces' `files`, because the forwarded-event allowlist is the single control point over what a consumer can receive, and the Host forwarding loop and the Client `ctx.remote.$on` key face must read one declaration rather than two that could drift.

That exception is not just a `files` entry. The root `tsconfig.base.json` maps `@deepseek-ai/dsh-api-remotes/types` to `src/types.ts` — the source plane, like every other workspace subpath and unlike the generated `/remote` artifacts, which have no `paths` entry and resolve through `exports` to built output. Both faces therefore admit the same allowlist and type projection into their own programs and emit byte-identical `remote-events` and `types` outputs into `lib/types`; the `.tsbuildinfo` files stay independent. No gate enforces the faces' source-file disjointness — `scripts/project-reference-faces.ts` only checks that a reference into a split project names the matching face — so this paragraph records why the double listing is intentional.

The package-local `clientBundle(..., { hostPhase: true })` makes Host tsdown bundle the Host entry and the later Client tsdown bundle only the browser entry. Ordinary Client plugins remain single Client projects and produce both their Node loader entry and browser bundle during Client tsdown; split only when the two source sets require different compiler faces.

<a id="model-experience"></a>
## Model Experience

None, as this BFF selects Remote application methods and forwarded events but registers nothing model-facing.

#### KV Cache effect

No direct effect; mounted Host capabilities own any model-visible behavior they trigger.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Installed Remote stubs are selected by build-time imports. Advertised capabilities restrict the selected operation sets; they do not dynamically install namespaces.
- Additional capabilities require an explicit `/remote` value import and mount in this assembly.
- Only scoped waterfalls that are still pending are replayed after reconnection; ordinary one-way notifications remain isolated best-effort deliveries and are not replayed. State that requires reliable recovery needs an owner-provided query, cursor, or opening baseline.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Typert and the Agent/Session registries own the observed relationships.

Admission also consumes the LLM and credential owners’ declarations. Directory reads, model discovery, credential metadata and credential writes each require their own advertised operation set; Settings write support cannot substitute for credential write support.

Workspace admission uses the [Workspace Controller declarations](../workspace-controller/README.md#use-this-package) for follow, registry management and Session organization. Each requires its own operation set; Session management cannot substitute for any of them.

Directory Picker admission uses that owner's native, browse and creation declarations independently. Neither a Workspace capability nor another directory operation set permits an unsupported picker request.

Workspace Files admission consumes the owner's independent metadata, listing, text, byte-window, complete-file, related-file and observation declarations; supporting one does not authorize another.
