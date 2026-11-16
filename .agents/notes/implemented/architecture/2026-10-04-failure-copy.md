# Agent Note: Section 45 shared Remote-failure copy across Client surfaces

Status: implemented

English | [中文](2026-10-04-failure-copy.zh.md)

## Problem

Section 45 demands that every Client present the same error with the same semantics. The typert failure vocabulary already classifies codes, and four surfaces consumed it — but each carried its own partial key family, while the survey found five clusters rendering Remote failures as raw `message (code)` text: the composer's steer notice (the same Steer failure the queue dock already classified — one operation, two semantics inside one feature), the prompt-failure toast (two attachment codes semantic, every other code raw), GoalBar's action errors, the workspace browser's three rename/delete dialogs, and the model selector's `code: message` strings.

## Decision

- The canonical copy lives in the **common vocabulary**: nine keys (`failure.authentication` … `failure.raw`), zh and en, added to `client-locale`'s shipped dictionaries. This is one dictionary with one home — no per-package duplication to drift. Both levels make it universally reachable: the type level merges `CommonKeyOf` into every `LocaleKeysOf<N>`, and the runtime lookup chain consults `common` after the entry namespace misses.
- `remoteFailureCopy(error, t)` classifies through the typert vocabulary and returns the class copy; `unknown` classes and non-Remote values route the raw diagnostic through the `failure.raw` template — presentable unchanged, never invented. `remoteFailureClassCopy(cls, message, t)` serves stores that classify at write time (a class field on a translator-free store). The parameter is a `FailureCopyKey`-keyed translate — any namespace-bound translate satisfies it structurally, so adopting the helper forces the dictionary coverage by typechecking.
- Migrated clusters: the steer notice (now identical to the queue dock's semantics), the prompt toast (attachment codes keep their reason-keyed product copy; everything else classifies), GoalBar (goal-local failure codes resolve to the raw template — their product copy is open work), the three workspace dialogs (the session-rename `conflict` refinement stays feature-owned: strictly more precise than the class copy, same family), and the model selector (both stores carry `errorClass`; three render sites prefer class copy with the feature action line as fallback).

## Alternatives considered

- **A shared registered namespace each surface binds:** needs service access at every consumer; the common fallback already provides the same reach through the existing `t` seats.
- **Per-package key families (the status quo):** five new translations per surface, guaranteed to drift; the spec asks for one semantics, not five.
- **Storing raw `code: message` strings and classifying at render:** the store loses the code by the time the translator exists; classifying at the store write keeps the state serializable and translator-free.

## Consequences

- Raw `(code)` suffixes disappear from user-visible copy on the migrated surfaces; unknown codes keep the provider message verbatim. Assembly-level tests that constructed `LocaleRuntime` directly now register the common dictionary, mirroring the browser entry's `apply`.
- Existing classified consumers are untouched; their key families remain valid specializations.

## Open work

- The provider-code domain (durable `turn/end` failures) is open, not part of §45's closed vocabulary; only `AUTH` is localized there. Approval-answer failures are silent, and the file-upload attachment state stores raw messages it never renders. Remaining Remote surfaces (sidebar files/preview per-code switches, ChatView's dormant open-file dialog) can adopt the helper in later tranches.
