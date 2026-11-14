# Agent Note: Job failures carry the shared Remote failure class to the client

Status: implemented

English | [中文](2026-09-20-jobs-failure-class-threading.zh.md)

## Problem

A failed background job reached the client only as `detail` — a producer-flattened string. The shared Remote failure classification could not drive the jobs surface: by the time `SessionJob` crossed the wire, the class was gone.

## Current upstream boundary

The classification (`RemoteFailureClass` from `@deepseek-ai/dsh-typert-protocol`) names what the user may do next; `detail` stays the producer's kind-specific fact. Tool-call error rows are deliberately not classified: they are model/tool-produced failures, not Remote failures.

## Decision

`JobOutcome` and `JobSnapshot` (packages/jobs/jobs) gain optional `failureClass?: RemoteFailureClass`; the local registry carries it from settlement onto the snapshot; `jobView` projects it into `SessionJob`; ui-jobs' failed rows show class copy when present (four new locale keys) with the raw detail retained in the tooltip. Producers supply the field from their caught Remote error via `classifyRemoteFailure`; no existing producer is forced to change (the field is optional and absent for non-Remote failures).

## Alternatives considered

Classifying from `detail` text in ui-jobs was rejected: the flattened string has no stable code to classify. Deriving the class inside `jobView` from nothing was impossible for the same reason — the class must originate where the Remote error is caught, at the producer.

## Consequences

The wire gains an optional field on `SessionJob` — additive, no consumer breaks. Producer adoption is incremental; until a producer supplies the class, jobs show exactly what they showed before. Docs subsystem type blocks (en+zh) mirror the extended interfaces; ui-jobs 22/22 and jobs-local 66/66 cover presentation and registry carry.
