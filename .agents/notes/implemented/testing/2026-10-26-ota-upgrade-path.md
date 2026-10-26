# Agent Note: A real replace-install upgrade qualifies the dropped-preset path end to end

Status: implemented

English | [中文](2026-10-26-ota-upgrade-path.zh.md)

## Problem

The gen-71 stale-preset closure qualified its connected case by writing the store directly — the real Keystore cipher, but a residue no user flow had produced. Its Open follow-ups named exactly what stayed unqualified: "a real over-the-air upgrade path — an older APK's stored config meeting a newer APK's dropped preset." The upgrade mechanics (a selection made through the real config face, the platform carrying the app's data and Keystore entries across a replace-install, the upgraded APK's catalog having dropped the stored id) sat outside any lane.

## Decision

Qualify the real path as a two-phase lane over a fixture APK pair. The frozen lite preset projection (`packages/preset/agent-presets/lite-preset-descriptors.json`) carries exactly one shipped preset (`minimal`) and has no historical drop to replay, so the older APK is a fixture build of the same tree with one probe entry (`vanished-preset`, gen-71's injected id) added to the projection — every other input identical. `LiteUpgradeSeedNativeTest` (`dshUpgradeLane=seed`) installs nothing and injects nothing: it opens the real config face, makes an explicit probe selection through the preset picker — never the default a null pick resolves to — and saves, leaving a Keystore-sealed store naming the probe id, then re-reads the store to pin the durable fact. The lane replace-installs the current APK (`adb install -r` — data and Keystore entries survive; the projection file is restored to its committed bytes first, so the upgraded APK's catalog genuinely drops the probe). `LiteUpgradeVerifyNativeTest` (`dshUpgradeLane=verify`) holds the surviving residue to the dropped-preset contract: the precondition is the seed phase's stored config read back through the real store — not a write from this process — then the stale line renders naming both the stored id and the carried `minimal`, no conversation assembles over the failed identity, and the in-face reconfiguration recovers by reselecting a carried preset, healing the store to `minimal` and reassembling. Both classes skip cleanly when the lane argument is absent, so a normal connected lane never runs them.

## Alternatives considered

A versionCode-bumped APK pair was rejected — the replace-install preserving `/data/data` and the AndroidKeyStore entries is the upgrade mechanic under test, and a version-number delta adds no observable difference at the stored-config-meets-dropped-preset seam. Replaying a historically dropped preset was rejected — the projection's whole history is one commit carrying `minimal` alone; no real drop exists, and a cross-commit pair would drag unrelated code deltas into the seam the fixture pair keeps isolated to the projection document. Extending the injected connected case further was rejected — that path is already qualified; the missing half was precisely the real upstream (a face-made selection carried by the platform), which one instrumentation run cannot express across two APKs.

## Consequences

The upgrade-path qualification is now a repeatable lane, not a claim: seed on the fixture APK, replace-install the current one, verify the surviving residue — each phase a single gated instrumentation run with the APK digests recorded by the lane. The normal connected lane gains two permanently skipping classes, the honest no-lane form. The qualification covers the drop seam — one dropped id, one stored config, one replace-install on an emulator; it does not cover the physical delivery channels (store pushes, staged rollouts) or the rig rows, which stay on the external acceptance ledger, and the fixture's older APK is a lane build, never a committed state.
