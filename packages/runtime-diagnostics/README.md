---
description: "Package map for runtime self-diagnosis: the registry service that runs package-owned invariant checks inside a live composition."
kind: "package-group"
---

# runtime-diagnostics/ — runtime diagnostics family

English | [中文](README.zh.md)

## Summary

The `runtime-diagnostics/` group self-checks a running composition: `invariants` is the registry service that runs package-owned `./invariant` companions — the checks a package ships to verify its own durable relationships between authoritative event streams and mutable snapshots — and reports each failure as an `InvariantError` attributed to the owning package. The standard agent composition mounts it with the core companions, and loading the service alone installs no checks.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`invariants/`](invariants/README.md) | The registry that runs package-owned invariant companions and attributes each failure | `ctx.invariants` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Core subsystem reference](../../docs/subsystems/core.md) — the `ctx.invariants` registry surface and the durable relationships the checks verify.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
