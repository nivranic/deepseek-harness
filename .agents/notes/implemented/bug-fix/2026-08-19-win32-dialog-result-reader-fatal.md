# Agent Note: The Win32 folder-dialog result read fatally rejects under the packaged Electron runtime

Status: implemented

English | [中文](2026-08-19-win32-dialog-result-reader-fatal.zh.md)

## Problem

After [2026-08-19-electron-exe-node-children](2026-08-19-electron-exe-node-children.md) made the dialog worker boot as Node under the packaged exe, completing a folder selection still killed the worker: the app surfaced "win32 folder dialog worker exited before reporting a result" the moment the user confirmed a directory, while canceling kept working and the same code ran clean under plain-node dev launches. The dying step is `readUtf16`, which the cancel path never executes: `koffi.view(address, 32768)` builds an external ArrayBuffer over native memory, and the N-API layer fatally rejects creating one under the packaged app's Electron-as-Node runtime (immediate `napi_fatal_error`, exit 134 — no JS exception, no IPC message, so the driver only sees the exit). Two further facts of the same call: the fixed 32 KB materialization over-reads the small CoTaskMem string allocation even where `view` works, and koffi's `_Out_ void **` out-param arrays do fill with the native pointer on success (verified on both runtimes), so the surrounding out-param code was never the defect.

## Decision

[`readNativeUtf16`](../../../../packages/host/directory-picker-native/src/win32-dialog-bindings.ts) replaces the view-based reader: `kernel32!lstrlenW` measures the exact byte length, `kernel32!RtlMoveMemory` copies `(length + 1) * 2` bytes into a self-owned Buffer, and the string decodes from that copy. Both functions are documented Win32 ABI reachable on every Windows host the worker runs on, and the copy touches exactly the string's own allocation. The koffi surface loses its `view` entry; the fake-koffi test world now throws on any `view` call, pinning the regression at unit level, and a win32-only real-COM test drives a genuine `IShellItem::GetDisplayName(SIGDN_FILESYSPATH)` result address through the reader and asserts the path — the exact native state that died in the packaged app.

## Alternatives considered

**`koffi.decode(address, 'str16')` (two- and three-argument forms).** Rejected on evidence: both segfault on a raw out-param address under plain Node and under Electron-as-Node alike.

**A bounded `koffi.view(address, exactBytes)`.** Rejected on evidence: the external ArrayBuffer creation is the fatal surface — the call dies under Electron-as-Node regardless of the requested length.

**Upgrading koffi.** Rejected: external ArrayBuffer creation over native memory is removed V8 surface, not a koffi defect we can pin a version against; the copy-based reader owns its whole mechanism.

## Consequences

The packaged exe's select/add-workspace flow completes a real selection again; verified against the user's failing path (`E:\Mix\project\AllTestInOne`) with the exact reader code, six rounds each under plain Node and the installed exe's Electron-as-Node runtime, then re-verified through the rebuilt install. The real-COM regression test runs on every win32 host under whichever heap the runner itself uses, so the reader stays pinned even though the packaged-only failure mode cannot be asserted keylessly from vitest. `Koffi` is now an exported structural interface because that test types the real koffi module through it.
