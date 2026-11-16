# Agent Note: The diagnostics snapshot carries its source revision

Status: implemented

English | [中文](2026-10-05-diagnostics-source-revision.zh.md)

## Problem

Section 42 names the product SHA as a mandatory diagnostics fact, but `DiagnosticsSnapshot` carried only `productVersion`, and the recorded remaining work stated the SHA field was absent because the build-injection seam was undecided. A snapshot without a revision cannot tell a support consumer which exact source produced the Host it is looking at.

## Decision

Add `sourceRevision` to `DiagnosticsSnapshot`, read per `describe()` call from `process.env.DSH_BUILD_REVISION`, falling back to the literal `'source-tree'` when no release process stamped the environment. Reading the environment inside the call — not at module load — keeps the value live for a launcher that stamps before the first describe, and keeps the emitted library bytes free of any inlined revision, so a stamped and an unstamped build of one commit produce identical bytes and the sealing pipeline never needs a replaced-build-outputs entry for this field. The injection responsibility belongs to the release launcher (§56 flow); the source launch path honestly reports `source-tree`. The §42 key-set assertion test now pins the new field, and a new case exercises both the fallback and a stamped revision.

## Alternatives considered

A tsdown `define`-inlined constant would make the revision a build-time fact, but every commit would then produce different library bytes for unchanged sources — exactly the incremental-emit variance the sealing replacements were adjudicated to avoid. Reading `.git` at runtime would report something useful in a checkout but misreport or fail inside packaged desktop artifacts. Env-per-call keeps the field honest in every deployment shape at the cost of trusting the launcher to stamp it.

## Consequences

Every `hostDiagnostics/describe` payload now identifies its producing revision when launched by a stamping release flow, and self-identifies as `source-tree` otherwise. The tool-cordis api-catalog was regenerated for the extended interface. Wiring an actual stamp into the desktop release launcher remains §56 open work; the telemetry exits of §44 remain open as before.

## Open follow-ups

Stamp `DSH_BUILD_REVISION` in the desktop release build flow; §43 support-bundle and §44 per-type telemetry remain the recorded §42-family opens.
