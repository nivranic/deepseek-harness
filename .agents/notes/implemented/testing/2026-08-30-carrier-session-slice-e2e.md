# Agent Note: Carrier-level session slice e2e

Status: implemented

English | [中文](2026-08-30-carrier-session-slice-e2e.zh.md)

## Problem

The Phase 1 notes deferred one acceptance item: proving the real session stack — the shipped SessionController and the Remote stream plane — reachable through the real TLS carrier, rather than through probe services bound to the carrier's test harness. Until that ran, "Native Access + Existing Gateway" was proven only against test-owned Remotes inside the carrier suite and against the desktop gateway without the carrier in the composition e2e.

The Gateway and Link package suites pin first-result coordination and authorization separately, but no shipped-composition test connected two controllers and one observer to a real Host approval. That left multi-device settlement, loser convergence, and the durable single-decision audit unproven across the complete Loader, TLS, Gateway, Remote Event, and Approval path.

## Decision

`apps/cli/tests/link-session-slice.e2e.ts` boots the shipped base + desktop composition with `DSH_HOME` and every link-backed file pinned into one temporary home. The first scenario retains the LLM-free wire core: the `remote` settings switch binds the real TLS carrier; an Ed25519 controller pairs through `/link/pair`; the controller reaches the real `session/list` owner through the shared `/api` chain; the `$events` NDJSON stream opens; and `$events/result` is refused with `forbidden`/`approval-disabled` while the independent switch is off.

The multi-device scenario enables that switch, pairs Controller A and Controller B through the same live ingress, registers an Observer through the shipped Device Trust owner because the product pairing configuration grants one fixed role, and opens three device-authenticated `$events` streams. A real `ApprovalService.request` drives two rounds. Each round temporarily wraps the Host Gateway dispatch method: both signed controller answers must pass Link interaction validation, claim their respective Client generations, and reach the wrapper before either may enter Gateway settlement. The wrapper then releases A before B or B before A. The winner and the already-admitted loser both receive HTTP 200 with a void-success result, the loser receives exactly one `cancel`, and a third answer sent after settlement is refused with `forbidden`/`interaction`. Both Client deliveries leave the Gateway pending set, and the Session records one matching `approval/asked` and `approval/decided` pair carrying the winner's outcome.

Every failed round switches the dispatch barrier permanently to pass-through so answers arriving after cleanup starts cannot park, releases existing gates, and restores the Gateway spy before aborting and joining both HTTP requests. It then waits until no call that entered the wrapper remains active. Suite teardown awaits stream closure and Cordis disposal before recursively removing the known temporary home, restores the exact prior `DSH_HOME` state in every setup and teardown path, and aggregates independent cleanup failures.

## Consequences

The shipped Host path proves both controller-winning orders, observer denial, idempotent success for a loser admitted before settlement, rejection of a genuinely late answer, explicit loser cancellation, and exactly-once durable approval settlement without adding a second interaction registry or changing product scheduling. Gateway remains the sole pending-interaction owner; Link authenticates, authorizes, and claims one in-flight answer per delivered Client generation. This acceptance does not substitute for Host-to-Swift or Host-to-Kotlin execution: it pins the carrier behavior those native clients must satisfy. Prompt and model cancellation remain outside this LLM-free composition test and continue to belong to their snapshot and cross-language acceptance owners.

## Alternatives considered

Relying on the Gateway or Link package tests alone was rejected because neither boots the composition users ship. Queuing client-side answer promises was rejected because it controls request creation, not Host admission: the selected winner could settle before the loser crossed Link's pending-interaction check. Letting two live requests race without a Host dispatch barrier was rejected because scheduler order would make the asserted winner flaky. Adding a runtime pairing-role mutation solely for this test was rejected because pairing role is deployment configuration; the Observer is registered through the existing Device Trust owner while every observed event and attempted answer still crosses the real TLS carrier. Extending `desktop-composition.e2e.ts` was rejected because its cold-boot roster assertions should not own listener, concurrency-barrier, and pairing lifecycle.
