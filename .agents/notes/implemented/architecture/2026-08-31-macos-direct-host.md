# Agent Note: The macOS Direct Host target

Status: implemented

English | [中文](2026-08-31-macos-direct-host.zh.md)

## Problem

Chapter 49 names four targets; three shipped (iPhone/iPad and Mac companions) while the macOS Direct Host — the host-side runtime surface — existed only as a line in a limitations list, with no target graph proving host code could stay isolated from the companions.

## Decision

`project.yml` grows `DirectHostMac`, a macOS application whose sources live under `Hosts/` and belong to no companion target — chapter 49's isolation rule made structural: host-only code cannot leak into iOS, iPadOS, or the Mac companion because it is not in their source lists. The target depends on no package product; the host face is its own thing. `HostHomeView` lays out the host's three administration concerns — remote access, pairing issuance, and paired devices — each an `HostEmptyState` that says plainly the embedded runtime has not landed, honoring the plan's holding position that Runtime Authority stays on the desktop host. The lane builds the scheme beside the companions.

## Consequences

All four chapter-49 targets now exist and build on the lane (55 tests plus three app schemes). The skeleton is deliberately honest: no fake toggles, no invented device rows — the empty states name what each card awaits. Embedding the host runtime is the plan's own later phase and now has a target waiting for it.

## Alternatives considered

Reusing CompanionUI for the host face was rejected — the companion surface consumes a host; the host administers one, and mixing them invites exactly the pollution chapter 49 forbids. Deferring the target until the runtime embeds was rejected — the isolation boundary is cheapest to prove while the host code is small.
