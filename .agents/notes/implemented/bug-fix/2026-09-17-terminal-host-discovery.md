# Agent Note: Terminal Host discovery failures

Status: implemented

English | [中文](2026-09-17-terminal-host-discovery.zh.md)

## Problem

Retrying unsupported protocols or invalid discovery indefinitely presents an application incompatibility as a transient outage. Business callers need a settled failure instead of waiting for a generation that cannot be admitted.

## Decision

The [Gateway Client](../../../../packages/api/gateway/src/client/index.ts) classifies generation failures: unsupported Host/Gateway protocols and missing required discovery capabilities become `incompatible`; invalid discovery and a withdrawn preparation owner become `fatal`. Classification applies to establishing the shared generation, not ordinary failed business calls.

The [Connection controller](../../../../packages/client/connection/src/client/connection.ts) invokes classification after source settlement and pauses using its existing retry wait. Explicit reconnect or browser network change releases that wait. Cancellation cannot replace a requested reconnect or offline state with a late failure. Unclassified failures retain [continuous recovery](2026-09-05-continuous-client-recovery.md); this decision narrows that note's retry policy without replacing its deadlines, cleanup requirements or single scheduler.

Settings displays localized remediation and manual reconnect, including in the collapsed rail. Gateway refuses business admission until discovery and event readiness succeed again. This adds no Session events, durable mutation queue, new transport or authorization.

## Alternatives considered

**Classify inside Connection.** Connection must not depend on Host discovery error codes owned by downstream API packages. Its callback receives a failure and returns only the lifecycle classification.

**Retry every failure.** Unsupported protocols and malformed discovery cannot become usable through repeated identical requests; explicit intervention provides an actionable state without discarding ordinary outage recovery.

## Consequences

Manual retry repeats discovery and never bypasses admission. A network transition may recheck the same failure. HTTP authentication rejection follows the [browser-authentication decision](../architecture/2026-08-24-browser-token-authentication.md). Delayed Host readiness follows the [continuous recovery decision](2026-09-05-continuous-client-recovery.md). Device revocation remains separate work; these two states do not claim complete Connection UX or device enforcement.

## Testing

Controller tests cover suspension without active timers, manual recovery and reentrant stop/reconnect/offline listeners. Gateway tests prove classified failures deny both unary and stream calls before carrier dispatch. Component tests cover localized instructions in the collapsed rail. Recorded Question scenarios launch `dsh --profile web`, inject unsupported or malformed discovery versions, verify no automatic retry, recover through the visible action and compare the complete persisted Session and workspace with the unchanged fixture.
