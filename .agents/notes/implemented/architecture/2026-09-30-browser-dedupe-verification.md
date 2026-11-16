# Agent Note: The real-browser upload deduplication hit and the namespace access fix it exposed

Status: implemented

English | [中文](2026-09-30-browser-dedupe-verification.zh.md)

## Problem

The browser upload-deduplication increment shipped with unit coverage only: no real-browser lane exercised the hit, and the page-side probe had never run against a composed web client. A real-browser lane also had to pin the page-scoped memory decision — a stored-object skip must come from the page memory, not from Host-side carrier handling.

## Decision

- A model-free real-browser lane (`apps/web/tests/file-upload-dedupe.e2e.ts`, real chromium over the shipped web scaffold) picks a file, then the same bytes under a second name in the same page, then distinct bytes, then the same bytes in a fresh page context. Carrier requests are counted through the upload route; the Host store is statted through the isolated harness home. The lane asserts: the real Host descriptor advertises `file-upload.dedupe.v1`; the remembered re-upload issues one digest RPC and zero carrier requests; the stored object's mtime and size are unchanged (zero rewrite); the remembered display name is published as a new alias beside the object; distinct bytes and the fresh context both pay the carrier, pinning the page-scoped lifetime.
- Running the lane for the first time exposed that the probe had never been callable in a composed page: `FileUploadRuntime` read `ctx.remote.fileUploads` through direct property access, which the Cordis reflection guard rejects for a service invoked from another fiber ("cannot get property without inject") — the unit harness's provided `remote` object hid the guard. The class now declares `inject = ['remote', 'remote.fileUploads']` (load-order dependency, the ui-commands/ui-model-selection pattern), the client entry declares the same namespace, and the access resolves through `ctx.get('remote.fileUploads')` so it stays attributed to the service's own fiber, failing loudly as `host/capability-unavailable` when the namespace is not mounted. The unit harnesses provide the namespace via `ctx.reflect.provide` the way ui-model-selection's tests do.
- With the probe callable, the retry-after-withdrawal lane's expectation changed truth: re-uploading bytes this page already delivered now re-stages by digest without a second carrier transfer, so `file-upload-capabilities.e2e.ts` records `retryRestagedByDigest` instead of a repeated carrier upload.
- Lane registration follows the sibling pattern: excluded from the client-registered `apps/web` program, listed in the host-plane program (`tsconfig.host.json`) that checks these scaffold-importing lanes.

## Alternatives considered

- **Extend the model-replay round lane with a second pick:** would re-record its fixture (needs a real model key) to test a path that issues no model call at all; a sibling keyless lane is cheaper and replay-stable.
- **Assert the skip only through stored-object mtime:** a full carrier re-upload of identical bytes could also leave committed objects untouched depending on store internals; the fresh-context control plus the counted carrier route separate the page-memory cause from Host-side behavior.
- **Keep the direct `ctx.remote.fileUploads` access and add only the static inject:** the guard attributes property access to the calling fiber's inject chain; `ctx.get` on the service's own context is the same idiom the class already uses for `connection` and works under every composition.

## Consequences

- The deduplication hit is now proven in a real browser over the shipped web composition, closing the browser-upload-dedupe note's open verification item.
- Any future change that breaks the probe path — capability advertisement, namespace mounting, or the runtime access — fails this lane instead of silently degrading to full transfers.
- Two local-environment drifts were verified pre-existing at HEAD (stash runs) and are not addressed here: a micromark-util-types dual-version type-identity error in `ui-primitives/markdown/parse.ts` under a fresh local client-program build, and the round lane's platform status-bar aria golden; CI's fresh installs pass both.

## Open work

- The carrier counter observes page-context routes only; a worker-local carrier (if one is ever introduced) would need its own counting seam.
- The fresh-context control shares the authenticated URL but not localStorage; it pins the page-scoped memory, not cross-tab behavior.
