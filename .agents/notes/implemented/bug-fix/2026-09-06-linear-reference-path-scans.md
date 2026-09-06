# Agent Note: Linear discovery of session mentions and path suffixes

Status: implemented

English | [中文](2026-09-06-linear-reference-path-scans.zh.md)

## Problem

Unanchored regular expressions can repeatedly scan the same suffix when a prompt contains nested unfinished `@[` prefixes or a path contains a long separator run followed by ordinary text. Prompt admission and Workspace display run synchronously, so quadratic work delays other operations on the same thread.

## Decision

[Session mention discovery](../../../../packages/context/session-reference/src/uri.ts) keeps independent forward cursors for Markdown and bare URI starts. Nested candidates reuse their next label and URI delimiters. Label escape handling retains Unicode code-point semantics, and malformed Markdown still permits the same bare URI fallback. The URI codec and first-match order remain unchanged.

[Workspace path helpers](../../../../packages/util/workspace-path/src/index.ts) remove trailing separators with one backwards pass. Windows-aware callers recognize both separators; POSIX home abbreviation recognizes only `/`. Long input is processed without truncation or a new caller limit.

[Sent user-text projection](../../../../packages/client/ui-primitives/src/user-text.tsx) also reuses label and URI delimiters across nested wire candidates and trims token punctuation backwards. Its display grammar remains separate from prompt admission: labels are literal, URI payloads are opaque, and empty labels or payloads do not form session chips. Plain-token overlaps, quoted paths, chip titles, and recall-label precedence retain their existing behavior. Wire discovery and punctuation trimming are linear; recall-label lookup and range sorting have their own costs.

## Alternatives considered

- Limiting prompt or path lengths changes accepted inputs and does not remove repeated work below the limit.
- Excluding nested markers from labels changes the canonical formatter's accepted labels.
- Replacing one backtracking expression with another keeps failure cost dependent on unsuccessful match attempts. Explicit cursors make monotonic progress reviewable without adding a regular-expression engine dependency.

## Consequences

The mention parser has explicit delimiter state to preserve both precedence and linear discovery. Removing those caches requires another proof that unfinished nested candidates cannot rescan the same suffix. Path helpers remain lexical and do not add filesystem access.

Regression cases preserve empty and nested labels, escaped Unicode and line terminators, malformed-reference errors, and bare fallback. Long unfinished prompts and internal separator runs have a generous execution budget. A 25,000-case comparison against the committed parser checks text, references, and error equivalence; focused coverage includes every branch in both changed source files. Recorded model text formats and runtime composition do not change.

Display regressions separately retain its literal-label grammar and overlap precedence, compare rendered markup with the prior implementation, and exercise long unfinished wire forms and internal punctuation. Existing inline styling and glyph tests remain authoritative for presentation.
