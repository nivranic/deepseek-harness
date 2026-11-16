# Agent Note: url_fetch lands as the third Lite local executor

Status: implemented

English | [中文](2026-10-21-url-fetch-local-executor.zh.md)

## Problem

Gen-62 landed the first two on-device executors with a pairing rule — an executor without a device schema is only hallucination-reachable — and deferred `url_fetch` on "endpoint policy and the §54 network matrix". The re-survey measured both blockers away: §54's text (original-specification.md 2036-2054) is a thirteen-condition Client↔Host link matrix with no overlap with tool-initiated outbound fetches, and the real gap was the URL trust domain — the model controls the target URL, which is not the user-configured LLM endpoint `validateLiteEndpoint` governs. Without the executor, the device declaration (moderate, empty permissions, supportsLite) sat AllowLocal-gated with no dispatcher behind it.

## Decision

Land the executor with its policy as code. The schema entry joins `lite-device-tool-schemas.json` (`{url: string}` — the conformance fixture already pins the call shape) with the four policies stated in its description. `LiteToolExecutors.urlFetch` is a suspend function on the IO dispatcher (the loop collects on the main dispatcher; a blocking fetch would ANR): arguments parse, the URL must be https (the app layer's clean refusal ahead of the platform cleartext ban), and the host must resolve outside the private-network vocabulary — `isAnyLocalAddress`, loopback, site-local, link-local, the fc00::/7 unique-local prefix, and the IPv4 tail of IPv4-mapped/compatible IPv6 addresses (the JVM predicates do not see through the mapping; the embedded address recurses through the same vocabulary). A connect-time `PrivateNetworkRefusingDns` re-checks the exact addresses OkHttp dials, closing the DNS-rebinding window between the pre-flight resolution and the connection. The fetch runs on an independently owned client — never the provider's endpoint-bound stream client — with the bounded unary profile the stream shape forbids (connect 10 s, read/call 30 s) and redirects never followed: a 3xx answers its Location target unfollowed so the model re-calls url_fetch itself. A 2xx passes the textual Content-Type gate (any `text/*`, the json/xml/yaml/javascript application subtypes plus `+json`/`+xml` suffixes; a missing header is refused) and a 256 KiB bounded read (`URL_FETCH_CONTENT_LIMIT_BYTES`, named beside `ARTIFACT_CONTENT_LIMIT_BYTES` at the same value) before its decoded text becomes the outcome. Every refusal is fail-soft Chinese prose; the unknown-host message matches the conformance fixture's pinned wording verbatim. The MainActivity `when(name)` gains the pure branch; the device declaration and the manifest are untouched — INTERNET already held and targetSdk 36's cleartext ban already stands.

## Alternatives considered

Following redirects with per-hop re-validation was rejected — the unfollowed redirect answers the Location verbatim and lets the model decide, at zero re-validation cost. Reusing the provider's OkHttpClient was rejected: it is endpoint-constructor-bound with the streaming read/call=0 profile that would let one fetch hang a turn. A single pre-flight address check without the connect-time Dns backstop was rejected — DNS rebinding is the classic bypass of exactly that check. Making the evaluation reachable over the network in JVM tests was rejected — https-only plus the private refusal makes a local 2xx path unreachable, so the response evaluation is an internal pure seam tested offline (redirects, statuses, the type gate, the cap boundary) while the network surface tests the policy refusals that are deterministic (thirteen private-address literals including ULA, mapped, and metadata endpoints; `example.invalid` → the pinned DNS failure wording).

## Consequences

The model can now direct the device to fetch a text page — the third of five local names live — behind an SSRF posture stronger than the survey's floor: private-vocabulary refusal before and during dial, no redirects, https-only, a bounded read, and a textual-only gate. Real-site acceptance stays e2e territory (the JVM suite pins the policy refusals and the evaluation seam; no live https round is claimed). Core JVM tests: 579 -> 587 (LiteToolExecutorsTest 7 -> 15). The known `LiteHTTPProviderTest` truncation flake surfaced in two of four full rounds and passed on the final round — the pre-existing one-in-six flake already named in the relay-retirement note, untouched here.

## Open follow-ups

`image_inspect` and `attachment_read` remain without intake producers; the tool-row journal persistence stays a chapter-64 decision; the paired-host catalog pull's real-Host e2e and hot-refresh UI stay open from gen-64's ledger.
