# Agent Note: Android selects reasoning efforts with the model (§30)

Status: implemented

English | [中文](2026-10-02-android-model-effort.zh.md)

## Problem

Section 30's model-selection promise had one client gap left on Android: the Web picker already exposes per-model reasoning efforts (`ModelSelect` reads the catalog's `model.reasoning` and sends `reasoningEffort` on `session/selectModel`), but the Android picker selected only provider+model — `NativeCatalogModel` parsed no reasoning metadata and `selectModel` sent no effort, so a reasoning-capable Host model could only be chosen at its default effort from Android.

## Decision

- `NativeCatalogModel` gains optional `reasoning: NativeModelReasoning?` (efforts `[{id, name}]` plus `defaultEffort`), parsed from the catalog wire shape the Host already publishes; models without reasoning parse `null`.
- `selectModel(provider, model, reasoningEffort = null)` adds the `reasoningEffort` request field only when non-null — a no-effort selection is byte-identical to the previous wire.
- The picker renders each reasoning model's effort choices as a row of buttons under its model row (testTag `catalog-effort-<id>`): tapping the model row selects at its `defaultEffort`; tapping an effort selects at that effort; the confirmation names both (`已选择 <model> · <effort>`). No new capability, endpoint, or fixture key — the effort rides `session/selectModel` under `model.select.v1`.
- The acceptance lane pairs a real AVD companion to a header-only providers-only replay Host (zero model calls) and proves exactly one device-signed `session/selectModel` dispatch with `provider`/`model`/`reasoningEffort: 'max'`, the `model/selection` session event carrying the same effort, and the on-device confirmation naming model and effort.

## Alternatives considered

- **A separate effort endpoint:** the wire already carries `reasoningEffort` on `selectModel`; a second method would split one selection into two dispatches.
- **Omitting efforts and relying on the default:** a reasoning Host model's effort is a user-visible route property; the Web exposes it, and §30 forbids per-platform vocabulary splits.

## Consequences

- The effort row widens the picker dialog, not the composer row (the model-steer width constraint); a model without reasoning renders no effort row and its wire stays effort-free.
- This note also corrects the §30 traceability record: the model-select increment's remaining text claimed no client exposed `reasoningEffort` — the Web picker already did ([`ModelSelect.tsx`](../../../../packages/client/ui-model-selection/src/client/ModelSelect.tsx)); the true gap, closed here, was Android-only.

## Open work

- Apple-side model-selection (and effort) entry; real-device qualification.
