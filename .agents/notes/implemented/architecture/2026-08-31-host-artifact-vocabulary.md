# Agent Note: The Host Artifact Vocabulary

Status: implemented

English | [中文](2026-08-31-host-artifact-vocabulary.zh.md)

## Problem

Chapter 56 makes artifacts first-class journal objects, but the host session stream had no artifact vocabulary: every plugin domain event had a home (`todo/write`, `plan/mode`, `goal/change`) while artifacts existed only in the Lite runtime's spec. The three companion folds already consume the Lite shapes — the artifact pane shipped as honestly empty, pinned by conformance fixtures that could not name a real host event (the scenario builder is typed on `SessionEventMap`, and no member existed).

## Decision

A new vocabulary-only package, `@deepseek-ai/dsh-artifact` (`packages/artifact/artifact`), declares the host face as a declaration merge: `artifact/created {id: ArtifactId, kind, title}` and `artifact/status {id, status}` — references, metadata, and status only; content bytes never ride the journal (chapter 56), they belong to the resource channel the future host producer owns. The shapes match the Lite vocabulary the folds already consume, so one set of fold branches serves both event sources. `ArtifactId` is branded (`Branded<'ArtifactId'>` from `dsh-brand`) with a constructor in this package. Adding members is vocabulary, not structure: `SESSION_FORMAT_VERSION` stays, and the regenerated known-event guard makes older builds refuse logs carrying the new types instead of misreading them. The golden scenario set gains `artifacts` (created → ready, second artifact, repeat created re-pushing pending, failed last-write-wins, orphan no-op), regenerated through `gen-link-contracts` into all three conformance locations; the TypeScript spec pins the derived pane, and the native lanes replay the fixture through their existing folds. The persistence catalog and its generated known-event set regenerate; the model-experience gate audits the package as vocabulary-only. No host producer emits these events yet — that tool (and the host resource channel it needs) is the next increment; until then recorded sessions stay free of artifact events, which is why no recorded-session snapshot changes.

## Consequences

The companion artifact pane is consumable from real host events the moment a producer appends them; the wire vocabulary is pinned symmetrically by fixtures in TypeScript, Swift, and Kotlin. The remote wire's `LinkSessionEventKind` enum still lists its 13 tags — folds consume raw event records, so growth of that manifest enum is not required for consumption and stays a follow-up with the producer.

## Alternatives considered

Declaring the members in `dsh-session`'s core map was rejected — the core map is loop-owned; every plugin domain (todo, plan, goal) owns its vocabulary in its own package. Reusing the Lite spec's module as the host declaration site was rejected — the Lite spec is a client-side mirror inside `dsh-link-contracts`; host ownership would invert the dependency. Growing `LinkSessionEventKind` in the same change was rejected — consumption is by raw fold, and the manifest enum growth belongs with the producer that makes the tags observable on the remote wire.
