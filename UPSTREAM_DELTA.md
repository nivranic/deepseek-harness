# Upstream difference review

Status: IN_PROGRESS. [The baseline](UPSTREAM_BASELINE.md) fixes the adopted and newly fetched official commits. [The machine snapshot](UPSTREAM_DELTA.json) lists every changed path, each critical ownership area, and preserved worktree state; [the inventory](CUSTOM_CAPABILITY_INVENTORY.json) does not label unreviewed groups as accepted.

## Official ownership

The adopted official Desktop main entry and manifest remain unchanged in the downstream comparison. The personal shell is a separate application directory, not evidence of an independent Agent or Session authority. Its build entry, package closure, runtime/profile identity, update behavior, process targeting, and storage interactions require their own verification.

The fetched official revision contains responsive drawer and worker/module-loading improvements absent from `dev`. Adopt or adapt the complete owning changes and their consumers rather than copying only a component or maintaining a second implementation. The official drawer threshold differs from the specification's suggested four-band layout; source adoption alone does not establish every required viewport and input behavior.

## Confirmed retained defects and missing behavior

| Subject | Status | Observation |
|---|---|---|
| Native event folds | IN_PROGRESS | Kotlin and Swift consumers retained obsolete result nesting and Assistant event names after Host schemas changed; local Kotlin and shared contract regressions now pass, Swift execution remains open |
| Remote test composition | PASS | Gateway's required Remote Access service was missing from the downstream test compositions; mounting the real service restores dispatch coverage |
| Device revocation | PASS | Trust-store changes now notify the carrier, which terminates the revoked device's active responses; direct-store and carrier regressions pass |
| Desktop Client bundle config | IN_PROGRESS | Corrected the package-directory argument; 95 packages now pass dependency policy. Full bundling additionally exposed official Desktop's incorrect concurrent workspace membership |
| Phone layout | FAIL | Current `dev` retains a space-consuming sidebar instead of the required phone overlay |
| Smoke rendering | IN_PROGRESS | Removed the query-controlled global overlay-hiding stylesheet after two negative controls failed; all 13 boot tests pass, browser/packaged UI evidence remains open |
| Approval context | FAIL | The shared request/presentation does not guarantee Host, workspace, risk, and escalation facts |
| Artifact/diff bounds | FAIL | Whole-artifact decoding and direct diff-row rendering do not establish bounded paging/virtualization |
| Handoff semantics | FAIL | The retained Lite snapshot operation creates a Session and queues executable work; it is not view-location transfer |

These findings do not all originate in the latest merge. The review distinguishes retained downstream behavior, merge adaptation defects, newer official changes, and requirements not implemented on the current branch.

## Session and interaction comparison

The inspected official delta does not change the Host gateway settlement, timed-question/approval ownership, Client connection recovery, or Session persistence/migration implementations. Updating upstream is necessary but does not by itself close the durable-approval, general-idempotency, or semantic-connection-state requirements. Timed questions already have genuine Host-log-derived recovery; the review does not mislabel all interactions as non-durable.

Live gateway invocations survive individual Client disconnects while the Host process remains alive. Settlement is first-wins, with late results treated as no-ops rather than a closed-interaction error. General approvals remain live waterfalls with asked/decided audit events rather than a reconstructible pending approval. The browser request path inspected performs one POST and does not silently buffer/replay prompts offline.

There is no tracked `packages/client/runtime` at either exact revision. Its proposed name must not cause a parallel runtime package to be introduced: current Client data ownership is in Connection and the Session/Workspace controller clients. Adopt official Cordis event-adapter changes with their Cordis upgrade, and shared command resolution with its consumers, rather than copying isolated compatibility fragments.

## Settings, credentials, and local Web comparison

Downstream Settings and Credentials match the adopted official revision. The inspected newer official delta changes only two Settings presentation-policy key expressions, from service/entry objects to their Cordis fiber contexts; adopt them with the corresponding Cordis upgrade and real provider consumers. Credentials and the Webserver have no executable change in that official range. The downstream Webserver differences in this comparison are documentation-only.

The local Web request trust owner remains Connection, not Webserver resource reading. Its Host/DNS-rebinding, same-Origin, Fetch-Metadata, launch-token, and signed-cookie fences remain intact in the inspected source; local behavior verification is recorded separately. The shared credential shutdown reconciliation finding is recorded in the security report rather than attributed to the downstream merge.
