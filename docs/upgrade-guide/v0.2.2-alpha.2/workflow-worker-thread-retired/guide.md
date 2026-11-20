---
kind: upgrade-guide
description: "The published package @deepseek-ai/dsh-workflow-worker-thread is retired; the sandboxed official engine @deepseek-ai/dsh-workflow-ptc serves every workflow engine consumer."
---

# `dsh-workflow-worker-thread` retired; `dsh-workflow-ptc` serves the engine

English | [中文](guide.zh.md)

## Change

The worker-thread workflow engine package `@deepseek-ai/dsh-workflow-worker-thread` is removed from the repository, and the desktop bundle patch no longer carries its (already disabled) `workflow-worker-thread` row. The package was a fork of the official engine `@deepseek-ai/dsh-workflow-ptc` with no enabled mount anywhere in the repository: the base bundle mounts `workflow-ptc`, the desktop composition disables the whole workflow family, and the `dsh` CLI declared the dependency without using it.

You are affected if you declared `@deepseek-ai/dsh-workflow-worker-thread` in a profile or install of your own, or if an overlay patches the `workflow-worker-thread` entry id.

## Migration

1. In your `package.json`, replace the dependency `@deepseek-ai/dsh-workflow-worker-thread` with `@deepseek-ai/dsh-workflow-ptc`.
2. In overlays or `cordis.patch.yml` layers, replace the entry id `workflow-worker-thread` with `workflow-ptc`. The engine registers the same `ctx.workflowEngine` service, so consumers of that service need no change.
3. If you relied on worker-thread containment specifics (`disposeGraceMs`, in-thread vm execution), note that `workflow-ptc` runs workflow code in a sandboxed process with file policies; no engine option carries over.
4. Confirm the migration: `pnpm install` resolves without the retired name, `pnpm run typecheck` passes, and a profile that mounts `workflow-ptc` boots with the workflow tool answering.
