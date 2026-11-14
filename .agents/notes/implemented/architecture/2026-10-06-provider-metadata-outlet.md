# Agent Note: Provider calls leave per-call metadata through the ops telemetry outlet under their own consent kind

Status: implemented

English | [中文](2026-10-06-provider-metadata-outlet.zh.md)

## Problem

Section 44's five telemetry kinds left providerMetadata as the last one with a local seam but no egress. A provider call's metadata — the response `x-request-id`, HTTP status, retry-after, duration — was readable only inside the DeepSeek adapter, and the adapter read the request id only on the failure path. Attribution headers (the outbound `User-Agent` and identity headers the harness sends to providers) had accumulated a deferred semantics question: are they telemetry? And usage already leaves through the session ledger (`assistant/message` events under the sessionTelemetry kind), so a provider kind that also carried tokens would double-export the same facts.

## Decision

1. **Attribution-headers ruling: not telemetry.** `attributionHeaders()`/`APP_IDENTITY` and `x-deepseek-harness-user-id` are static product facts on the request path to the provider — they never travel to a collector, they are not observations, and they are not counted under any telemetry kind. The ruling is recorded here and in the §44 remaining text.
2. **Usage disjointness ruling.** `TokenUsage` rides `assistant/message` events into the sessionTelemetry ledger outlet (`agent-loop/src/agent.ts` both the interrupted and normal append paths). The providerMetadata record therefore never carries usage or tokens; the two kinds export disjoint facts of the same call — the session kind the conversation, the provider kind the call.
3. **Producer** (`packages/llm/llm-deepseek/src/adapter.ts`): the adapter is the only place that sees response headers, the structured failure fields, and the call's start and end together — the `llm/llm` core sees a normalized failure (headers already dropped) and the agent loop sees no HTTP detail and would miss compaction/title direct calls. A `resolveTelemetry?: () => TelemetryOwner | undefined` thunk on `DeepSeekAdapterOptions` (wired in `index.ts` to `ctx.get('sessionTelemetry')`, the `resolveAttachments` shape) resolves the owner at emission time — cordis row order carries no load semantics, and consent on the backend is frozen at its own construction, so restart semantics hold. One ops record per completed call from the `streamWithConnection` settlement point: `{op:'llm-provider-call', provider, model, purpose?, ok, status?, requestId?, retryAfterMs?, durationMs?}`, severity info on success and warn on failure, `attributes['telemetry.op']='llm-provider-call'` and `session.id` when known. Never usage, message content, baseURL, or key material. The success path gains one `requestId(response.headers)` read (previously failure-only); transport-level failures have no headers and leave the fields absent. Thunk absent or kind withheld: silent zero calls, zero exceptions, adapter behavior unchanged.
4. **Outlet** (`packages/session/session-telemetry-otel`): the construction gate widens to four kinds (`sessionTelemetry || crashDiagnostics || deviceTrustMetadata || providerMetadata`); ops emission is created when any ops-producing kind is on; the self-draining fiber owns any non-session composition; `mode: DISABLED` stays the master breaker.
5. **Zero runtime dependency**: `dsh-session-telemetry` is a type-only dev dependency; the owner interface is local to the adapter, the kind check a local `providerMetadata === true` specialization naming `telemetryKindAllowed` as the authority, per the crash and device-trust precedents.

## Alternatives considered

- **Producer in the `llm/llm` core**: rejected — its peer surface is cordis-only by design, and its adapter-failure normalization point has already dropped the response headers.
- **Producer in the agent loop**: rejected — it cannot see HTTP detail, and binding the outlet to the loop would miss `ctx.llm.stream()` direct callers (compaction, session titles, web search).
- **Failures-only emission**: rejected — the success request id and duration have no other outlet, and transport-level failures carry no provider facts at all; per-call records are the minimal honest surface, with volume bounded by the §44 default-off consent.
- **Construction-time owner snapshot**: rejected — bundle row order carries no load semantics; emission-time probing is free and order-free (the device-trust generation's written argument).
- **Carrying usage summaries**: rejected under ruling 2 — double export of the same facts under two kinds.

## Consequences

A deployment that opts the provider kind in now reports one metadata record per provider call off-process through the ops scope, with load-time validation applying as for the session kind; the base bundle comment now names relayMetadata as the only kind still without a producer. Frequency is bounded by the default-off consent: opting in is a deployment's explicit choice to export per-call volume. The lockfile additionally normalizes one importer entry to sorted position (a pnpm re-sort, no dependency change). The loader-composition e2e pre-existing baseline failure remains pinned as an open channel.

## Open follow-ups

- relayMetadata outlet (blocked on §23).
- A `DSH_TELEMETRY_CONSENT` setter for the loader-composition e2e (open channel above).
- §56 build-revision injection wiring.
