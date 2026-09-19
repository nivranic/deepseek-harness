---
description: "Host and Client workspace control: mutate workspace navigation and follow its complete projection."
kind: "package-reference"
---
# Workspace Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-workspace-controller` owns the Host `ctx.workspaceController` service and the generated Client `ctx.remote.workspace` namespace. Its Remote methods create, rename, remove, and reorder Workspaces, reorder Sessions within a Workspace, archive Sessions from Workspace navigation, and follow the complete Workspace projection. Use it through API Gateway when a Client must change or follow Workspace navigation. The package also owns `ctx.directoryPickerController` and the generated `ctx.remote.directoryPicker` namespace, because the directory-picking seam it carries is abstract and never a Loader entry of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Host controller serializes mutations whose correctness depends on current registry state and throws `RemoteError` with a stable `workspace/*` or `directory-picker/*` code for expected failures. Its `follow()` stream synchronously attaches to durable Workspace changes, emits one complete baseline first, then emits ordered `upsert`, `remove`, `order`, and `archived` increments. A reconnect starts another generation with a replacement baseline, so consumers do not depend on receiving every increment while disconnected.

The pure `/capabilities` entry declares independent `workspace.follow.v1`, `workspace.manage.v1`, and `workspace.sessions.v1` operation sets. The Host advertises these through its Typert binding; application admission requires the exact set before dispatch. Session management does not authorize Workspace registry or archive operations.

Directory Picker uses the same pure declaration entry for `directory-picker.native.v1`, `directory-picker.browse.v1` and `directory-picker.create.v1`. A native backend advertises only native picking; a browse backend advertises listing and creation independently. An unknown extension kind advertises none of these operations. The backend capability is stable for its Service lifetime, so replacement rebuilds the declaration with the controller. Filesystem access remains a Host check at invocation.

Directory creation rejects invalid input as `gateway/bad-request` with [portable validation diagnostics](../../typert/protocol/README.md) before invoking the filesystem capability.

The Client entry provides `ClientWorkspaceModel` and `createWorkspaceStateStream()`. The model owns rows, registry order, archive ids, and stream/unary race resolution. Within one connection, a newer row wins by `updatedAt`, a committed stream order outranks an older unary echo, and delayed data cannot revive a removed id. Host snapshot replacement clears this projection and its deletion/order authority; late unary results return `gateway/cancelled` without changing the replacement projection. This does not undo an already dispatched Host mutation.

Unknown capability discovery keeps the model loading; explicit absence of follow support settles it as `unavailable` without opening a follow stream. Gateway owns waiting and recovery; restoration opens a fresh baseline without a second domain restart. Snapshots and subscriptions are framework-neutral; the UI owns navigation and React hooks.

-----

<a id="model-experience"></a>
## Model Experience

None, as Workspace organization is browser and Host control state and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; Workspace mutations do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `follow()` replaces the whole projection after reconnect and has no durable cursor or incremental catch-up protocol.
- Process-local deletion markers protect only the current Host snapshot lifetime.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Workspace Registry owns persistence; every stream generation is a full projection.
