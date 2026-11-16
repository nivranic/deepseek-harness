# Agent Note: A pending Host Question stays scoped to its own saved Host on the physical Android lane

Status: implemented

English | [中文](2026-09-30-android-host-question-isolation.zh.md)

## Problem

Section 28 recorded "Question 与待确认输入跨主体隔离有 core 证据" — the cross-principal isolation of a pending Question had only core-level (unit/JVM) evidence. The existing physical acceptance lanes covered either two saved Hosts with prompt drafts only (`android-host-roster.e2e.ts`) or a Question with a single Host (`android-companion-question.e2e.ts`), so no device-run proof existed that one Host's pending Question and its answer draft stay invisible, unanswered, and unretained while another saved Host is selected on the same application and the same Session id.

## Decision

- The acceptance op vocabulary gains `assertNoQuestion`: it opens the interactions tab, waits for the watch stream's `ready` frame (client id set — the Host snapshot settled), then asserts the submit-answer control is absent, no pending interaction remains in the model inbox, and a caller-named question text never renders. Waiting for readiness before asserting absence keeps the check immune to a not-yet-arrived event.
- `android-host-question.e2e.ts` pairs the isolated acceptance application to two real Hosts (plain scaffold A; scaffold B replaying the recorded Question turn) sharing one Session id and verifies, on `emulator-5554`: A never exposes a pending interaction; B raises the Question; selecting A hides the Question card, options, and draft; returning to B restores the Question with the retained draft; a different process restart restores both; the draft submits once through B only (`$events/result` dispatched exactly once to B, never to A), completing B's recorded turn while A receives no prompt and no reply; after the answer the retired Question still never appears on A; each Host retains exactly one device grant.
- The lane asserts reply delivery at the Host boundary by spying each scaffold's raw `dispatchRpc` for device-signed `$events/result` calls, mirroring the roster lane's `session/prompt` business spy, so "answered only its own Host" is Host-side evidence rather than device-side inference.

## Alternatives considered

- **Extend the roster lane with Question steps:** one lane would then own both the switch/restart matrix and the Question matrix, lengthening an already 240-second acceptance and mixing two golden narratives; a sibling lane shares the scaffold pattern with a focused golden.
- **Assert absence without waiting for stream readiness:** a plain `assertDoesNotExist` can pass before the Host snapshot arrives and would not distinguish isolation from timing; the ready-frame gate makes absence meaningful.
- **Drive the turn through a browser client as the single-Host lane does:** the roster lane already proves the device composer can raise a recorded replay turn; keeping this lane browser-free keeps the evidence about the device alone.

## Consequences

- Section 28's Question cross-principal item now has physical-platform evidence: isolation holds across Host selection, process restart, and reply, with single-Host dispatch confirmed on both scaffolds.
- Any regression that leaks one Host's pending interactions into another selected principal's models (inbox, UI, or persisted answers) fails this lane.
- The acceptance remains emulator-bound (`emulator-5554`, `nativeacceptance` application id, replay fixture); real physical hardware and push delivery stay outside this lane per the established authorization boundary.

## Open work

- The approval (`允许一次/拒绝`) interaction kind shares the same inbox and the same per-principal models; this lane exercises the Question kind explicitly, approval cross-principal isolation rides on the same mechanism without a dedicated physical lane.
- Background/push behavior and full Session location metadata remain open section 28 items.
