# Agent Note: One pinned diff corpus feeds all three diff renderers' tests

Status: implemented

English | [中文](2026-10-26-shared-diff-corpus.zh.md)

## Problem

Three client surfaces render diffs from the same jsdiff output but had no shared fixture: ui-primitives counts whole sides through `diffTotals`, the trajectory transcript maps `structuredPatch` hunks into prompt-diff rows, and the document preview parses accumulated unified text through `parseUnifiedDiff`. Each package tested its own hand-written inputs, so an upstream jsdiff change or a consumer rewrite could drift one surface against the others with no failing test that names the disagreement. The trajectory mapping was also locked inside `TrajectoryTable.tsx` as a private function, untestable without the component tree.

## Decision

Host the corpus in `packages/client/ui-primitives/src/DiffCorpus.ts` — the package both other consumers already depend on — as eleven pinned cases (`singleLineReplace`, `trailingNewlineAdded`, `identical`, `create`, `delete`, `scatteredHunks`, `farScattered`, `cjkEmoji`, `crlf`, `blankLineChange`, `blockReplace`) captured from real `structuredPatch('', '', before, after, undefined, undefined, { context: 3 })` output. Each case records the before/after pair, its hunks with prefixed lines including `\ No newline` notes, the patch +/- counts, and both sides' content-line counts. One spec per consumer asserts its own view: ui-primitives checks `diffTotals` against the recorded content-line counts (create is `oldText: null`, delete's empty `newText` is zero lines); the trajectory spec now lives against an extracted pure module `src/client/prompt-diff-lines.ts` (headers kept, blank meta separator between hunks, notes dropped, identical is empty) with `TrajectoryTable.tsx` importing it; the documentpreview spec assembles the unified text from the corpus hunks and asserts the full parsed row sequence — hunk starts, both gutters numbering line by line, note rows carrying their backslash, and add/del counts matching the pinned patch counts. The corpus deliberately keeps two count families visible: patch counts (changed lines only) and whole-side counts (every line), which agree per case but measure different things. `farScattered` pins the two-hunk shape (`context: 3` bridges nearer edits into one hunk, as `scatteredHunks` shows), and the identical case pins zero hunks on both consumers.

## Alternatives considered

Deriving each consumer's expectation inside its own spec was rejected — the corpus would exist only as narrative, and drift between specs would stay invisible. Generating the corpus at test time from jsdiff was rejected — it would re-derive the pinned values from the code under test and fail only when the library's output shape changed, not when a consumer disagreed with it. Hosting the corpus in a new shared fixture package was rejected — ui-primitives is already the common dependency and the corpus's whole-side counts are the same rule `DiffBlock` ships.

## Consequences

The three diff surfaces now share one fixture, and any jsdiff upgrade or consumer rewrite that drifts a pinned field fails at the owning spec; §34's shared Diff matrix lands with this note. The partial-download resume semantics and the range read window against the attachment store stay on the ledger — the presentation side of partial download (`data-diff-eof`, `copyLoaded`) was already pinned by the existing diff-body spec, and the remaining work is store-side. While running the regression suites, the ui-primitives icon-set spec failed 79 against its pinned 78: commit 98802d5ad8 added `IconOverflowVertical16` without bumping the count, a HEAD-existing drift since 2026-10-03 — fixed here to 79 with the glyph pinned by name, and the `code-block` grammar-lazy-load test's 5-second timeout under full-package parallel load is recorded as a host-load transient (it passes in isolation repeatedly and its surface is untouched by this change).
