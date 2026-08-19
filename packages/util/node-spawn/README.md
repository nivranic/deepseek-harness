# dsh-node-spawn

English | [中文](README.zh.md)

Zero-dependency spawn facts for running a script under a plain Node runtime from the current process, shared by the host plugins that re-execute a bundled worker or runner as a child: the native directory-picker's Win32 dialog worker (`dsh-host-directory-picker-native`) and the Windows ACL sandbox runner chain (`dsh-sandbox-local`).

## Surface

```ts
import { spawn } from 'node:child_process'
import { nodeSpawnCommand } from '@deepseek-ai/dsh-node-spawn'

declare const workerScript: string

const { command, env } = nodeSpawnCommand()
spawn(command, [workerScript], { env: { ...process.env, ...env }, stdio: 'ignore', windowsHide: true })
```

`nodeSpawnCommand()` resolves two facts once, both stable for the process lifetime:

- **`command`** is `process.execPath`. Under plain Node that is the Node executable itself; under the packaged desktop app it is the Electron binary.
- **`env`** carries the environment entries the command requires before the script argument: under Electron, `ELECTRON_RUN_AS_NODE=1`, without which the same executable boots the whole desktop app instead of running the script as Node; under plain Node the map is empty, because the variable is inert there and omitting it leaves unrelated children unaffected.

Consumers must merge `env` into the child environment; the value always overwrites any Electron-mode entry inherited from the parent.

## Model Experience

None, as this is a pure process fact; nothing here reaches a model request.

#### KV Cache effect

None; nothing here enters a request prefix.

## Known Limitations and Deferred Work

- **The Electron fuse must permit RunAsNode** — a hardened Electron build that disables the `RunAsNode` fuse would need a real Node executable shipped beside it; the desktop packaging here keeps the fuse enabled.
- **Single-level spawn facts only** — the helper answers how THIS process re-executes as Node; a child that itself spawns Node binaries needs its own resolution.
