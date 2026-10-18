# Agent Note: the first Lite local tools execute on-device — calculator and artifact_create over device-authored schemas

Status: implemented

English | [中文](2026-10-18-lite-local-tool-executors.zh.md)

## Problem

The union catalog of gen-60 declared five local names `AllowLocal`, but two gaps kept every call hollow. The production `LiteToolExecuting` was a stub folding `ok=false` with empty text, and — the prior generation's scouting found — the five names were model-unreachable altogether: the schemas document carried exactly one tool (`web_search`), the provider injects whatever rows it holds with no name filtering, so no request ever advertised the local tools. An executor without a schema is callable only by a hallucinating model. Section 49.3 phases built-in Lite tool execution as P2 ("先稳定 Remote Contract") — the ledger's Lite track nonetheless carried the executors as its top open item, and the honest slice was the smallest end-to-end proof of the gen-60 thesis.

## Decision

Ship calculator and artifact_create — the two names needing no permissions, no network, no intake UX — with their model-face schemas as a fifth app-owned asset (`apps/android/app/lite/lite-device-tool-schemas.json`, the same reviewable-source discipline as the device declarations; `web_search` stays out because the Host projection carries it). `LiteToolSchemaCatalog.fromBundledDocuments` unions host and device schemas behind a cross-document collision guard mirroring the declaration union. The calculator is a hand-written recursive-descent evaluator over `+ - * / %`, parentheses, unary signs and decimal numbers under one `BigDecimal` context — no new dependency. The artifact_create executor writes through the same `LiteFileArtifactStore` the chat's reading face reads, with the kind constrained to the reading face's textual closed set and the id rejected for path separators (a model-controlled id lands inside a `File` constructor). `LiteToolOutcome` gains an optional artifact fact, and the loop follows a successful artifact-carrying `tool/result` with the `artifact/created` + `artifact/status` pair — the order derived from the fold's own pairing (creation must precede status; the bytes exist only after the executor's atomic write). `MainActivity` mounts the real dispatch: the two executors, and a named refusal for anything else.

## Alternatives considered

All five executors in one generation was rejected: `url_fetch` drags its own endpoint policy (https-only gate, size cap, bounded timeouts, section 54 framing) and `image_inspect`/`attachment_read` have no intake producer in the standalone Lite face — their executors would read inputs nothing can create. Calculator-only was rejected as leaving the artifact write path — the one executor with a visible side effect — unproven. Hardcoding schemas beside the registry was rejected per the gen-52 ruling (a Kotlin-side schema authority is the parallel system the projection pattern exists to prevent); extending the host generator's boot was rejected per gen-60 (device ids must not leak into the live `tools/list` domain). Reusing a host calculator was impossible — the host catalog has none.

## Consequences

A declared local tool now runs end-to-end: device schema → model face → `AllowLocal` ladder → real executor → honest `tool/result`, and an artifact-carrying execution surfaces in the artifacts pane through the fold. The mirror test reads all four documents as one union; a future schema for a third name extends the device document and the union cross-checks hold. The remaining three local names stay declared-but-unexecuted with their refusal named (`no on-device executor mounted`); the artifact event pair lives in the driver's live fold only — journal persistence stays turn-outcome-faithful per chapter 64, matching the pre-existing tool-row behavior.

## Open follow-ups

The `url_fetch` endpoint policy and its section 54 framing; an intake decision for `image_inspect`/`attachment_read`; the result re-feeding into the next model request (P2); the remaining §31/§67 open items.
