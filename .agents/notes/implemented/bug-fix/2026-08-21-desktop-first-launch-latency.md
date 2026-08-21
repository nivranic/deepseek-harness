# Agent Note: Desktop first-launch latency — prelude before the heal, stamped module fallback, Defender as the cold floor

Status: implemented

English | [中文](2026-08-21-desktop-first-launch-latency.zh.md)

## Problem

The packaged exe's first launch still took tens of seconds before the UI appeared, after the prelude-page and `dsh:` code-cache fixes. Measurement against the installed `F:\deepseek-harness` (CDP target-URL timeline, plain-Node `runProfile` phase timing, and an unbuffered `robocopy /J` copy that reproduces the Defender-fresh, cache-cold state of a fresh install) split the launch into: warm ≈ 0.8 s to the DevTools endpoint plus ≈ 2.3 s tree boot, UI settled ≈ 2.5 s. Module cold I/O is effectively free on NVMe — the tree boot reads 1,098 module files (~5 MB), and the unbuffered-cold rerun cost the same ≈ 2.3 s, so the boot is CPU-bound, not I/O-bound. Two costs were structural: `healProfilesModuleFallback` re-read ~272 installation manifests synchronously (264 ms warm, 1.27 s cold), and because `apps/desktop/src/main.ts` called `startGateway()` before `createWindow()`, that walk ran before the prelude window even existed. The dominant cold cost is Microsoft Defender: a custom scan of the 507 MB / 19,504-file install takes 23.4 s, and real-time filtering intercepts the exe, DLLs, and first-read files synchronously — every release rebuild (robocopy rewrites the whole tree) makes every file a first read again.

## Decision

The shell paints first. `apps/desktop/src/main.ts` defers the boot graph (`dsh/profile-boot`, `dsh-app-boot`) into `startGateway` as dynamic imports, hands `createWindow` a never-rejecting gateway deferred, and starts the gateway only after the prelude window exists; boot failures still surface through fail-loud with the prelude on screen.

The heal stamps its work. `healProfilesModuleFallback` writes `.dsh-heal-stamp.json` beside the links recording the anchor stat and every link's target-manifest stat; an unchanged install validates from stats alone (no manifest reads, no link rewrite). The stamp trusts file identity, not file contents — mtime compares rounded to milliseconds, because external restore tooling truncates below that while real closure changes (deploy, install, edit) move a manifest by far more. Any anchor, link, or manifest change re-runs the full walk and re-stamps; `packages/boot/app-boot/tests/profile.spec.ts` pins the skip (stat-preserved invalid manifest must not throw) and the invalidations (anchor change, link retarget).

Defender is the remaining lever and is a machine setting, not code: the install directory needs a one-time elevated `Add-MpPreference -ExclusionPath 'F:\deepseek-harness'`. Recorded here because no repository gate can apply or verify it from a non-admin shell. Applied on this machine 2026-08-21 with the user's UAC consent; the same unbuffered-cold install then measured UI-ready 37.7 s → 7.1 s.

## Second round: from 7 s to the 2-3 s target

With scanning gone, the remaining cold gap over warm was pure file I/O: the DLLs, `.pak` resources, and the exe's own image section are demand-paged in scattered faults when the renderer and GPU processes spawn. The shipped mechanism: `main.ts` starts a page-cache warmup at module top when packaged — every install-root file plus the two locale paks the UI can pick, size-ascending with the ~200 MB exe last — and `whenReady` waits for it, bounded to 1.2 s, before creating the window. The wait is the load-bearing part: racing the warmup made the renderer's load a 2-3 s coin flip it usually lost, and an intermediate variant that SKIPPED the exe (measured net-zero under the racing regime) was throwing away the real win — once the warmup is awaited before the renderer spawns, warming the exe's image pages collapses both the renderer's cold faults and the main process's late ones (eviction-cold: renderer 1.6 s → 0.3 s, core ≈ 0.9 s → ≈ 0.7 s). The gateway boot also moved from `whenReady` to module top (after the single-instance lock), chained AFTER the warmup — its ~1100 file opens and the warmup's bulk reads share one disk, and racing them slowed both; the heal's synchronous prefix (≈ 0.2 s stamped, ≈ 1.3 s after a rebuild) is the only part that can still hold `ready` back.

Where the numbers landed: warm UI ≈ 2.5 s; the eviction proxy — the closest reboot simulation buildable without admin (push ~60 GB of never-read data through the page cache; Defender's clean-file cache and the prefetcher traces stay warm, unlike the copy-based proxies) — measures UI-ready **2.8-3.1 s**. The copy-based proxies lied in opposite directions: launching immediately after an unbuffered copy adds seconds of write-back contention (one run showed a 3 s renderer window that vanished after settling 30 s), and copying the install to a NEW path drops it out of the Defender exclusion (one accidental run re-measured the pre-exclusion scanning era: 80 s). The true post-reboot number needs an actual reboot to measure; if it exceeds ~3 s, the shipped `launchAtLogin` preference (hidden tray start, instant reveal — see the [close-tray preference note](../architecture/2026-08-20-desktop-close-tray-preference.md)) is the guaranteed path.

## Alternatives considered

**`module.enableCompileCache()` in the Electron main.** Present on Electron 39's Node 22.22 but experimental, and unstable in measurement (first cache-writing run 16.8 s versus 3.8 s steady on the same warm benchmark); the parse savings it targets are a fraction of the 2.3 s CPU-bound tree boot, so it was dropped.

**Bundling the main-process import graph.** The whole static graph is 12 files / 288 KB; there is nothing to win.

**Parallel prefetch of the tree modules alone.** Superseded by the full install warmup — the tree-boot I/O was never the dominant term, but it rides along for free in the same walk.

**Moving the gateway tree to a child process.** Would parallelize tree-mount CPU with core init on another core, but the tree already starts at module top and the wall time is the max of the two, not the sum; not worth the IPC bridge for the desktop surface today.

## Consequences

A cold first launch paints the prelude behind only the Electron core startup (prefetched: ≈ 1.2 s) while the tree mounts concurrently, and the entry page swaps in when the gateway settles; unchanged installs skip ~272 manifest reads per launch, and the first launch after each rebuild still walks once (the anchor stat changes, exactly when the closure may have changed). Without the Defender exclusion the real-time scan of the exe and DLLs remains the dominant cold term; with it, that floor is gone. The stamp adds one heal-owned file inside `$DSH_HOME/profiles/node_modules`; a torn or stale stamp falls back to the full walk, so it cannot brick a launch. The warmup reads a few hundred MB into the evictable standby set on every packaged launch and is skipped entirely when unpackaged.
