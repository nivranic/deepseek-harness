# Platform verification

Status: IN_PROGRESS. All rows refer to the current dirty `dev` candidate, not artifacts built by the separate historical implementation worktree.

| Platform | Status | Current evidence and missing acceptance |
|---|---|---|
| Windows official Desktop | NOT_STARTED | No current-candidate installed UI, recovery, or update receipt |
| Windows personal Desktop | IN_PROGRESS | Source/build-entry audit; installed parallel-operation and data/profile isolation remain unverified |
| macOS official/personal Desktop | BLOCKED | No verified macOS runner, signing, or notarization execution |
| Linux CLI/Web Host | NOT_STARTED | No current-candidate platform execution |
| Web Chromium/WebKit/PWA | IN_PROGRESS | Source review only; no current complete visual/input/accessibility matrix |
| iPhone/iPad | BLOCKED | No current Swift build, simulator, physical-device, Keychain upgrade, or Store receipt |
| Android phone/tablet | IN_PROGRESS | JVM [core tests pass](.artifacts/upstream-first-review/kotlin-core-regenerated.log); production TLS pin/Android transport issues remain, with no physical-device, installed release, process-death, or Keystore-upgrade acceptance |

## Required matrices

The original viewport matrix remains 320×568, 393×852, 768×1024, 1024×768, and 1440×900 in light and dark themes, across idle, streaming, tool, approval, question, offline, reconnecting, error, empty, loading, large diff, and artifact states. Safe areas, actual virtual keyboards, rotation, font scaling, reduced motion, keyboard-only use, screen-reader behavior, and touch targets require direct verification.

Native coverage must distinguish simulators/emulators from physical devices, iOS current/previous major and iPhone/iPad, Android API 34/current API and 16 KiB pages, and phone/tablet. Network, sleep/wake, foreground/background, Host restart, process death, Relay reconnect, packet loss, and latency remain separate required observations.

A successful compile, a fresh fixture, and an existing installer/APK do not grant any missing row PASS.
