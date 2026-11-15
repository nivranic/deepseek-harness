# Security verification

Status: IN_PROGRESS. This is a source and local-behavior review, not a cloud security scan or completed release security receipt.

## Confirmed fix

Device revocation previously refused only new requests. Two local TLS regressions proved that an already-open stream remained connected after both carrier-level and direct trust-store revocation. The trust store now emits its committed revocation and the carrier terminates that device's active responses. The post-fix remote run passed 57 assertions; an unrelated paired device remains usable and a new request from the revoked device receives 401.

Requests are tracked before asynchronous authentication/body handling so revocation cannot miss a response waiting for admission. The request association is removed on response closure. This does not imply rollback of a mutation already committed before revocation.

## Confirmed native blockers

| Status | Subject | Current source and consequence |
|---|---|---|
| FAIL | Android TLS identity | [LinkClient](apps/android/core/src/main/kotlin/ai/deepseek/dsh/link/LinkClient.kt#L45) creates the default JDK HTTP client without installing the stored SPKI pin. The production app uses that client directly; a helper-only pin test does not protect its requests. |
| FAIL | Protocol admission | Both native clients decode descriptions but admit calls without a compatible-version and capability handshake. Android promotes a newly paired client before description negotiation. |
| FAIL | Apple durable credential completion | [Keychain save and clear](apps/apple/Sources/SharedAppleRemoteCore/LinkKeychain.swift#L31) discard Keychain status codes. Pairing/unpairing can report success despite a failed durable replacement/deletion, allowing the old identity to remain restorable. |

Apple uses a device-only Keychain password item; Android encrypts software signing-key bytes with a Keystore AES/GCM key and disables backup. These facts do not establish non-exportable signing keys, absence of secret logging/export, reinstall safety, or physical-device recovery. The Android client also imports JDK `java.net.http`; Android runtime availability needs its real app build, not only JVM core tests.

## Credential shutdown finding

The shared official [credential provider](packages/credentials/credentials-local/src/index.ts#L857) skips installation of newly read disk state when disposal starts during reconciliation. Its already-admitted write then continues from cached text. A concurrent external credential update can be overwritten. This is a source-established failing interleaving shared with official code, not an attributed downstream regression; a deterministic paused-read/disposal test remains necessary before implementing or certifying a correction.

## Open requirements

- Complete the MITM, DNS rebinding, Origin spoofing, pairing replay/brute-force, lost/stolen device, relay compromise, plugin escalation, command risk, downgrade, unsigned update, log/support-secret leakage, Session replay, and permission-race threat review.
- Verify replay/idempotency beyond the retained timestamp window; pairing-code single-use tests alone do not cover replayed mutations.
- Reconcile the retained three-role model with the required Viewer/Collaborator/Controller/Owner permissions and verify every executor path.
- Verify active-stream revocation races, teardown, re-key/reinstall rules, secure-store recovery, and same-candidate platform behavior.
- Run applicable SAST, dependency vulnerability, SBOM, signed-update, and support-bundle checks without reusing historical green receipts.

The local Web authentication fence remains intact in the inspected source. The [focused run](.artifacts/upstream-first-review/local-web-auth.log) passed 25 assertions across Host/Origin trust, loopback classification, and browser authentication. This does not establish the full alternate-carrier, physical-network, or threat matrix. Remote access must use explicit encrypted, device-authenticated carriers rather than exposing the ordinary local Web listener publicly.
