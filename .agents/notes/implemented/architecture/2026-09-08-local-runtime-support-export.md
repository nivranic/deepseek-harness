# Agent Note: Local runtime support exports require scanned immutable bytes

Status: implemented

English | [中文](2026-09-08-local-runtime-support-export.zh.md)

## Problem

Runtime failures can prevent the Web UI from opening. Native diagnostics must remain available in that state without copying credentials, connection addresses, raw output or session content. A successful process exit cannot prove that a scanner examined the final saved document, and missing producers cannot establish application health or permissions.

## Decision

The [Mac runtime exporter](../../../../apps/apple/Sources/DirectHostRuntime/RuntimeSupportExporter.swift) takes a value snapshot of the actual supervisor state and per-application lifecycle counts. Repeated health publication does not increment transition counts. Counts saturate at their unsigned 32-bit representation and disclose saturation. Product metadata is selected and validated from the application bundle; arbitrary dictionary entries never enter the encoded document.

The exporter prepares one bounded UTF-8 JSON value, verifies the bundled scanner and license against its retained identity, and scans in a private temporary directory. Default rules, redaction and disabled allow comments/ignore files are explicit. A synthetic credential must be detected and redacted before the document can be admitted. Scanner exit status and report contents must agree; missing, malformed, oversized, linked or nonempty final reports refuse delivery. Only the exact admitted bytes can construct the native FileDocument. Scratch removal completes before successful delivery, and cleanup failure prevents that delivery.

The existing parent-pipe [Host supervisor](2026-08-31-macos-direct-host.md) has a separate fixed scanner invocation with only canary/export labels and bounded durations. It assembles every scanner flag and path; it exposes no arbitrary argv or shell command. Cancellation and timeout close the parent pipe and await helper exit. The application retains pending export work and awaits it during normal termination. Application death closes the pipe without a Swift callback, allowing the helper to reap the scanner group.

The [candidate producer](../../../../scripts/produce-mac-host.ts) stages the pinned scanner and license, verifies native architecture and deployment target, and records both the acquired and ad-hoc-signed executable digests before sealing the app. The native UI saves ready, stopped and failed-startup documents through the production dialog. An [independent verifier](../../../../scripts/release/support_exports.py) rejects unknown fields and contradictory observations, rechecks the signed scanner, and rescans the saved bytes before publishing their hashes and approved copies. Its acceptance remains specific to runtime diagnostics.

The [Windows packager](../../../../scripts/build-desktop-exe.ts) uses the same pinned installer and [resource verifier](../../../../scripts/release/support-scanner.ts), with the native ZIP license and executable suffix. The acquisition receipt remains separate from the files being packaged, so replacing both a staged file and its local receipt cannot authorize the changed bytes in `afterPack`. The [Windows candidate checks](../../../../docs/development/windows-candidate.md#installation-and-gui-checks) retain that identity through installed and portable execution.

The [Windows exporter](../../../../packages/host/electron-ipc/src/support.ts) adds one desktop-local operation to the existing generated Gateway. It selects staged application metadata, deduplicated Session event counts and optional Link observations. It serializes before asynchronous scanning, passes canary and final JSON through managed subprocess stdin, and admits an immutable document only after the scanner resources still match. Native saving writes those exact bytes to a random exclusive temporary file beside the destination and commits by rename. Cancellation before commit leaves the destination unchanged; cleanup failure remains a failure even when cancellation also occurred.

Configuration defaults resolve at the plugin schema before activation, including an omitted configuration block. A fallback in `apply` cannot handle schema rejection, so the gateway's unit composition retains the exported schema, and the shipped desktop Host composition is exercised by the keyless Link reference acceptance.

Resource identity checks retain `bigint` file and device identifiers from `lstat` and the opened handle. Filesystems can assign identifiers above JavaScript's safe integer range, where distinct values collapse to the same `number`; numeric equality cannot establish that the opened file matches the checked path. Resource size converts to `number` only after the fixed byte limit and unchanged-size checks. The fallback without `O_NOFOLLOW` retains these comparisons.

The Electron application owns a separate unloaded hidden window for each native save dialog. Destroying that owner can close the dialog while preserving the main window. The service's effect disposer revokes new work, aborts and joins the active operation. The Windows candidate driver uses UIAutomation on the actual native controls, compares localized Settings feedback with owner-local expected output, and requires saved, cancelled, invalid-resource and synthetic-secret scenarios. Its independent verifier checks the complete saved document and rescans it before including the exact bytes and screenshots in provenance. Unit doubles and managed scanner smokes cannot establish native dialog or packaged application behavior; that evidence belongs to the disposable Windows candidate lane.

The [Link controller](../../../../packages/api/link-controller/README.md) supplies an unscanned, fixed-field listener/protocol snapshot through the existing Gateway. The carrier and authenticated Host description share one protocol/capability producer. Listener failures contain a category instead of error text, and the query does not read identity or pairing records. The default remote allowlist refuses the query before Gateway execution. Its advertised capabilities remain distinct from effective device grants; listener availability remains distinct from connection and application health.

Finding a native dialog does not establish that its filename pattern is ready. The Windows driver identifies the owning native window and selects one visible, enabled control by its writable ValuePattern and known default filename value. Pattern support owns value access; the provider's Edit label is unnecessary. UIAutomation captions and IDs vary by provider, and virtual controls can have no child window handle. The entered destination is read back before IDOK; IDCANCEL uses the common dialog's cancellation handling. Both native commands retain the original deadline and recheck process ownership. Failed lookup diagnostics use bounded, fixed fields and omit names and values. Pattern advertisement, returned pattern type, read-only state and fixed default-value categories are separate observations; none relaxes filename selection. Pure PowerShell regressions cover delayed readiness, expired budgets, probe failure, value-based selection, read-only and ambiguity refusal, and private-identifier exclusion; actual selection and saving still require the candidate lane.

Win32 control IDs and UIAutomation IDs are distinct observations. Failed lookup diagnostics retain native control/parent IDs and fixed class categories only for handles confirmed as descendants of the selected dialog; raw handles and labels stay private. A common-dialog fixture exercises the same driver before application build, with independently observed save/cancel results and joined child processes. This separates provider/driver failures from application startup without accepting fixture results as packaged-product evidence.

An outer process deadline can expire before UIAutomation returns, so timeout handling joins the driver and retains its fixed phase markers. Window visibility and minimization are recorded independently of descendant readiness. Diagnostic elapsed time includes initialization; the operation clock starts after initialization so short absence observations retain their complete interval.

## Alternatives considered

**Raw-log redaction.** Unknown messages can contain new sensitive fields. A closed projection of state and counts prevents those messages from entering serialization.

**A release-only summary.** Build identity and CI status cannot describe a currently stopped or failed application. The native action reads the running supervisor and works without the Web UI.

**A second telemetry coordinator.** Its shared handoff cursor can interfere with an existing backend and creates an anonymous identity. Native lifecycle counts require neither session replay nor an external telemetry sink.

**Application callbacks alone.** Abrupt termination bypasses Swift cleanup. Reusing the existing parent-pipe helper extends its owned group lifetime without creating another business Gateway or Harness launcher.

Scanner unit tests exercise both Windows and POSIX argument and environment rules on either host, including original-binary refusal and opened-file identity checks without `O_NOFOLLOW`. Settings tests retain fixed public feedback for RPC failures and ignore both resolved and rejected exports after unmount; these doubles do not replace native candidate acceptance.

## Consequences

Mac exports remain incomplete for connection, protocol, role, capabilities, updates, native crash records and session diagnostics. Windows exports list runtime health, connection, effective role, updates and native crashes as uncollected, and require the Settings renderer and Gateway to remain available. Runtime readiness describes the Mac supervisor's authenticated local Web health observation, not provider availability or full release acceptance. Missing desktop/mobile producers and mobile offline scanning remain independent work under the [complete Support Bundle plan](../../../../docs/plans/2026-09-08-support-bundle.md).

The [source-scanning decision](../process/2026-09-05-candidate-security-scans.md) continues to own pinned acquisition and source exceptions; those exceptions never authorize findings in a support export. The [artifact-integrity decision](../process/2026-09-06-candidate-artifact-integrity.md) retains full RC admission. Abrupt helper death, detached tool groups and PTY ownership remain outside this export's cleanup guarantee and still block Full Host no-orphan acceptance.

Swift owner-local fixtures pin complete serialized fields for stopped, ready and failed states. Native tests cover poisoned metadata, real scanner admission, report failures, immutable delivery, cancellation and timeout cleanup. POSIX tests exercise the helper's fixed arguments, finding exit status, forced scanner shutdown and application death. Native compilation and save-dialog behavior require the Apple and Mac candidate lanes; Windows/Linux parser and resource tests alone do not establish those results.
