# Agent Note: SessionTelemetryBackend anonymous user id ($DSH_HOME/.anonymous-user-id) and the OTel Resource user.id

Status: implemented

English | [中文](2026-07-31-telemetry-anonymous-user-id.zh.md)

## Problem

Session telemetry is mounted by default ([default-mount Note](2026-07-31-web-telemetry-default-mount.md)), but the OTel Resource carried only `service.name`/`service.version` — no user-level identity at all, so the collector could neither aggregate per user nor count active users. The only prior ruling on point was an unimplemented one to derive a user id by hashing the hostname/local IP. The OTel feed needed an anonymous user identity with clean semantics.

## Decision

`@deepseek-ai/dsh-anonymous-user-id` persists one private 256-bit random root in `$DSH_HOME/.anonymous-user-id` (resolved by `resolveDshHome`, `$DSH_HOME` > `~/.dsh`). Distinct HMAC domains derive the UUID-shaped public `AnonymousUserId` and the key used for Session-telemetry pseudonyms. `getOrCreateAnonymousUserId()` returns only the public value; `getOrCreateAnonymousIdentity()` returns that value plus a pure Session pseudonym function, never the root or derived key. The OTel backend carries the public id as the Resource's `user.id` once per export batch; `/feedback` and [direct DeepSeek request identity](2026-08-11-deepseek-request-user-id-header.md) use the same public value. A legacy bare UUID rotates because an already-exported value cannot become secret key material.

| Ruling | Value | Rationale |
|---|---|---|
| Identity source | Random 256-bit root, never derived from the hostname, network address, or git remote | Installation data must not make the identity reversible |
| Storage form | `.anonymous-user-id`, one `v1:<64 hex characters>` root-seed line; POSIX accepts only a current-user-owned regular file with no group/other permissions | One private source derives every public or purpose-scoped correlation value without reading exposed content |
| IO form | Synchronous IO + a process-lifetime memo keyed by resolved file path | `OpenTelemetrySessionBackend`'s constructor is synchronous (async would reshape plugin loading); one identity resolution per process, and mid-run file deletion never affects the running process |
| Concurrent first launch | Write and flush a random `0600` sibling, publish its complete inode with hard-link no-replace, then safely reread the winner | No process can observe a published partial root; a losing or failed process adopts a valid winner or keeps private in-memory material |
| Rotation | Publish or adopt one complete private `.anonymous-user-id.rotate` claim with hard-link no-replace, verify the current target, atomically move the shared claim onto its path, then safely reread | Cooperating rotators adopt one seed, an interrupted process leaves a recoverable complete claim, and legacy, corrupt, oversized, or exposed content cannot become key material |
| Windows access control | Reject symlink-shaped and non-regular final paths; fresh files inherit the harness-home DACL | Node.js mode bits cannot validate a DACL, so a custom `DSH_HOME` must be protected by its operator |
| Loss semantics | File deleted → next launch mints a fresh root and derived identities | An anonymous identity has no recovery requirement |
| Write failure | Best-effort: return the in-memory id | SessionTelemetryBackend is never blocked by a read-only home |
| Report position | Resource attribute, not per-record attributes | Once per batch suffices for Resource-dimension aggregation; per-record injection would touch the seam contract and grow the wire |
| Session correlation | HMAC under a Session-only key derived from the private root | The exported `user.id` cannot derive or dictionary-test predictable Session ids |
| semconv dependency | `@opentelemetry/semantic-conventions` is not imported | One string constant does not justify a dependency |
| Home | `@deepseek-ai/dsh-anonymous-user-id`, shared by the OTel backend, `/feedback`, and direct DeepSeek requests | Consumers share one storage contract without depending on an exporter backend |
| Separate switch | None | Any consumer can create the identity; `DSH_TELEMETRY_DISABLED` stops telemetry reporting but does not disable feedback acknowledgement or the DeepSeek request header |

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Hostname/IP-hash-derived id (the prior ruling) | Reversible means not anonymous; the random UUID is semantically clean — the user ruled to supersede |
| user.id on every record's attributes (Claude Code's shape) | Touches the session-telemetry seam contract or injects per record, growing the wire; once per batch on the Resource already aggregates |
| A shared package before `/feedback` needed the id (the first cut) | At that time the only real consumer was the OTel backend; extraction became justified only when direct feedback needed the same correlation id |
| AppCLIEntry reading the id and injecting via config patch | Every surface entry needs wiring; a runtime fact inside deployment config conflates the two |
| Housing it in `@deepseek-ai/dsh-home-paths` | paths is pure path computation with zero IO; a persisting identity capability would pollute the package boundary |

## Consequences

- One `$DSH_HOME` produces one stable public user id and one stable Session-pseudonym namespace; independently initialized homes have no linking mechanism unless an operator copies or shares the private root.
- The OTel Resource, `/feedback`, and direct DeepSeek requests share the public id, while only the identity package can produce Session pseudonyms.
- Deleting `.anonymous-user-id` resets every derived identity on the next launch; an unwritable home gives each process an unpersisted private root.
- Reading a legacy bare UUID rotates the public id once and replaces the file with versioned private material through the shared no-replace claim.
- Checks reject symlink-shaped, non-regular, unreadable, invalid-claim, and changed paths before publication; that process uses the shared claim when safe or an unpersisted root. Exposed or oversized regular files rotate through the shared claim without a content read. Node has no cross-platform device-and-inode compare-and-replace syscall: a process with write access to the harness home can replace a directory entry between the final check and rename. Rename never follows a symlink or writes its referent, but can replace that entry. Windows confidentiality and this final path integrity rely on the harness-home DACL because Node.js cannot validate it from mode bits. Process termination before cleanup can leave an ignored owner-only random `.tmp` sibling.
