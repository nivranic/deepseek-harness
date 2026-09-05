---
description: "Anonymous per-harness-home identity for users and maintainers tracing how telemetry, feedback acknowledgement, and DeepSeek provider requests correlate records."
kind: "package-library"
---

# @deepseek-ai/dsh-anonymous-user-id

English | [中文](README.zh.md)

## Summary

Every harness home gets one anonymous id that telemetry, feedback, and DeepSeek requests attach to their records, so receiving systems can tell that records came from the same installation without learning who the user is. A private random root in `$DSH_HOME/.anonymous-user-id` (`~/.dsh` by default) derives that public UUID and a separate Session-telemetry pseudonym key; the root never leaves the identity package. The identity appears automatically the first time one of those features runs, stays stable across restarts, and is created fresh if you delete the file. Independently initialized harness homes derive unrelated identities unless an operator copies or shares the private root, and no machine or account detail goes into it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

When you want the records your installation sends out to be recognizable as coming from the same harness home — telemetry, feedback, and DeepSeek requests all carry one shared id — this package is what provides it. There is nothing to install or configure: the id appears automatically, and the shipped feedback, telemetry, and DeepSeek features already use it. Do not use it to identify a user or to join independently initialized homes; home separation assumes their private root files are not copied or shared.

### What the id does for you

Three things your installation sends out carry the same id, so records line up across all of them:

- **Session telemetry** — your telemetry exports carry the id as the `user.id` resource attribute, so a collector can group an installation's records.
- **Feedback** — each feedback acknowledgement names the anonymous installation that recorded it.
- **DeepSeek requests** — every provider request carries the `x-deepseek-harness-user-id` header, so usage can be attributed per installation.

### Observing and resetting the identity

The private root lives in `$DSH_HOME/.anonymous-user-id` (`~/.dsh` by default) as one `v1:<64 hex characters>` line. Treat the file as secret local state: do not copy its content into diagnostics or support messages. Delete it to get a fresh public id and Session pseudonym key at the next launch; the running process keeps its current derived identity until it exits. A legacy file containing a bare UUID rotates on first use because an already-exported value cannot serve as secret key material.

On POSIX, the package accepts the root only from a regular file owned by the current user with no group or other permissions. It writes a complete `0600` sibling before publishing first creation without replacement. Each rotation publishes or adopts one complete private `.anonymous-user-id.rotate` claim without replacement, verifies that the current target still identifies the inspected file, then atomically moves that shared claim onto the path; cooperating processes therefore adopt one seed, and a complete claim left by an interrupted process can finish on a later launch. An oversized private regular root is treated as corrupt and rotates without a content read. A symlink, non-regular path, failed check, invalid claim, or unreadable path detected before publication is not replaced and receives a shared-claim or process-local root instead. On Windows, Node.js mode bits cannot validate the file's DACL: the package still rejects symlink-shaped and non-regular final paths, but a fresh file inherits the harness home's DACL. Protect the directory before using a custom `DSH_HOME`.

### Using it in your own package

When you build a feature that should share the installation's anonymous id, import the value once and reuse it — telemetry, feedback, and DeepSeek already use the same id, so your records line up with theirs:

```ts
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'

const userId = getOrCreateAnonymousUserId() // stable for the process lifetime
```

The value is stable for the process and matches what the built-in features use; it changes only when the root rotates or a later launch creates a replacement. Infrastructure that needs Session correlation uses `getOrCreateAnonymousIdentity().pseudonymizeSessionId(id)`: the returned function is pure after construction and never exposes the root or its derived key. Even when the home directory cannot be written, the identity still works for the current run, so records keep flowing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One random root, domain-separated outputs.** A 256-bit `crypto.randomBytes()` root derives the public UUID and the private Session pseudonym key under distinct HMAC labels. Neither value comes from the hostname, network address, git remote, or another identifying source, and the exported UUID cannot derive Session pseudonyms.
- **Private at rest and through the API.** POSIX reads require current-user ownership and no group/other permissions; first creation and the shared rotation claim publish only complete private inodes. The API returns only a public UUID and a purpose-specific pseudonym function.
- **Synchronous and memoized.** Each process resolves the stored identity once: reads and writes are synchronous, and the result is memoized per resolved file path.
- **Best-effort persistence.** A write failure still returns a usable id for the run, so telemetry and feedback never block on an unwritable home.
- **Library, not plugin.** There is no Cordis plugin entry or config; the invariant companion installs an empty installer because the package owns no event stream or public mutable relation to compare without creating the id as a side effect.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Library entry: private-root persistence, domain-separated derivation, `getOrCreateAnonymousIdentity`, and the public-id wrapper |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion with an empty installer (no runtime invariant; the only relation is private and side-effecting) |
| [`tests/anonymous-user-id.spec.ts`](tests/anonymous-user-id.spec.ts) | Exercised behavior: deterministic vectors, legacy rotation, persistence, permissions, concurrency, and memoization |
| [`tests/invariant.spec.ts`](tests/invariant.spec.ts) | Companion registration through the invariants service |

### The API

`getOrCreateAnonymousUserId()` returns only the derived public UUID. `getOrCreateAnonymousIdentity()` returns that UUID plus a Session-specific pseudonym function; neither API returns the root seed or derived key. Exact signatures, test seams, and defaults live in `src/index.ts`.

### Storage contract

The file named by `ANONYMOUS_USER_ID_FILE_NAME` contains one versioned 256-bit seed line. First creation writes and flushes a random owner-only sibling, publishes its inode with a hard-link no-replace operation, removes the sibling name, and safely rereads the published winner. Rotation writes the same kind of sibling and publishes or adopts it at the deterministic `.anonymous-user-id.rotate` claim through the same no-replace operation. Every cooperating rotator checks the target immediately before atomically moving that one claim onto its path; a loser safely rereads the winner, while a complete claim left by process termination remains usable by the next launch. POSIX rejects exposed ownership or mode before reading content, and every platform rotates an oversized regular root without reading its contents. A rejected target or invalid claim detected by these checks is not modified; the process uses the shared claim when safe and otherwise falls back to unpersisted material. Memoization is keyed by resolved file path, so each home resolves independently and the hot-path pseudonym function performs no I/O; homes that intentionally share or copy the same private root derive the same identity.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the identity group map to the home-path resolution this package builds on and the features that use the id.

- [identity group map](../README.md) — the sibling packages and group scope.
- [dsh-home-paths](../../util/home-paths/README.md) — owns `$DSH_HOME` and `~/.dsh` resolution.
- [dsh-session-telemetry-otel](../../session/session-telemetry-otel/README.md) — reports the id as the OTel Resource `user.id`.
- [dsh-command-feedback](../../feedback/command-feedback/README.md) — embeds the id in the feedback acknowledgement.
- [dsh-llm-deepseek](../../llm/llm-deepseek/README.md) — sends `x-deepseek-harness-user-id` on provider requests.
- [Session telemetry subsystem](../../../docs/subsystems/session-telemetry.md) — the telemetry seam and its backend contract.

-----

<a id="model-experience"></a>
## Model Experience

None, as the shared identifier reaches DeepSeek only as model-hidden HTTP metadata and registers nothing model-facing.

#### KV Cache effect

None; the transport header changes neither tokens nor the model-visible prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits describe when the id is a poor fit or needs special attention. They are current package constraints, not a general comparison of anonymity approaches or a task backlog.

- **No recovery after deletion** — losing the file mints a new anonymous identity by design; recovery would require stable derivation material that weakens anonymity.
- **Unsafe initial paths lose persistence** — an initially rejected target, invalid rotation claim, or claim-publication failure uses an unpersisted process root and leaves that target unchanged. After a valid claim exists, detected target-check or rename failures retain and use the shared claim.
- **Home writers remain trusted** — Node has no cross-platform compare-and-replace operation keyed by a file's device and inode. A process that can modify the harness home can replace the identity or claim directory entry between the final check and rename; rename does not follow a symlink or write its referent, but it can replace that directory entry. Protect the home directory from other users and untrusted processes.
- **Interrupted staging can leave private residue** — termination before cleanup can leave an owner-only random `.tmp` sibling. Identity resolution ignores that name; an operator may remove it after verifying that no harness process is starting.
- **Windows privacy depends on the home DACL** — Node.js file mode bits do not prove a Windows ACL; fresh files inherit the harness home's protection, so operators must secure a custom `DSH_HOME`.
- **No automatic cross-home identity** — independently initialized `$DSH_HOME` values are unlinkable; copying or sharing the private root intentionally gives them the same identity.
- **Configured DeepSeek gateways receive the id** — `dsh-llm-deepseek` sends the stable header to its resolved `baseURL`, including deployment overrides, independently of telemetry sharing mode.
- **Deleting the file does not reset the current process** — memoization keeps the run's id until the next launch.
- **Legacy identity rotates once** — a pre-versioned bare UUID was already public, so its first read creates a new private root and therefore a new public id.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
