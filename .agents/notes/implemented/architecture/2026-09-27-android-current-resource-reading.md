# Agent Note: Native file and delivery previews share bounded current Host reads

Status: implemented

English | [中文](2026-09-27-android-current-resource-reading.zh.md)

## Problem

An Artifact pane keyed by historical artifact ids cannot resolve the current Host's file deliveries. Unbounded byte caching also makes a large file consume mobile memory, while retrying after a file changes can combine unrelated versions. The native companion needs the same Session-scoped file operations used by current clients.

## Decision

Android projects durable `deliverables/presented` declarations into file references identified by event sequence and original file index. Paths retain their exact spelling and optional descriptions remain model-authored text. A declaration grants no permission: the selected Session and the [workspaceFiles namespace](../../../../packages/api/workspace-files/README.md) determine file access. The application has no `session/artifact` read or artifact-id byte cache. Historical Lite stores and folds remain separate protocol fixtures.

Workspace entries and declared deliveries share one native reader. It first calls `workspaceFiles/stat`, then serially requests `workspaceFiles/readBytes` windows. The descriptor retains the Host's absolute path, opaque version and optional complete byte size. Each response must preserve those fields, match the requested offset, decode canonical bounded base64 and make consistent EOF progress. A failed read retains only accepted bytes; explicit retry re-stats and starts at the first missing byte. A changed descriptor discards the prefix and requires a fresh open.

The application supplies limits: 64 KiB windows, an 8 MiB retained-content budget, and a 256-byte prefix. A known larger file requests only that prefix; a file with unknown size stops at the retained budget. Both report an incomplete preview. Complete content may require an additional bounded copy when chunks are joined; the accounting is not a total-heap bound. Rendering separately limits text to 64 Ki characters and image decoding to four million pixels. Unsupported or invalid content remains an inert hexadecimal prefix; HTML and SVG never execute.

Selection replacement and close cancel owned reads. Cancelled jobs remain owned until completion, and generations reject late publication. Model retirement waits for request cleanup. Application Session selection closes its previous resource even when another tab is active. A decoded bitmap is displayed only for the exact byte array that produced it, preventing a prior image from appearing during a new selection.

The [native transport decision](2026-09-25-native-remote-connection-source.md) still owns TLS, admission and model lifetime. The [view-location decision](2026-09-26-android-native-view-location.md) still owns retained Session history. This decision extends their consumers without superseding their independent rationale.

## Alternatives considered

**Restore a parallel artifact-id service.** Current file deliveries identify paths under a Session's filesystem scope. A second service would duplicate authorization and preserve an unavailable application protocol.

**Read every file into memory or resume without re-statting.** Unbounded content exceeds mobile budgets; a retained prefix cannot be combined with bytes from a changed version. Bounded previews and explicit restart preserve truthful completeness and version information.

## Consequences

Core coverage exercises empty and Unicode-named files, range validation, interrupted reads, descriptor changes, byte budgets, current delivery projection, Session replacement and awaited cancellation. Installed-app acceptance uses real Host operations with generated files and seeded current delivery events, including image pixel rejection and a large-file prefix. Complete-byte SAF export follows the [save decision](2026-09-27-android-complete-resource-save.md). Live models, physical devices, persistent downloads, camera/photo attachment, Swift adoption and all-platform descriptor acceptance remain separate qualification work.
