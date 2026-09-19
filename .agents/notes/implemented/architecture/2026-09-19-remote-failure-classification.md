# Agent Note: Shared Client classification of Remote failure codes

Status: implemented

English | [中文](2026-09-19-remote-failure-classification.zh.md)

## Problem

The Remote failure vocabulary is merge-extensible and carried one stable code per failure, but every Client surface that needed recovery semantics re-derived them from ad-hoc code lists. The Gateway client's `classifyFailure` hardcoded six codes into connection phases; UI packages scattered further `.code ===` branches (`session/steer-unavailable`, `session/not-found` families, `version-conflict`) with no shared notion of which codes mean the same thing. Specification section 45 requires every Client to present one code with the same semantics, and section 18 requires matching recovery UX per connection phase, so the mapping cannot stay per-consumer.

## Current upstream boundary

The official baseline keeps the failure vocabulary in `@deepseek-ai/dsh-typert-protocol` (`RemoteError`, `remoteErrorOf`, merge-extensible `RemoteErrorDetailsMap`) and leaves presentation policy to consumers. This task's sealed increments added the compiler-independent inventory, the formal draft-2020-12 envelope schema, and the generator gates; none of them defined client-side semantics.

## Decision

`src/failure-classes.ts` in `@deepseek-ai/dsh-typert-protocol` owns one closed classification: `classifyRemoteFailureCode(code)` and `classifyRemoteFailure(error)` map codes onto `RemoteFailureClass` — `authentication`, `permission`, `host-state`, `compatibility`, `carrier-invalid`, `transport`, `conflict`, `unavailable`, `unknown`. The map deliberately lists only codes with agreed cross-Client meaning; the merge-extensible vocabulary resolves everything else, including every future code, to `unknown`. The vocabulary owner is the classification owner so every Client — TS now, Swift and Kotlin when they adopt the contract — reads one source instead of duplicating lists.

The Gateway client's `classifyFailure` now projects classes onto connection phases (`compatibility` → `incompatible`, `carrier-invalid` → `fatal`, everything else keeps the default reconnect behavior); its observable behavior for previously classified codes is unchanged and covered by the existing 133-test client spec.

## Alternatives considered

A classification table inside `@deepseek-ai/dsh-client-connection` would have required a protocol dependency on the raw carrier package; a generated classification from the JSON Schema would have to invent semantics the schema does not carry. Per-owner presentation hints would re-create the duplicated-list problem the note set out to remove.

## Contract

`classifyRemoteFailureCode` is total: any string resolves to a class, and `unknown` never alters or rejects the diagnostic. Classification grants no capability, permission, retry policy, or protocol-version admission; it only names what a Client may do next. `REMOTE_FAILURE_CLASSES` is exported read-only for verification and future native projection. `verifyRemoteFailureClassification(expected, classes)` in `scripts/verify-remote-error-model.ts` rejects any classified code missing from the declared repository inventory; `analyzeRemoteErrorWorkspace` runs it inside the `verify-remote-error-envelope` doc-sync gate, so the classification cannot drift from the vocabulary.

## Persistence

None. Classification is a pure function over failure codes; Session storage, events, and writer version 3 are untouched.

## Security

Class names carry no secrets and no authority. A hostile or newer Host sending unknown codes yields `unknown`; Clients must still present code, message, and details without executing recovery actions implied by a class. `permission` describes the Host's refusal, not a Client-side authorization decision.

## Compatibility

Existing classified codes keep their observable connection-phase behavior. New classes can be added to the closed union only with a consuming semantic; codes move into the map only when every Client can honor one meaning. Swift and Kotlin projections remain future work and must mirror this single source.

## Consequences

One vocabulary-owned classification is now the only place a code's client-side meaning can be assigned; adding a class or admitting a code is a reviewable, gate-checked decision instead of a scattered code edit. Unlisted codes intentionally read as `unknown`, so a newer Host's vocabulary degrades to opaque diagnostics rather than misclassification. The classification is presentation semantics only: Hosts keep authority, and no retry, permission, or version admission follows from a class name.

## Failure handling

`classifyRemoteFailure` resolves non-Remote values to `unknown` instead of throwing, so catch-site classification cannot mask the original failure. The inventory gate fails closed: an undeclared classified code aborts the doc-sync leaf.

## Tests

`packages/typert/protocol/tests/failure-classes.spec.ts` pins the classified codes, the opaque default for unclassified vocabulary codes and unknown future codes, and non-Remote inputs. `scripts/verify-remote-error-model.spec.ts` adds accepting and rejecting cases for `verifyRemoteFailureClassification`. `packages/api/gateway/tests/gateway.client.spec.ts` (133 tests) passes unchanged after the rewiring.

## Rollout

Exported from the protocol package root; consumers adopt incrementally. The Gateway client is the first consumer; UI copy adoption is follow-up work behind locale-owned dictionaries.

## Rollback

Delete the module export and restore the inline code lists in the Gateway client; the verifier check and its spec are independent deletions. No persisted data references classes.
