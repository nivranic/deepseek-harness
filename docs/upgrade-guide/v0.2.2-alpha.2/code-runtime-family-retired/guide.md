---
kind: upgrade-guide
description: "The published code-runtime family packages are retired; the official ptc-runtime family serves code execution through PTC mode."
---

# The `dsh-code-runtime*` family retired; `dsh-ptc-runtime*` serves code execution

English | [中文](guide.zh.md)

## Change

The three packages `@deepseek-ai/dsh-code-runtime`, `@deepseek-ai/dsh-code-runtime-worker-thread`, and `@deepseek-ai/dsh-code-runtime-python` are removed from the repository, and the desktop bundle patch no longer mounts the `code-runtime` row. The seam and its worker backend were source-duplicates of the official `ptc-runtime` family (`dsh-code-runtime` re-declared the ptc-runtime Service Definition under a `ctx.codeRuntime` name with no consumer anywhere), and the Python package was an unwired protocol library; the official `@deepseek-ai/dsh-ptc-runtime` family provides the supported execution path through PTC mode in `dsh-tools`, with a sandboxed Node provider and the experimental CPython provider.

You are affected if you declared any `dsh-code-runtime*` package, injected or implemented the `ctx.codeRuntime` service, or patched the `code-runtime` entry id.

## Migration

1. In `package.json`, replace `@deepseek-ai/dsh-code-runtime*` dependencies with `@deepseek-ai/dsh-ptc-runtime` (plus `@deepseek-ai/dsh-ptc-runtime-node` for the process provider).
2. In overlays or `cordis.patch.yml` layers, replace the entry id `code-runtime` with `ptc-runtime`; the base bundle already mounts `ptc-runtime` and `ptc-runtime-node`.
3. Replace `ctx.codeRuntime` injections with the PTC mode surface in `dsh-tools`; there is no `ctx.ptcRuntime.run` drop-in — model-authored code execution goes through the PTC tool mode.
4. Confirm the migration: `pnpm install` resolves without the retired names, `pnpm run typecheck` passes, and a profile that mounts `ptc-runtime-node` boots with PTC mode answering a code-execution turn.
