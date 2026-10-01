# Agent Note: The Android model picker joins the shared capability contract (§30)

Status: implemented

English | [中文](2026-10-01-android-model-select.zh.md)

## Problem

Section 30's model-selection promise was half-kept: every Host advertises `model.select.v1` and `model.catalog.v1`, and the Web client ships a model picker (`dsh-client-ui-model-selection`), but the Android companion had no selection entry at all — no `session/modelCatalog` or `session/selectModel` call, no picker, no confirmation. A Session's model could only be chosen from the Web client.

## Decision

- Android observes both capabilities through `NativeObservedCapability.MODEL_CATALOG` (`model.catalog.v1`) and `MODEL_SELECT` (`model.select.v1`), mapped from `session/modelCatalog` and `session/selectModel` in the gateway diagnostics table; the support-export fixture gains both observed-capability keys in enum order, and the Host capability detail list gains localized 读取模型目录 / 选择会话模型 entries.
- `SessionModel` grows `selectModel(provider, model)` — the `cancelActive`-shaped `{request:{sessionId, provider, model}}` envelope — and `modelCatalog()`, which parses `groups` and `default` into `NativeModelCatalog`/`NativeCatalogGroup`/`NativeCatalogModel`. The catalog call is zero-parameter on the wire: it must send an empty args object, because the gateway's strict argument check rejects any extra key — the sibling `session/list`'s `_request` parameter name is a signature fact of that method, not a template for no-arg calls.
- `SessionModelSelection` renders a 模型 entry (`session-model-select`) only when the Host advertises `MODEL_SELECT` and a Session is open, placed in the session screen outside the composer row (the model-steer one-row composer constraint). The first open loads the catalog once per Session and shows the picker; tapping a model sends one `selectModel`, dismisses, and confirms by name (已选择 …); load and select failures render inside the dialog.
- The acceptance lane pairs a real AVD companion to a replay Host booted providers-only over a header-only fixture: selection drives no model call, so the replay scaffold validates the fixture call-free at boot instead of asserting script consumption at teardown (the scaffold still mounts the replay provider catalog, so `session/modelCatalog` stays answerable). The lane proves exactly one device-signed `session/selectModel` dispatch (`args.request.provider`/`args.request.model`), the resulting `model/selection` session event, and the on-device confirmation — no prompt or turn is involved.

## Alternatives considered

- **Reusing the call-bearing live-interactions fixture and driving a model call to satisfy script consumption:** selection is not a turn; a fake call would invert the contract. A header-only fixture with `replayProvidersOnly` is the scaffold's designed exit for call-free scenarios.
- **Loading the catalog when the Session opens:** the catalog is Host-dynamic (routable providers, failures); loading on first picker open fetches nothing for Sessions that never select.
- **Placing the entry inside the composer row:** a wider row re-triggers the phone-width overflow that collapses the session list ([2026-10-01-model-steer](2026-10-01-model-steer.md)).

## Consequences

- Every Host advertises `model.select.v1` today, so the unadvertised path is exercised by the capability-withholding unit surface (support export) only.
- The confirmation text shows the model name from the successful selection; the authoritative record is the `model/selection` session event, already required-on-read vocabulary.
- Zero-parameter gateway calls from Android send `emptyMap()` args; any future no-arg endpoint follows the same shape.

## Open work

- `reasoningEffort` selection has no Android UI (the wire accepts it; no client surface exposes it yet).
- Real-device qualification stays open; the lane runs on a local AVD replay Host.
