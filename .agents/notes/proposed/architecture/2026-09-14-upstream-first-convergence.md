# Agent Note: Converge downstream platform capabilities onto official upstream

Status: proposed

English | [中文](2026-09-14-upstream-first-convergence.zh.md)

## Problem

The downstream implementation and current upstream both contain Desktop lifecycle, API, Client, and persistence work. Importing the downstream tree wholesale would restore parallel owners and can misinterpret released Session data. Historical platform receipts identify older source commits and do not qualify the new combination.

## Proposal

Use the captured official commit as the isolated candidate baseline and review each downstream capability before porting it. [The task inventory](../../../../CUSTOM_CAPABILITY_INVENTORY.json) owns source commits, dispositions, and pending review; [the execution plan](../../../../docs/plans/2026-09-14-upstream-first.md) owns ordering.

The official [Desktop decision](../../implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md) remains authoritative for Electron, bundled runtime, profile ownership, framing, and updates. Windows and macOS use that one application. Native companions contribute platform integration and presentation without owning Agent or Session truth.

The existing Typert Gateway, ConnectionController, and Session Controller client own RPC, connection generations, and Client state. Remote transport must preserve the local browser trust policy. Host services own interaction resolution, mutation deduplication, device authority, and capability advertisement.

## Persistence and compatibility

The [released-format migration decision](../../implemented/architecture/2026-08-31-released-session-format-migrations.md) remains authoritative. Legacy SQLite Session generations and versioned downstream settings require explicit conversion designs and isolated fixtures before any user-data operation. Keep previous generations and never infer fallback or downgrade support from their existence.

Product version, API protocol version, and Session writer version remain distinct. Native clients consume generated Remote data rather than parsing Session disk formats. Historical compatibility receipts cannot satisfy the candidate matrix.

## Alternatives considered

**Merge the entire downstream tree onto upstream.** The branches overlap in hundreds of changed paths, including independent Desktop and persistence implementations. Resolving textual conflicts alone would not establish correct ownership or data compatibility.

**Continue on the old Goal worktree.** This retains the older API and storage assumptions while adding more code that must later move. The old branches instead remain preserved sources for capability review.

**Discard all downstream capabilities.** Device trust, native secure storage, diagnostics, and support tooling may retain value. The inventory keeps those decisions explicit without importing their old architecture automatically.

## Acceptance criteria

Gate 0 requires a fixed upstream SHA, complete worktree capture, reviewed patch dispositions, and an actionable migration plan. Later qualification requires one Desktop implementation, shared Host/API ownership, explicit data conversion, cross-language compatibility, and source-bound platform evidence. Existing source tests do not replace application, device, signing, or release validation.

## Risks

Reintroduction can omit useful downstream behavior; inventory entries remain open until each is adopted, adapted, migrated, deliberately excluded, or isolated as experimental. Candidate launch against historical product data is prohibited until conversion behavior is verified. Source snapshots must be refreshed if a contributing branch or dirty file changes.

The two linked official decisions remain active and are not superseded: this proposal governs downstream selection and porting, not their runtime or released-data rules. No historical Agent Note is archived by this proposal.
