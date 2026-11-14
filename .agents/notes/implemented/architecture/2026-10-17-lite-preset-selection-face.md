# Agent Note: Lite sessions select their preset from the bundled projection

Status: implemented

English | [中文](2026-10-17-lite-preset-selection-face.zh.md)

## Problem

Section 33 closes with "Lite only composes context through profile/preset combinations", yet an assembled Lite session always ran the projection's lowest-order preset: `LiteSessionAssembler` took no preset id, `LiteChat` submitted `presetCatalog.defaultSystemPrompt`, and the session facts named the preset source without naming the preset. The section's own remaining line pinned the gap: the preset selection UI was still to be built. A selection face must also survive two facts of the current catalog: the bundled projection carries exactly one selectable preset today (`minimal`; the other three shipped presets are structurally excluded for requiring runtime variables), and a stored selection is a configuration migration subject to section 46's atomic, recoverable, no-silent-drop rules.

## Decision

Selection is a lookup on the existing catalog, never a second preset model. `LitePresetCatalog` gains `preset(id)` (a pure find) and `resolve(id)` (one resolution: null takes the lowest-order default; an id the catalog does not carry fails loud, naming the id, the source, and the carried ids — Lite never guesses a substitute, the section 32 rule applied to personas). `LiteSessionAssembler` accepts an optional `presetId` and resolves through the bundled catalog; `LiteChatViewModel` carries the resolved descriptor as `selectedPreset` and submits its assembled prompt unchanged on the default path. The session facts gain `presetId: String? = null` — the resolved value is catalog data, never a constant, so the default stays null for projection-less construction faces while a bundled assembly publishes the id actually in effect (the host's `agent-preset/selected` observability precedent). Persistence reuses the optional-field precedent: `LiteConfig` gains a nullable `presetId` that loads as null when the key is absent or JSON-null — a pre-selection sealed file reads unchanged, zero migration — and saves with the key omitted when null, byte-identical to the old three-key form. The config form gains a preset row with a picker dialog over the catalog's actual entries; with the one-entry catalog it shows that single row, honestly, and the save gate additionally requires a stored id to be carried by the catalog. The assembly cache key includes the effective preset id, so a changed selection reassembles rather than reusing a cached chat.

## Alternatives considered

Pinning the preset outside the config file (pure UI state or a side store) was rejected: the selection would not survive process death and would bypass the sealed-config atomicity the endpoint credentials already ride. Making `presetId` a required key was rejected: every pre-selection sealed file would read as corrupt and demand re-entering all three credentials — the opposite of section 46's recoverable rule. Falling back to the default on an unknown stored id was rejected: the projection is the only authority on what exists, and a silent substitution is the guess section 32/33 forbid; the loud failure names the id so the operator can re-save. A disabled fixed row for the one-entry catalog was rejected: a picker whose list happens to hold one entry is the honest form — it neither fakes plurality nor hides the choice. A host-side change (re-projecting more presets, capability gating) was rejected: the three exclusions are structural (runtime variables), and the selection reads the already-bundled projection bytes.

## Consequences

An assembled Lite session now states which persona it runs — `presetId` in the facts, the selected prompt at the provider — with the default path byte-identical to the previous behavior. Pre-selection configs load unchanged, and a stored selection round-trips under the seal with the key omitted when null. One accepted edge: if a future projection drops a stored id, the config branch fails loud at composition time naming the id (the no-guess rule's direct consequence; re-saving the config recovers). The instrumented chain covers the form naming the bundled default preset and the facts equality now pinned at `presetId = "minimal"`. Core tests grow by nine across catalog, facts, stores, and view-model; the connected round passes four cases including the new preset-row assertion.

## Open follow-ups

A config-face failure line for the stale-id composition failure (self-heal without re-entering credentials); re-projection should more presets shed their runtime variables; the RelayClient java.net.http migration or retirement; journal resume; the support-export facts projection; the approval ask tier; attribution headers; the section 54 network matrix on-device verification.
