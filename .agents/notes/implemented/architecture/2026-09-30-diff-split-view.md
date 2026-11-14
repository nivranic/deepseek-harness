# Agent Note: Split view for the section 34 Diff preview

Status: implemented

English | [中文](2026-09-30-diff-split-view.zh.md)

## Problem

The section 34 Diff Viewer rendered every `.diff`/`.patch` as one unified sequence. The spec keeps unified as the default everywhere and allows split presentation on desktop-class surfaces, and the package README carried "split-diff presentation remains optional and unimplemented" as deferred work.

## Decision

- A pure pairing module (`diff/split.ts`, no React or DOM) turns parsed unified rows into split rows: context lines appear on both sides; one context-free run of removed and added lines pairs positionally (first removal with first addition), the longer side's tail pairing against an absent opposite; preamble, hunk, and note rows stay full-width and keep their unified index so file links and syntax spans keep addressing the source rows.
- `DiffBody` gains a per-tab view toggle (`aria-pressed`) in the existing toolbar; unified stays the default on every viewport, satisfying the phone default while desktop readers get split on demand. Split rows reuse the same virtualizer — one paired line stays one virtual row — and each half renders its own gutter, marker, change colouring, and the shared syntax spans looked up through the side's unified index. Full-width split rows (headers, hunks, notes) render exactly as unified rows, keeping the current-file open action.
- Proof: pure-pairing unit tests cover positional replacement alignment, pure deletions/insertions, longer-side tails, boundary flushes, and index retention; component tests cover the default view, the toggle round trip with `data-diff-view`/`data-diff-side-kind` semantics, and the blank opposite side; `diff-preview.e2e.ts` extends the real-browser lane — toggle into split, paired halves with per-side gutters, geometric old-left/new-right layout, toggle back — and the golden grows the split line.

## Alternatives considered

- **Persist the chosen view across tabs or sessions:** a viewer-level preference store adds state ownership for a one-tap toggle; per-tab ephemeral state keeps the surface local, and persistence stays deferred.
- **Re-pair with a word-diff alignment inside each pair:** section 34's shared-capability list stops at hunk/added/removed; intra-line alignment is a separate feature with its own cost, kept out.
- **A separate split renderer registration:** the pairing is a projection of the same parsed rows over the same scrollport, paging, copy, and open-file seams — one renderer with a view state avoids duplicating every shared capability.

## Consequences

- The diff preview now offers both section 34 presentations; virtualization, paging, copy, syntax highlighting, and current-file opening are shared between the views, not forked.
- README (both languages) replaces the deferred-work sentence with the split contract.

## Open work

- The toggle is per tab and resets to unified on reopen; no cross-tab or persisted preference.
- No intra-line word highlighting inside a paired line.
