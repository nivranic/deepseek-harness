# Agent Note: Node children under the packaged Electron exe re-run as Node

Status: implemented

English | [中文](2026-08-19-electron-exe-node-children.zh.md)

## Problem

Two host plugins spawn a bundled script as a Node child through `process.execPath`: the Win32 directory-dialog worker (`dsh-host-directory-picker-native`) and the Windows ACL sandbox runner (`dsh-sandbox-local` → `dsh-sandbox-windows-acl`). Under the packaged desktop exe the whole profile boots inside Electron's main process, so `process.execPath` is the Electron binary, not `node`. Spawning it with a script argument re-launches the entire desktop app: the dialog worker never reports, `host.pickDirectory` hangs forever, and the workspace pick/add buttons in the packaged GUI appear dead. The ACL runner argv has the same defect — every confined pwsh execution (the shell tool under agent presets) would re-boot the app instead of confining the command. Under plain Node (the webserver and CLI surfaces) both paths work, which is why only the packaged exe exposed them.

## Decision

One shared fact, one package: [`dsh-node-spawn`](../../../../packages/util/node-spawn/README.md) resolves how the current process re-runs itself as plain Node — `process.execPath` plus `ELECTRON_RUN_AS_NODE=1` when `process.versions.electron` is set, no additions otherwise. The dialog worker spawns through those facts directly. The sandbox seam's `ConfinedArgv` gains an optional `env` fragment (absent for plain-executable runners) because the runner's invocation is argv plus environment; `dsh-sandbox-local` attaches the windows-acl rung's spawn-facts env to every wrap, the pwsh/bash sandbox executors merge it into the spawn environment above all spec-owned env content (a spawn precondition, not command content), and the runner deletes `ELECTRON_RUN_AS_NODE` from its own environment before the confined child inherits the block (`lpEnvironment` NULL), so an Electron-based program the user runs from the confined shell still boots normally. The Electron `RunAsNode` fuse stays enabled in the desktop packaging; a hardened build that disables it must ship a real Node executable instead.

## Alternatives considered

**Set `ELECTRON_RUN_AS_NODE` on the app's own environment so children inherit it.** Rejected: every child inherits it, including user shells and commands — an Electron-based program launched from the agent's shell (VS Code, for instance) would silently run as plain Node.

**Wrap the runner argv in `cmd /c set …` to carry the entry without an env channel.** Rejected: it introduces a shell into an invocation chain the sandbox keeps shell-free, and quoting the entry back through argv is fragile for no benefit over a first-class env fragment.

**Ship a Node executable beside the app for these spawns.** Rejected for now: the Electron binary already embeds the same Node runtime; RunAsNode is its supported CLI mode. Revisit only if the packaging ever disables the fuse.

## Consequences

The packaged exe's workspace pick/add buttons and confined shell executions work; the same code paths stay unchanged under plain Node. `ConfinedArgv` consumers must now merge the optional env fragment — the shipped executors do, and the seam catalog documents the obligation. The dialog worker needs no seam change (it builds its own spawn); its coverage beyond the unit lane is the packaged-app verification, since the fix's observable behavior needs an Electron host to manifest.
