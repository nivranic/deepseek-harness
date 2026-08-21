# Agent Note: Desktop first-launch latency — prelude before the heal, stamped module fallback, Defender as the cold floor

Status: implemented

English | [中文](2026-08-21-desktop-first-launch-latency.zh.md)

## Problem

The packaged exe's first launch still took tens of seconds before the UI appeared, after the prelude-page and `dsh:` code-cache fixes. Measurement against the installed `F:\deepseek-harness` (CDP target-URL timeline, plain-Node `runProfile` phase timing, and an unbuffered `robocopy /J` copy that reproduces the Defender-fresh, cache-cold state of a fresh install) split the launch into: warm ≈ 0.8 s to the DevTools endpoint plus ≈ 2.3 s tree boot, UI settled ≈ 2.5 s. Module cold I/O is effectively free on NVMe — the tree boot reads 1,098 module files (~5 MB), and the unbuffered-cold rerun cost the same ≈ 2.3 s, so the boot is CPU-bound, not I/O-bound. Two costs were structural: `healProfilesModuleFallback` re-read ~272 installation manifests synchronously (264 ms warm, 1.27 s cold), and because `apps/desktop/src/main.ts` called `startGateway()` before `createWindow()`, that walk ran before the prelude window even existed. The dominant cold cost is Microsoft Defender: a custom scan of the 507 MB / 19,504-file install takes 23.4 s, and real-time filtering intercepts the exe, DLLs, and first-read files synchronously — every release rebuild (robocopy rewrites the whole tree) makes every file a first read again.

## Decision

The shell paints first. `apps/desktop/src/main.ts` defers the boot graph (`dsh/profile-boot`, `dsh-app-boot`) into `startGateway` as dynamic imports, hands `createWindow` a never-rejecting gateway deferred, and starts the gateway only after the prelude window exists; boot failures still surface through fail-loud with the prelude on screen.

The heal stamps its work. `healProfilesModuleFallback` writes `.dsh-heal-stamp.json` beside the links recording the anchor stat and every link's target-manifest stat; an unchanged install validates from stats alone (no manifest reads, no link rewrite). The stamp trusts file identity, not file contents — mtime compares rounded to milliseconds, because external restore tooling truncates below that while real closure changes (deploy, install, edit) move a manifest by far more. Any anchor, link, or manifest change re-runs the full walk and re-stamps; `packages/boot/app-boot/tests/profile.spec.ts` pins the skip (stat-preserved invalid manifest must not throw) and the invalidations (anchor change, link retarget).

Defender is the remaining lever and is a machine setting, not code: the install directory needs a one-time elevated `Add-MpPreference -ExclusionPath 'F:\deepseek-harness'`. Recorded here because no repository gate can apply or verify it from a non-admin shell.

## Alternatives considered

**`module.enableCompileCache()` in the Electron main.** Present on Electron 39's Node 22.22 but experimental, and unstable in measurement (first cache-writing run 16.8 s versus 3.8 s steady on the same warm benchmark); the parse savings it targets are a fraction of the 2.3 s CPU-bound tree boot, so it was dropped.

**Bundling the main-process import graph.** The whole static graph is 12 files / 288 KB; there is nothing to win.

**Parallel prefetch of the 1,098 tree modules.** The unbuffered-cold rerun proved the tree boot CPU-bound at ≈ 2.3 s; prefetching attacks the I/O term that measured as free.

## Consequences

A cold first launch paints the prelude behind only the Electron core startup instead of behind the import graph plus the manifest walk; unchanged installs skip ~272 manifest reads per launch, and the first launch after each rebuild still walks once (the anchor stat changes, exactly when the closure may have changed). Without the Defender exclusion the real-time scan of the exe and DLLs remains the dominant cold term; with it, that floor is gone. The stamp adds one heal-owned file inside `$DSH_HOME/profiles/node_modules`; a torn or stale stamp falls back to the full walk, so it cannot brick a launch.
