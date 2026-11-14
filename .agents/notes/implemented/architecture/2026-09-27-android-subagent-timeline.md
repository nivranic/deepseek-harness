# Agent Note: Android owns child history by selected parent and view lifetime

Status: implemented

English | [中文](2026-09-27-android-subagent-timeline.zh.md)

## Problem

A child catalog belongs to the Session the user opened. Deriving its parent from Session list ordering can display another parent's children. Replacing a child view without awaiting its follow and page cleanup leaves observations running after navigation. A stored child's readability also differs from whether its parent Agent is live.

## Decision

The companion publishes catalog parent, progress, rows and parent availability together. Selecting another parent invalidates old reads before publishing the empty new listing. Refreshes have independent generations; cancellation returns the current listing to idle, while failure retains only that parent's accepted rows. Catalog requests run in a supervised model lifetime so a read failure cannot cancel unrelated UI work. Wire parsing rejects malformed or duplicate child identities and unsupported row variants.

Only a child row in the current parent's catalog can open a timeline. Diagnostic rows and stale-parent callbacks do not dispatch. `parentAvailable` describes a live parent Agent and never denies stored history. The view exposes only reconnect and older-page reads through a private Session model, preserving its bounded journal and parent-addressed paging. It exposes no prompt or cancellation method.

Child replacement, parent selection, return navigation and Host-model teardown own asynchronous retirement. A replacement waits for both follow and page cleanup; synchronous close invalidates a waiting replacement. Retired views cannot reconnect or page. The UI renders a child only while its parent matches the ordinary Session selection and follow support remains available.

The [Session history decision](2026-08-18-session-history-and-event-transport.md) retains protocol and Host activation ownership: ordinary Session follows may promote the parent after the first snapshot, while direct child follows remain cold. The [native journal decision](2026-09-26-android-native-view-location.md) retains page limits, cursor recovery and fixed-cut semantics. The [operation decision](2026-09-27-android-operation-capabilities.md) retains support checks and Host authorization. These decisions remain active; native child-view ownership does not replace them.

## Alternatives considered

**Select the first Session row.** Sorting and refresh are unrelated to the user's open Session and can silently change the parent.

**Expose the full child Session model to Compose.** Its command methods would make a read-only view depend on presentation discipline. The wrapper exposes only the operations that child history permits.

**Require a live parent or discard cancelled jobs immediately.** Durable child ownership permits cold reads. Cancellation requests do not prove transport cleanup has finished, so observation replacement must await retirement.

## Consequences

Core tests hold catalog, follow and page completion to verify stale-result rejection and awaited retirement; they also cover cold-parent availability and malformed wire rows. The installed Activity reads a selected parent's cold children through a real Host, pages at a fixed cut, retains rows on catalog failure, reconnects after page refusal and switches parent without a child Agent or business mutation. Ordinary parent promotion remains visible in the scenario. The native view retains raw event summaries; nested browsing, child continuation, physical-device layouts and Swift adoption remain separate work.
