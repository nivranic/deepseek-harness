# Agent Note: Desktop packages stamp their build revision into the inventory-sealed dsh tree

Status: implemented

English | [中文](2026-10-07-revision-stamping.zh.md)

## Problem

The §42 diagnostics snapshot reads `sourceRevision` from `process.env.DSH_BUILD_REVISION ?? 'source-tree'` (delivered earlier, read per call so a launcher may stamp before the first describe), but no launcher ever stamped: a packaged app starts from Finder or Explorer with no such variable, so every release honestly-but-uselessly reported `'source-tree'`. The gen-34 follow-up — "stamp DSH_BUILD_REVISION in the desktop release build flow" — was the missing half, deferred to the §56 packaging flow.

## Decision

1. **Write side** (`apps/desktop/scripts/prepare-dsh.ts`, `build-revision.ts`): during packaging preparation, `build-revision.json` (`{"revision":"<40 lowercase hex>"}`) is written into the dsh runtime tree root **before** `writeDesktopRuntime` seals the inventory — the file lands inside `desktop-runtime.json`'s integrity manifest, rides `extraResources` into every artifact (dmg, zip, NSIS, unpacked), and sits inside macOS's signature-exempt `dsh` tree. The revision resolves from an explicit `DSH_BUILD_REVISION` (validated 40-hex), else `git rev-parse HEAD` (full 40); when the client build record exists its short hash is cross-checked and a divergence fails the package loudly (`misconfiguration fails loud` — packaging environment and git state must not fork silently).
2. **Read side** (`apps/desktop-host/src/index.ts`): the host entry reads `join(runtimeDir, 'build-revision.json')` before `runDesktopHost` and materializes it into `DSH_BUILD_REVISION` only when the process has no explicit inherited value. A present-but-corrupt stamp (unreadable beyond absence, invalid JSON, malformed revision) throws — a damaged package fails loud instead of silently reporting `source-tree`. An absent stamp — every dev/source-tree launch, whose runtime dir is the development project — sets nothing, preserving gen-34's semantics unchanged.
3. **Acceptance**: the documented unsigned Windows path runs end to end — prepare chain green, the artifact's `win-unpacked/resources/dsh/build-revision.json` equals the packaged HEAD's full 40 hex, the artifact's own `desktop-runtime.json` lists the file under the same sha256, and the NSIS installer plus blockmap are produced. Signing and notarization acceptance stays §56-open.

## Alternatives considered

- **Electron-main launcher stamping** (afterPack writes a file at the resources root; main.ts reads it before spawning the host): rejected — three change surfaces instead of two, a resources-root file enters the macOS code-signing seal and needs re-evaluation, the `--prepackaged` repack path would need its afterPack behavior measured, and the stamp would sit outside the runtime inventory's tamper protection.
- **Release-environment env injection**: rejected alone — env lives only in the packaging process; a user-launched app inherits nothing. A stamp must be a file inside the product.
- **Inlining the revision as a build-time define**: rejected by the gen-34 ruling — every commit would produce different library bytes.
- **Reading the stamp in Electron main and passing env per-spawn**: rejected — the host entry is the single place that knows the runtime dir argument, and a file read there keeps main.ts untouched.

## Consequences

A packaged deployment's diagnostics now name the exact source revision it was built from, with the stamp sealed by the same integrity manifest that guards every other runtime file. Dev and source-tree launches behave exactly as before. Two pre-existing defects surfaced by this generation's packaging acceptance were fixed at the root in the same change: (a) four client packages value-imported `dsh-client-locale/client` helpers without declaring the module-table row — the client bundle purity gate (a face no gate or CI had built since its introduction) now passes with `dsh.client.external` declarations, the designed loader-row path; (b) GNU tar on Windows parsed drive-letter paths as rsh hosts — tar invocations now share a platform-flagged helper (`--force-local` on win32 only; bsdtar unaffected). The unsigned acceptance additionally documents its environment needs: `DSH_DESKTOP_APP_ID` and, on this host, the npmmirror Electron mirrors.

## Open follow-ups

- §56 signed packaging, notarization, and update-feed acceptance (signing materials) remain open.
- The loader-composition e2e pre-existing baseline failure (unrelated) stays pinned.
