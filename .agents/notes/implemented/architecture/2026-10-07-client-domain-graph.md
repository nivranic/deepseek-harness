# Agent Note: Client packages route shared surfaces through the contract layer

Status: implemented

English | [中文](2026-10-07-client-domain-graph.zh.md)

## Problem

`verify-client-domain-graph` enforced its three-layer model (contract/ shared API, domain implementations, apply/index assembly) with 37 standing violations across two packages: ui-sidebar-documentpreview carried 33 (eight format domains importing the document domain's contract/registry, the diff domain importing the code domain's language table, and four top-level non-assembly files — face, store, rpc, TextPreview — importing domain implementations), and ui-conversation carried 4 (the skeleton-domain InputBar importing the input domain's editor components and submission policy). The violations predate the gate's model; both packages were grandfathered as an open hygiene baseline.

## Decision

1. **ui-sidebar-documentpreview**: a `src/client/contract/` layer now holds the shared surfaces verbatim — document/contract, document/registry, document/sniff, bytes/transfer, code/languages, and text/lines moved there; the three body-id constants moved into a new `contract/body-ids.ts` with the text/image/binary domain indexes re-exporting them. All seventeen domain-to-domain imports and sixteen top-level-to-domain imports now target `contract/*`; the top-level four files stay top-level (moving them into a domain would immediately create nine new violations from the domains that legally import them today). The document domain keeps only `admission.ts`; the bytes domain disappears.
2. **ui-conversation**: `resolveSubmitMode` moved into the existing `contract/composer-submission.ts` (which already owns its type contract), with `input/submission-policy.ts` keeping a one-line re-export so its two specs are untouched; the three editor files whose only production consumer is the skeleton InputBar (`ComposerContentEditable`, `DecoratorPortals`, `keymap`) moved into the skeleton domain. No React component enters any contract layer — the nine-package precedent keeps contract/ as `.ts` shared API only.
3. The client slot catalog regenerated for the SlotMap declaration's new directory segment.

## Alternatives considered

- **Re-export barrel in contract/**: rejected — contract/ importing a domain is itself a fresh violation; the checker exempts no contract-to-domain edge.
- **Moving the four top-level mechanism files into a domain or index.ts**: rejected — face/store/rpc are owner-side mechanisms that domains legally import today (domain-to-top-level is allowed); relocating them would create nine new violations and bloat the assembly shell.
- **Putting the editor components into contract/**: rejected — contract layers carry types, slots, and pure functions; components live in their consuming domain.

## Consequences

The gate reports `client domain layering clean` (37 to 0) with both packages' suites green (documentpreview 380 passed + the pre-existing local-only pdf-license-bundle npm-pack timeout pinned below; ui-conversation 465 passed) and both leaf tsc builds clean. About twenty documentpreview test files re-pointed imports mechanically; `lines.client.spec.ts` needed zero changes because TextPreview keeps its re-export. One test in the audit lineage (`keymap-routing.client.spec.tsx`) changed only an import path, keeping the 87-file/1073-test audit counts stable.

## Open follow-ups

- The pdf-license-bundle spec fails locally on a clean HEAD too (spawnSync's ~5s budget against a 17.2s local `npm pack` once `lib/` exists); it is outside the audit lineage and green in CI — recorded as a host-timing baseline, not repaired here.
- The file-upload `admitEncodedImages` classification ruling stays open (the dependency policy file forbids automated agents adding exceptions).
- The loader-composition e2e baseline (consent env point + unlocated Windows `.sessions` behavior) stays open.
