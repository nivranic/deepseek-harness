---
description: "Package map for the code-execution family: the abstract ctx.codeRuntime seam, the shipped Node-worker TypeScript backend, and the fd-3 wire protocol a CPython backend speaks."
kind: "package-group"
---

# code-runtime/ — code execution family

English | [中文](README.zh.md)

## Summary

The `code-runtime/` group runs one model-written program at a time against host-provided bindings: `code-runtime` defines the abstract `ctx.codeRuntime` seam, where one request resolves to `{ value, logs, error? }` with failures included as result fields, `code-runtime-worker-thread` is the shipped TypeScript backend that runs each program in a fresh Node worker, and `code-runtime-python` owns the fd-3 wire protocol shared by the host and any CPython backend. PTC mode in `dsh-tools` mounts the seam with a backend so model-written programs can compose tools.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`code-runtime/`](code-runtime/README.md) | The abstract seam: the request/result vocabulary every backend implements | `ctx.codeRuntime` |
| [`code-runtime-worker-thread/`](code-runtime-worker-thread/README.md) | The shipped TypeScript backend: each program runs in one fresh Node worker | registers `ctx.codeRuntime` |
| [`code-runtime-python/`](code-runtime-python/README.md) | The fd-3 wire protocol between a Node host and a CPython subprocess | plain library |

-----

<a id="related-documentation"></a>
## Related documentation

- [PTC runtime subsystem reference](../../docs/subsystems/ptc-runtime.md) — execution semantics, bindings, and the `ctx.codeRuntime` Cordis surface.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
