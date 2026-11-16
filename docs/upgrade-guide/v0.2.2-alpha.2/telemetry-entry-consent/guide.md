---
kind: upgrade-guide
description: "Telemetry consent moves from a separate settings document to the backend Loader entry, and direct telemetry emits no longer export records."
---

# Configure consent on the telemetry backend entry

English | [中文](guide.zh.md)

## Change

The Telemetry settings section reads and writes the `consent` field of the `session-telemetry-otel` Loader entry. It no longer uses a separate `telemetry-consent` settings document. Changes follow the Loader configuration lifecycle.

The OTel backend exports Session records only after explicit feedback and only with `consent.sessionTelemetry` enabled. Consent changes apply live to new captures; previously authorized batches may finish after withdrawal. Direct `sessionTelemetry.emit()` calls do not export records. The other consent fields do not enable additional export channels.

## Migration

1. In your profile configuration, give the `@deepseek-ai/dsh-session-telemetry-otel` entry the id `session-telemetry-otel` to expose its Telemetry settings section. Copy your chosen consent values into that entry's `config.consent`; values in the old settings document are not imported automatically. Omitted fields default to `false`.
2. Keep the backend's `mode` and exporter configuration alongside `consent`. See the [backend configuration](../../../../packages/session/session-telemetry-otel/README.md#use-this-package). `DISABLED` still prevents export even when consent is enabled. Direct TypeScript construction takes `Config(rawOptions)`; `ctx.plugin()` still takes raw options.
3. Open Settings → Telemetry and confirm the five switches match the Host configuration. Save a change and reopen the section to confirm the accepted value. If the entry uses a different id, edit its configuration through its own editor.
4. Remove dependencies on direct operational telemetry exports. Feedback authorization governs Session-log export; enabling another consent field does not restore a direct export channel.
