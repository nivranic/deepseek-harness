# Agent Note: The Read-Only Diff Viewer on Android and Apple

Status: implemented

English | [中文](2026-08-31-android-apple-diff-viewer.zh.md)

## Problem

The tool trajectory showed raw argument JSON, so a write or edit arrived as an unreadable escaped string: the companion could see that files changed but not what changed in them. Chapter 55 schedules a first-version read-only diff review — file list, hunks, counts — with no mobile patch editing.

## Decision

The projection is a pure function beside the fold, not a fold change: `fileChanges(toolCalls)` maps completed calls to one `FileChange` each, so the chapter-62 conformance fixtures stay untouched. It reads the host's model-facing fs vocabulary — `write` (`file_path`/`content`), `edit` (`file_path`/`old_string`/`new_string`), and `str_replace_editor` (`path` plus `command`: `create` uses `file_text`, `str_replace` pairs `old_str`/`new_str`, `insert` adds `new_str`; `view` reads nothing and projects nothing). Only completed calls project: a failed write changed no file, and a running one has not yet. Arguments decode at the model/tool JSON boundary, so malformed or non-object payloads skip as absent referents. One hunk per call — removed lines then added lines, no merging across calls — with a single trailing newline opening no last empty line; an empty write honestly projects a zero-line change.

Both UIs render the collapsed presentation symmetrically: the card always shows path, `+N` green and `−M` red, with the hunk lines behind an expand toggle (Compose `DiffReview` under the call row; SwiftUI `DisclosureGroup` in `ToolCallRow`).

## Consequences

FakeWire-driven tests on both sides pin the same scenarios: a write with a trailing newline folds to exactly two added lines, an edit pairs one removed with one added, an `insert` adds alone — while `view`, a failed write, an unknown tool, a still-running call, and malformed JSON all project nothing. A second test pins the zero-line empty write and a multi-line `str_replace`. Both lanes verified green; the artifact viewer (chapter 56) remains the next scheduled polish.

## Alternatives considered

Merging per-path changes across calls was rejected — one review unit per call keeps the trajectory auditable and the projection trivially replayable. Consuming the host's structured diff result metadata was deferred — the flattened `resultText` the fold keeps cannot carry it, and widening the fold would touch fixtures pinned in three languages for a first version that arguments already serve.
