# Implementation review status

Status: IN_PROGRESS. The review covers the complete external Upstream-First specification, its personal/official Desktop coexistence amendment, the current `dev` changes, and the newer official differences. It does not transfer historical worktree PASS records to this candidate.

## Success criteria

1. Fix the official source baseline and classify downstream capabilities by actual ownership.
2. Keep personal and official Desktop distributions usable together without duplicating Host, Session, or RPC authority or interfering with each other's installation and processes.
3. Verify contract negotiation, interaction lifetime, idempotency, recovery, trust, authorization, and data migrations through their real consumers.
4. Verify shared responsive UI, native companions, accessibility, and bounded artifact/diff behavior against the specified platform/state matrices.
5. Bind compatibility, security, native, signing, update, and support evidence to the same candidate; retain `completeRc=false` while any required evidence is missing.
6. Map every specification section and named deliverable to current source, executed checks, or an explicit unresolved requirement.

## Current evidence

| Item | Status | Evidence and limit |
|---|---|---|
| Live upstream fetch and Git inventory | PASS | [Baseline](UPSTREAM_BASELINE.md), [machine snapshot](UPSTREAM_DELTA.json); adoption and full classification remain open |
| TS/generated/Android fixture drift | PASS | Existing generator restored the three Android copies; freshness check and 18 TS contract assertions passed |
| Kotlin current Host event parsing | PASS | [Final regenerated core run](.artifacts/upstream-first-review/kotlin-core-regenerated.log) passes all [98 cases](.artifacts/upstream-first-review/kotlin-test-counts.json), including file-change fixtures; not a native-device receipt |
| Swift current Host event parsing | IN_PROGRESS | Source and regression fixtures updated; no local Swift/macOS execution |
| Remote test composition | PASS | The real official Remote Access service now mounts before Gateway; [57 remote assertions](.artifacts/upstream-first-review/revocation-after.log) passed |
| Immediate device revocation | PASS | Two open-stream regressions failed before the fix and passed after it; both carrier and direct trust-store revocation exercised; the two revoked-during-authentication race regressions (negative receipt `revocation-admission-before.log`) also pass in the [98-case focused run](.artifacts/upstream-first-review/push-focused.log) |
| Desktop Client build configuration | PASS | Bundle-helper directory and official sequential bundling corrected. Personal host membership is included. The complete build passed 10/10 in the current checkout, including both aggregate checks. Local receipt is `.artifacts/upstream-first-review/push-build-final.log`; re-verified 10/10 on 2026-11-20 after the first-run fix |
| Personal Desktop data isolation | IN_PROGRESS | Separate default home and explicit absolute override pass [8 path tests](.artifacts/upstream-first-review/personal-paths-final.log); [upgrade guide](docs/upgrade-guide/v0.2.2-alpha.2/personal-desktop-isolation/guide.md) preserves old data. First-run profile initialization now seeds the personal `desktop` profile through the shared `initProfile` (3 real-entry regressions: empty home, absolute override, never rewriting an initialized profile; 11/11 with the path tests, commit `4daf97e9e1e`); installed parallel operation not verified |
| Revocation API documentation | PASS | Generated service/event regions are fresh; [10 partition tests](.artifacts/upstream-first-review/catalog-partition-final.log) include unmapped-event negative cases |
| Published dependency policy | PASS | Repaired 3 classified manifests and two redundant package-local React type declarations; [95 covered packages pass](.artifacts/upstream-first-review/dependencies-final.log) after lockfile refresh |
| Smoke overlay integrity | IN_PROGRESS | Two negative controls reproduced hidden overlays for flags 0 and 1; removal passes all [13 boot assertions](.artifacts/upstream-first-review/smoke-overlays-after.log), browser evidence remains open |
| Native credential/transport security | FAIL | Production Android pin enforcement, native protocol admission, and Apple durable credential completion are blocking findings in [security verification](SECURITY_STATUS.md) |
| Artifact build and aggregate check | PASS | After quarantining obsolete generated Settings files and restoring official bundle ordering, [all 8 artifact steps pass](.artifacts/upstream-first-review/build-artifacts-ordered.log); [both aggregate checks pass](.artifacts/upstream-first-review/build-check-ordered.log). This is build evidence, not installed UI acceptance |
| Local Web authentication | PASS | [25 focused assertions](.artifacts/upstream-first-review/local-web-auth.log) cover Host/Origin trust, loopback classification, and browser authentication; this is not the complete threat matrix |
| Documentation quick checks | PASS | [All 21 checks pass](.artifacts/upstream-first-review/docs-quick-after.log) after moving exact Git identities to linked raw evidence; no reference-policy exception or gate disable |
| Full specification and newer-upstream audit | IN_PROGRESS | The three priority execution areas now carry evidence-backed dispositions against official `f3803c9697` ([sandbox/shell Adapt + node-spawn Keep](.artifacts/upstream-first-review/owner-review-sandbox-shell.md), [code-runtime family Delete/Migrate](.artifacts/upstream-first-review/owner-review-code-runtime.md), [relay Experimental](.artifacts/upstream-first-review/owner-review-relay.md)); 13 of 121 owners classified, 108 remain open with the remaining compatibility, UI, platform, and release findings |

## Unresolved requirements

Current `dev` does not establish the complete HostDescriptor/N/N-1 contract, four-role device model, complete interaction/mutation lifetime guarantees, view-only handoff, required phone drawer/safe-area/keyboard behavior, Host-authored approval risk context, bounded shared artifact/diff viewer, or the full native/network/release matrices. The newer official responsive and runtime improvements must be evaluated before introducing downstream replacements.

The separate implementation worktree contains additional implementations and historical evidence, but its unfinished merge is not a validated candidate. A source file, green unit test, APK, or installer is not a substitute for the missing assembled, physical-device, compatibility, and release evidence.

## Specification traceability

Each row covers one numbered section of the external specification whose identity is recorded in the baseline snapshot. `NOT_STARTED` means this review has not established current-candidate evidence, not that a filename search proved the capability absent. A partial implementation or passing focused check does not make a whole section PASS. The Desktop amendment applies to sections 3, 78, and 80 without waiving shared business ownership.

| Section | Status | Evidence owner or remaining acceptance |
|---|---|---|
| 0: Overall outcome | IN_PROGRESS | Current-candidate audit; no complete product/release claim |
| 1: Upstream refresh and audit | IN_PROGRESS | [Baseline](UPSTREAM_BASELINE.md); fetched source, preserved worktrees, classification/adoption open |
| 2: Official architectural baseline | IN_PROGRESS | [Delta](UPSTREAM_DELTA.md); official Desktop/runtime/Client changes not fully adopted |
| 3: Desktop migration classes | IN_PROGRESS | Dual thin shells permitted; build, identity, storage, updater, and process isolation open |
| 4: Product architecture | IN_PROGRESS | Shared Host/Typert/Connection ownership retained; full consumer audit open |
| 5: Platform roles | IN_PROGRESS | [Platform report](PLATFORM_VERIFICATION.md); no complete assembled platform matrix |
| 6: Mobile levels | IN_PROGRESS | Companion and Lite source exist; Full Mobile Host remains experimental, not accepted |
| 7: Responsive shared Web Client | FAIL | Phone sidebar consumes conversation width; newer official drawer not yet adopted |
| 8: Mobile boundaries | NOT_STARTED | No current complete safe-area, real-keyboard, rotation, input, or foldable evidence |
| 9: Design language | IN_PROGRESS | Shared token use observed; complete theme/touch/spacing verification open |
| 10: Conversation information architecture | IN_PROGRESS | Shared composition exists; complete Host/runtime and narrow-window acceptance open |
| 11: Cross-device view ownership | IN_PROGRESS | Host-owned execution remains required; all handoff consumers not reconciled |
| 12: HostDescriptor | FAIL | Retained link description lacks the specified complete independent identity/version/platform/time facts |
| 13: Capability negotiation | FAIL | Native call admission does not require negotiated capabilities |
| 14: N/N-1 compatibility | NOT_STARTED | [Compatibility matrix](COMPATIBILITY_MATRIX.md); no independently released version pair exercised |
| 15: Interaction lifetime | FAIL | Timed questions recover from Host logs, but general blocking Question/Approval pending state remains process-local/live |
| 16: Multiple Client answers | FAIL | Live settlement is first-wins, but duplicate results silently no-op instead of returning the specified closed-interaction outcome |
| 17: Mutation idempotency | FAIL | Observable prompt requests deduplicate; retrying snapshot handoff creates another Session and a new prompt identity |
| 18: Reconnect | FAIL | Connection publicly distinguishes only connected/disconnected/connecting, not the required authentication/readiness/revocation/incompatibility states |
| 19: Offline behavior | IN_PROGRESS | No automatic prompt replay found in inspected Web paths; native/background matrix open |
| 20: Device Trust | IN_PROGRESS | Pairing and immediate open-stream revocation verified locally; platform/re-key coverage open |
| 21: Device roles | FAIL | Retained observer/controller/administrator model does not establish the specified four-role permissions |
| 22: Lost device | FAIL | Host revoke regression passes; Apple failed deletion can leave identity restorable |
| 23: Relay | NOT_STARTED | Relay source presence is not compromise/reconnect/authorization acceptance |
| 24: LAN | IN_PROGRESS | Local TLS carrier tested; discovery, VPN, IPv6, captive-portal and device UX open |
| 25: Follow | IN_PROGRESS | Shared fold/stream tests pass; released-client cursor and recovery matrix open |
| 26: View-only handoff | FAIL | Current snapshot handoff creates a Session and queues executable work |
| 27: Runtime migration | DEFERRED | Explicitly distinct from ordinary view handoff; no accepted Full Mobile migration |
| 28: Multiple Hosts | IN_PROGRESS | Per-Host identity exists; concurrent selection/send-target safety not established |
| 29: Session execution location | IN_PROGRESS | Persistent Host/runtime location UI and send fence not verified |
| 30: Model select and steer | IN_PROGRESS | Shared APIs exist; capability/read-only/native/version acceptance open |
| 31: Lite runtime | IN_PROGRESS | Shared behavior fixtures exist; assembled runtime/provider/platform behavior not accepted |
| 32: Lite tools | IN_PROGRESS | Behavior fixtures do not establish real on-device tool ownership and sandbox guarantees |
| 33: Lite persona | NOT_STARTED | No current assembled system-prompt/tool-perspective acceptance |
| 34: Diff viewer | FAIL | Existing row caps/expansion do not establish the required bounded shared viewer |
| 35: Files and artifacts | FAIL | Whole-artifact client decoding remains despite endpoint range support |
| 36: Attachments | IN_PROGRESS | Explicit attachment action exists; camera/share/native/resource bounds remain open |
| 37: Command risk | NOT_STARTED | No complete Host-authored classification/escalation acceptance |
| 38: Approval UI | FAIL | Request/presentation does not guarantee Host, workspace, risk, and escalation facts |
| 39: Credentials | FAIL | [Security report](SECURITY_STATUS.md); Apple persistence failures and native key lifecycle open |
| 40: Plugin permissions | NOT_STARTED | No complete least-privilege/executor-path escalation evidence |
| 41: Health and readiness | NOT_STARTED | No current assembled service/transport/runner readiness matrix |
| 42: Diagnostics | NOT_STARTED | No complete platform/version/error diagnostic acceptance |
| 43: Support bundle | NOT_STARTED | No current redaction/export/reproduction receipt |
| 44: Telemetry | NOT_STARTED | No complete consent/data-minimization/disable verification |
| 45: Error semantics | IN_PROGRESS | Official gateway error expectations repaired; closed cross-platform mapping remains open |
| 46: Persistence | IN_PROGRESS | Host remains disk-format owner; migration compatibility/recovery audit open |
| 47: Feature flags | NOT_STARTED | No complete capability/flag/default-off/exposure audit |
| 48: Directory ownership | IN_PROGRESS | Current package ownership recorded; proposed folder names are not acceptance criteria |
| 49: Fifteen legacy items | IN_PROGRESS | Covered by native, negotiation, layout, location, network, model and health rows; none inherited as PASS |
| 50: Additional failure cases | IN_PROGRESS | Revocation covered locally; re-key, reinstall, sleep, network, push and replay matrix open |
| 51: Test pyramid | IN_PROGRESS | Focused TS/Kotlin checks executed; browser/native/real-Host/model tiers incomplete |
| 52: Visual matrix | NOT_STARTED | Required viewport/theme/state matrix has no complete current browser receipt |
| 53: Native device matrix | BLOCKED | No current Apple runner or required physical-device receipt |
| 54: Network matrix | NOT_STARTED | Local TLS tests do not cover required LAN/cellular/VPN/packet-loss/latency states |
| 55: Contract compatibility matrix | NOT_STARTED | Fresh generated artifacts do not prove N/N-1 compatibility |
| 56: Desktop release | BLOCKED | Parallel packaging isolation and same-candidate signed install/update receipts missing |
| 57: Mobile release | BLOCKED | Store/signing/physical-device/recovery evidence missing |
| 58: Gates 0–4 | IN_PROGRESS | [Release gates](RELEASE_STATUS.md); none promoted from artifact existence |
| 59: Artifact existence is not acceptance | PASS | Reports distinguish fixtures/builds/installers from assembled and physical-device behavior |
| 60: Evidence schema | IN_PROGRESS | Exact baseline, logs and dirty-state records exist; same-source platform receipts missing |
| 61: Commit trains | NOT_STARTED | No review commits, rebases, pushes or release publication performed |
| 62: Per-commit checks | IN_PROGRESS | Focused regressions executed; full affected build/check/docs evidence still incomplete |
| 63: Agent Notes | IN_PROGRESS | Frozen archived notes preserved; no speculative implementation notes created |
| 64: UX state completeness | IN_PROGRESS | Removed smoke-only overlay suppression; browser and complete state matrix open |
| 65: Accessibility | NOT_STARTED | No current keyboard/screen-reader/font-scale/reduced-motion/touch matrix |
| 66: Performance | NOT_STARTED | No current bounded-artifact/long-session/memory performance receipt |
| 67: Crash and recovery | IN_PROGRESS | Durable credential failure found; process-death, Host restart and restore matrix open |
| 68: Updates | NOT_STARTED | No signed update, rollback, interrupted-update or cross-distribution receipt |
| 69: Threat model | IN_PROGRESS | Concrete native blockers and revocation regression recorded; remaining threats in security report |
| 70: Security requirements | FAIL | Production Android transport lacks the stored pin; negotiation and credential guarantees incomplete |
| 71: Local Web authentication | IN_PROGRESS | No local authentication weakening applied; full alternate-entry negative controls open |
| 72: Duplicate architecture debt | IN_PROGRESS | Ownership inventory open; no replacement protocol/runtime/updater introduced |
| 73: Definition of Done | FAIL | Required compatibility/platform/security/UX/recovery/release evidence remains incomplete |
| 74: Stop conditions | BLOCKED | Native runner/signing absence and unreconciled upstream architecture prevent final release acceptance |
| 75: Final product shape | IN_PROGRESS | Official-compatible shared platform with parallel thin Desktop shells remains the target |
| 76: Execution phases | IN_PROGRESS | Upstream audit and proven regressions precede additional feature work |
| 77: Priorities | IN_PROGRESS | P0 upstream/interaction/negotiation/responsive/reliability gaps remain open |
| 78: Architecture decisions | IN_PROGRESS | [Decisions](ARCHITECTURE_DECISIONS.md); Desktop distribution amendment does not duplicate Host authority |
| 79: Required reports | IN_PROGRESS | All ten named baseline/inventory/status outputs exist; contents remain current-stage evidence, not completion |
| 80: Final success | FAIL | Current dirty candidate does not satisfy all required product and release outcomes |

## Related reports

- [Upstream differences](UPSTREAM_DELTA.md)
- [Architecture decisions](ARCHITECTURE_DECISIONS.md)
- [Compatibility](COMPATIBILITY_MATRIX.md)
- [Security](SECURITY_STATUS.md)
- [Platform verification](PLATFORM_VERIFICATION.md)
- [Release](RELEASE_STATUS.md)
