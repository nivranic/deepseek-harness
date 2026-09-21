---
description: "Typed Client-to-Host calls and streams: dispatch, validation, cancellation, reconnection, and forwarded Host events."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gateway

English | [中文](README.zh.md)

## Summary

Two-sided Typert RPC endpoint for Host and Client Cordis environments. The Host entry provides `ctx.typertGateway`, while `@deepseek-ai/dsh-api-gateway/client` provides `ctx.remote`; both consume the same generated `InvocationDescriptor` contract and leave business selection to API Remotes. Connection carries unary request correlation, trust, and response envelopes, while Gateway owns multiplexed Remote streams.

## Table of Contents

- [Host service: `TypertGatewayService` (ctx key: `typertGateway`)](#host-service-typertgatewayservice-ctx-key-typertgateway)
- [Client service: `ClientRemote` (ctx key: `remote`)](#client-service-clientremote-ctx-key-remote)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

The timeout library remains a peer dependency: `deadline` creates `TimeoutReason` values that `timeoutOf` identifies by class identity. Native and Client request lifetimes retain their existing owners.

-----

<a id="host-service-typertgatewayservice-ctx-key-typertgateway"></a>
## Host service: `TypertGatewayService` (ctx key: `typertGateway`)

`ctx.typertGateway.invoke()` resolves the current descriptor and Cordis Service for each call, validates exact named arguments, resolves registered object or Context identities, invokes the public business method, and validates its result. Business Services extend `TypertRemoteService` and mark methods with `@Remote` or `@RemoteScope` from [`dsh-typert-protocol`](../../typert/protocol/README.md); `bindTypertRemote()` remains available when another base class owns inheritance.

`capabilities()` reads explicit versioned declarations from active Remote bindings. Every required method must remain available; strict-definition withdrawal suppresses the capability until re-registration. Duplicate ids and declarations naming unexported methods fail. The sorted result describes supported operations, not a caller permission or request-specific resource readiness. [Host discovery](../host-description/README.md) exposes these facts over the existing Remote carrier.

Strict mode reads generated invocation descriptors from `ctx.typert.local`. Lookup parameters use the currently active resolver in `ctx.typert.lookups`: the business package registers the stable declaration and default policy, while Host composition can override resolution behavior with effect-scoped `configure()`; `@RemoteScope` resolves its receiver through a registered Host Context adapter. SRC mode is a development fallback for endpoints that have never had a strict definition; it parses simple parameter names and accepts only JSON-safe values for non-lookup parameters. Withdrawing an observed strict definition fails instead of weakening validation.

The Host entry registers a trusted-host interceptor on Connection's shared `/api` FetchHandler. Connection passes this composite handler through its HTTP bridge; the handler dispatches claimed endpoints to Gateway and returns 404 for unclaimed requests unless an exact Fetch route owns them. Direct `invoke()` calls preserve business errors; `TypertGatewayError` is a `RemoteError` subclass whose `gateway/*` codes name the failures owned by dispatch, binding, providers, lookup, Context, arguments, and codecs. A resolver that refuses on policy grounds — a cold-resume failure or an ownership fence — throws its own `RemoteError`, and the code it chose reaches the caller unchanged.

A cancellation-aware Remote method declares `signal: AbortSignal` as its final Host parameter. The signal is descriptor metadata rather than a wire argument: Connection supplies it to the Gateway, and the Gateway injects it after decoded business parameters. SRC recognizes the reserved final name, while strict generation additionally requires the global `AbortSignal` type.

A stream Remote uses `@Remote({ mode: 'stream' })` and returns an `Iterable` or `AsyncIterable`. `ctx.typertGateway.stream()` applies the same endpoint, argument, lookup, and cancellation checks as unary invocation, then validates each yielded item with the generated result codec. The Client opens the Gateway-owned `/api/remote.mux` WebSocket when its plugin activates and keeps it connected while idle. Connection owns the retry schedule; before each retry it asks the mux to cancel any candidate or active socket and make exactly one fresh physical attempt. The Host sends Ping control frames at the configured `websocketHeartbeatIntervalMs` interval (two seconds by default), and the browser answers Pong at the WebSocket protocol layer, so idle network intermediaries see traffic without any Remote stream frame. A socket that has not answered the previous Ping is terminated at the next interval. Independently cancellable logical streams share that socket; an in-process Connection carrier provides equivalent streams directly without opening it.

Host composition can register one application event source through `registerRemoteEvents()`. Gateway reserves the internal `$events` logical endpoint for that source, accepts only empty `args`, and aborts streams opened by the registration when the source is withdrawn. API Remotes owns the event selection, argument validation, per-Client queues, and the Host home and Node.js platform sent in the opening `{ type: 'ready', clientId, host: { home, platform } }` frame. Its source factory attaches incremental listeners synchronously, so the Client publishes the generation and starts baseline reads only after incremental delivery is ready.

Gateway accepts the protocol-1 `{ args }` request and an explicit `apiProtocolVersion` of 1 or 2 alongside `args`. Its shared `/protocol` leaf encodes the selected version; version 1 omits metadata for prior Hosts. Unknown or malformed explicit versions produce `gateway/protocol-unsupported` before business invocation, stream opening, or event-result settlement. Endpoint argument validation remains strict. Request metadata is not authorization. Application preparation must return an explicit selected codec, retained by the admitted generation and its event replies; standalone compositions explicitly resolve protocol 1.

An explicit `apiProtocolVersion` of 0 announces the diagnostics-only tier for Clients two generations behind: the request rides the frozen protocol-1 codec and is admitted for the read-only Host discovery endpoints (`host/describe`, `host/negotiate`) only. Every other endpoint — business RPC, streams, and event-result settlement — rejects with `gateway/protocol-unsupported` carrying the same compatibility details, so the Client presents the ordinary upgrade guidance. The tier is a fixed protocol invariant, not configuration; `host/negotiate` still requires positive integer offers, so a diagnostics-only Client cannot negotiate itself into a full codec.

The admitted endpoint surface per announced version, pinned as one interop matrix by `pins the protocol-version by endpoint-class interop matrix` in `tests/gateway.host.spec.ts` (stream-open admitted-version rows live in the stream suite):

| Announced version | Discovery (`host/describe`, `host/negotiate`) | Business RPC | Remote event stream open | Event-result settlement |
| --- | --- | --- | --- | --- |
| 0 (diagnostics-only) | admitted, read-only | refused: diagnostics message | refused: diagnostics message | refused: diagnostics message |
| 1 (legacy) | admitted | admitted | admitted | admitted |
| 2 (current) | admitted | admitted | admitted | admitted |
| unknown or malformed | refused: `gateway/protocol-unsupported` | refused: `gateway/protocol-unsupported` | refused: `gateway/protocol-unsupported` | refused: `gateway/protocol-unsupported` |

Initial application calls may wait during `connecting` until discovery and the opening event frame admit them. Calls made while `reconnecting`, `offline` or a failure state is active fail before carrier dispatch. A reconnect never resubmits the rejected operation; callers must make a new explicit request after `ready`.

During generation establishment, unsupported Host or Gateway protocols and missing required discovery capabilities publish `incompatible`; invalid Host discovery and a withdrawn preparation owner publish `fatal`. Both suspend automatic attempts in Connection. Business calls fail before dispatch while either state is active; manual reconnect repeats discovery before admission. Ordinary business-operation failures do not change Connection state.

Malformed WebSocket frames and invalid forwarded-event readiness or interaction records produce `gateway/stream-invalid` with the affected stream and retain their parsing cause locally. They terminate affected streams without carrier retries; failure of the event generation publishes `fatal` until explicit reconnect. Socket loss retains its ordinary recovery policy. Validation failure does not authorize replaying a mutation or answer.

Pending scoped waterfalls belong to the Host caller and survive Client disconnection. The first accepted result settles the request once. A later reply, a reply from a closed Client generation, or a reply after that Client delegated with `next()` returns `interaction-closed` with its `eventId`, without changing any pending request. Client delivery treats this outcome as completed interaction work, not as a Connection failure; other errors retain their failure behavior. This result does not provide durable mutation receipts or device authorization.

Rejected interaction-result envelopes other than `interaction-closed` leave the event generation as `RemoteError` with the Host code and details intact. The existing Connection classifier can therefore suspend an unsupported protocol as `incompatible`; revision conflicts and unknown codes retain its ordinary recovery policy. A received refusal clears only the retained answer associated with that request.

For application-declared interactions, protocol 2 adds a Host-owned record to the waterfall and its terminal cancellation frame. `requestId` equals `eventId`; Session identity and required response permission come from the source, while Gateway assigns creation time, status, and revision. Reconnection replays the same pending record at revision 1. Remaining deliveries close at revision 2 with `resolved`, `delegated`, `cancelled`, or configured `expired` status; the answering Client already owns its result. Protocol 1 keeps the exact event fields without this record. Records live only for the pending Host invocation; permission metadata grants no authority.

Protocol-2 interaction outcomes echo `interactionRevision` for results, delegation, and rejection. Gateway compares it to the pending record before removing a delivery or settling the caller. A missing revision returns `gateway/input-invalid`; a mismatch returns `revision-conflict` with expected and received revisions. The request protocol must match the active delivery generation, preventing a protocol-2 answer from omitting revision checks through a legacy envelope. Protocol-1 and unrecorded waterfalls reject revision fields. Invalid replies retain the pending delivery; closed deliveries still return `interaction-closed`. A Client revision failure follows the existing generation-recovery path so the Host can replay the pending record, without exposing metadata to business listeners.

`interactionReplyPermissions.approval` and `.question` (default `true`) are enforced Host-side on every forwarded interaction reply: a client without the pending interaction's `requiredPermission` gets `gateway/permission-denied` and its reply neither settles the invocation nor consumes the delivery, so the underlying tool side effect never runs and another entitled answerer can still respond. The switch is the anonymous-client default: a Remote event stream open whose `args` carries a signed device admission (`{deviceId, timestamp, signature}`, verified through `ctx.deviceTrust` when composed) instead receives the section 21 permission set of the device's role.

A versioned request envelope may also carry a signed device admission beside `args` (`{apiProtocolVersion, args, device: {deviceId, timestamp, signature}}`; version 1 never carries one). The Gateway verifies it through the same admission ladder and gates the endpoint on the owning capability's declared `requiredPermission`: a device role without it — and a device-identified call on an undeclared capability — is refused with `gateway/permission-denied` before dispatch, while anonymous requests never take this path.

`interactionTimeoutMs.approval` and `.question` optionally bound forwarded interaction lifetimes in milliseconds (1 through 2,147,483,647). Omitted kinds have no Gateway deadline. The lifetime starts when Gateway creates the pending record; `expiresAt` uses Host time and remains unchanged across reconnects. The elapsed timer or an overdue Host timestamp check before replay or answer acceptance expires the request, so a backward clock change cannot extend the elapsed timer and a delayed callback cannot admit an overdue answer. Settlement and caller/source cancellation clear the timer. Expiry rejects the Host invocation with `interaction-expired` and sends protocol-2 consumers an `expired` terminal record; protocol 1 receives its usual cancellation fields. Late answers return `interaction-closed`. Approval maps the rejected answerer to its existing fail-closed `unavailable` outcome, while Question propagates the expiry error. Local answerers outside this forwarded invocation are unaffected; no expiry record survives Host restart.

Host process restart discards pending invocations. A reconnecting Client removes the old delivery; an answer to its old event id returns `interaction-closed`. Session recovery belongs to the [Session owner](../../core/session/README.md), not Gateway: an interrupted tool can have an unknown outcome, so reconnecting does not authorize replaying its effects.

<a id="client-service-clientremote-ctx-key-remote"></a>
## Client service: `ClientRemote` (ctx key: `remote`)

Protocol-2 ready frames include `pendingInteractionIds`, the interaction ids queued for that generation. The Client retains a completed answer in memory when its HTTP transport fails and resends it only when the same application-provided `interactionReplyScope`, pending id and revision are delivered again. A missing scope or pending-id snapshot disables retention; a changed scope requires a fresh answer. Acknowledgement, `interaction-closed`, cancellation, a business error, or absence from the next ready snapshot clears the answer. A late acknowledgement clears only the saved answer it sent. Listener results are copied before sending; unfinished listeners still abort on disconnect, and delegation is not retained. Client disposal or reload loses retained answers. This retry provides neither authorization nor a durable receipt and cannot distinguish a lost acknowledgement from another Client’s winning answer.

The optional second `$prepare` callback checks each endpoint against its admitted generation's facts before carrier dispatch. A rejection affects only that operation. A domain stream may supply `available` to wait for a matching Host without opening; cancellation releases the generation observer.

The logical stream supervisor binds each opener and delivered frame to the observed Connection generation. Replacement during admission or reading discards that generation's Remote failure or delayed frame and waits for an eligible replacement. Its isolated carrier retry budget belongs to one admitted Connection, so successive connections do not exhaust each other's budget before a baseline arrives. Unclassified local errors remain terminal. Domain consumers do not add a second reconnect loop.

`ctx.remote.$mount()` validates and registers a generated Host-for-Client contribution, then installs concrete direct and scoped methods for the calling Cordis fiber. Each namespace is a traced `remote.<namespace>` child Service and unloads after its last method is withdrawn. Duplicate endpoints, namespace collisions, and descriptors without strict generated codecs fail before methods become callable.

An application installs one discovery callback through `ctx.remote.$prepare()` before mounting its selected business namespaces. The callback uses the existing unary carrier and the Connection attempt's cancellation signal. Gateway waits for discovery before opening `$events`, then admits unary and stream calls only after that generation is ready. Admitted calls share its cancellation lifetime. A failed discovery preserves its Remote failure code; a withdrawn preparation owner fails closed until replacement. Standalone Gateway compositions without an application preparation owner retain their generic invocation behavior. The [API Remotes assembly](../remotes/README.md) owns the Host-specific policy and facts exposed through `$host`.

Preparation receives the Connection source’s optional handshake progress reporter. Gateway captures whether the attempt started as the initial `connecting` attempt before preparation reports progress. Business callers may wait through that initial `connecting` or `authenticating` handshake. A retry remains ineligible for waiting even while it reports `authenticating`; new calls fail before dispatch and are not replayed when authentication completes.

Each unary call validates positional inputs, constructs the descriptor's exact named `args`, and sends it through `ctx.connection.rpc.call('/api', endpoint, ...)`. A generated stream method returns an `AsyncIterable` and opens one logical stream through an in-process Connection carrier when available, otherwise through the shared Gateway WebSocket. Generated cancellation-aware methods accept a final optional `AbortSignal`; the Client combines it with the contribution mount lifetime before invoking the carrier. Unary results and every stream item are validated before reaching application code. Withdrawing a contribution removes its descriptors and methods together, aborts in-flight calls and streams, and makes retained method handles reject.

Every unary call resolves to `RemoteResult<T>` — `{ ok: true, value }` or `{ ok: false, error }` — and never rejects for a carrier problem: this face folds an offline carrier into the error branch and answers `gateway/cancelled` when the caller's signal aborts, so no consumer wraps a call to recover one. Only an assembly fault still rejects: wrong arity, an unmounted method, a withdrawn contribution, a missing Context adapter. `error` is a live `RemoteError` instance, so `throw result.error` keeps throw semantics, and `isRemoteFailure(value)` is the one predicate a consumer needs — a caught value it accepts carries a Remote failure code, and anything it rejects is a local fault the caller should let crash. `carrierFailure(endpoint, error)` and `cancelledFailure(endpoint, cause)` build those two folded results, so a test stand-in for this face folds identically.

HTTP rejections without a Remote envelope use one Client mapping: 401 becomes `gateway/authentication-required`, 403 `gateway/permission-denied`, 503 `gateway/host-not-ready`, and other statuses `gateway/transport-interrupted`. Each carries `{ endpoint, httpStatus }`. A 401 that invalidates its own generation preserves the authentication code; caller cancellation and responses already cancelled on arrival retain `gateway/cancelled`. The codes describe the failed request: 403 does not prove device revocation, and 503 does not invalidate an otherwise ready generation. Unclassified carrier exceptions retain `gateway/internal`; Host business failures keep their codes.

Identified Connection transport interruptions use `gateway/transport-interrupted` with `{ endpoint }`; exhausted logical-stream carrier retries use the same code with `{ stream }`. Only a received HTTP response contributes `httpStatus`. These classifications do not retry a mutation or change the stream retry policy.

`ctx.remote.$host` reads the admitted generation's Host facts and the page-local `isLoopback` value. `home`, `platform`, and application discovery facts are unavailable before readiness and while disconnected; the running-location surface reads `platform`. It adds no store or subscription; consumers observe Connection generation changes for loss and replacement, or `connection/reset` for newly established generations.

`ctx.remote.$stream()` returns a single-consumer `RemoteStream` spanning physical carrier generations. Before every domain opener it waits for an admitted Host and any supplied capability predicate; initial connection setup therefore cannot terminate a domain stream as unavailable. It permits one immediate retry while the Host remains available, otherwise waits for the next connected Host generation, and annotates each item with its physical generation. The domain consumer validates and accepts each generation's opening value; business and protocol failures remain terminal. Every terminal failure leaves this face as a `RemoteError`, including exhausted carrier retries and a generation that ends before its opening value, so a stream consumer discriminates the same way a unary caller does. `RemoteStreamCarrierError` names a retryable physical loss and reaches a domain only as the `carrierFailed` callback argument, never as a terminal outcome. `RemoteSnapshotStream` adds one opening snapshot followed by deltas. `RemoteJournalStream` forwards its optional Host availability predicate to the same stream supervisor and adds follow-before-page opening, pagination, reconnect catch-up, and gap repair over domain-defined inclusive entry ranges; it removes complete duplicates and rejects gaps, inverted ranges, and partial overlaps. A domain may also carry cursorless notifications: they never advance or repair the durable cursor, and notifications received during gap repair publish only after the replacement page commits. If a newer generation supersedes that repair, held notifications from the superseded generation are discarded with its page. Disposing any stream cancels its requests and resolves after the active iterator is fully stopped.

`ctx.remote.$on()` subscribes to one forwarded Host event. Its legal keys are exactly the Host assembly's forwarding selection, and the listener type is the owning package's own Cordis `Events` declaration, so no second signature can drift from it. Each subscription belongs to the calling fiber and disappears with it. The Client Remote service registers the `$events` pump as a Connection generation source when it activates, whether any `$on` listener exists. Browsers use Remote mux, while in-process compositions use `connection.rpc.open`; the opening `ready` item establishes a Connection generation and supplies its Host facts. Carrier failure, Remote stream failure, unexpected normal completion, a non-ready opening item, or a malformed event item ends that generation and lets Connection reopen it under continuous, capped jittered exponential backoff. Ordinary notifications run in registration order and isolate listener failures. Agent-scoped waterfalls let a listener return a result, call `next()`, or reject; Gateway returns that outcome through the existing HTTP unary carrier.

`ctx.remote` exposes no Connection lifecycle control. A consumer whose responsibility includes recovery reads `ctx.connection.state` and calls `ctx.connection.reconnect()` directly; ordinary Remote consumers stay on generated namespaces and `$stream()`.

Generated declaration merges provide the TypeScript API through the shared `TypertClientRemote` contract. The Client entry contains no Host Service or Host Cordis interface merge, and method lookup and invocation use ordinary objects and functions rather than a JavaScript Proxy.

<a id="model-experience"></a>
## Model Experience

None, as the package dispatches application calls and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; invoked business Services own any model-visible result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Connection adapter answers `gateway/internal` with empty details for dispatch failures and unclassified exceptions; a `RemoteError` thrown by an owner or by Gateway itself crosses the wire with its own code, message, and details. Its `cause` chain and the `TypertGatewayError` subclass identity survive only for same-process callers.
- SRC mode supports unique identifier parameters without destructuring, defaults, or rest parameters. It validates JSON safety rather than generated business types and never infers optional fields.
- Only strict generated contributions can mount on the Client face. SRC markers have no Client codec or type projection.
- `$stream()` supervises carrier replacement but does not infer replay semantics; each domain owns its resume cursor or replacement-baseline validation and normal-end classification. Connection generations reopen the internal `$events` stream; one-way notifications are not replayed, while pending scoped waterfalls retain their event id across replay.
- Lookup resolvers are configured per key; an individual Remote parameter or endpoint cannot currently select a live-only policy under the same `agent`/`session` key.
- Forwarded events reach `$on` without business-payload projection or redaction. Ordinary notifications are not replayed after reconnect; Agent-scoped waterfalls project only the top-level Agent identity needed to select the Client Context and carry their own pending lifetime.
- `websocketHeartbeatIntervalMs` is both the Ping cadence and the Pong deadline. The Host terminates a peer that does not answer before the next interval, so a deployment whose event loop or network can stall longer than this interval must raise it.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Host calls re-read authoritative Cordis and Typert state, while Client methods, descriptors, and `$on` subscriptions mutate in one owned effect.
