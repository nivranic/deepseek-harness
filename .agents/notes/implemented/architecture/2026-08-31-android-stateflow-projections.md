# Agent Note: Observable state projections in the Android models

Status: implemented

English | [中文](2026-08-31-android-stateflow-projections.zh.md)

## Problem

The four view models held plain fields, so the Compose tabs re-read them only on recomposition triggers — tab switches and screen re-entry — never on arriving wire data; a followed session could update while nobody looked.

## Decision

Every rendered field became a `StateFlow` backed by a private `MutableStateFlow`: sessions/list-state/open-session/sending on the session model, the inbox and answering flag on the interaction model, workspaces/selection/directory/entries/list-state on the files model, and rows/child-timeline on the subagents model. Mutations go through the flows (list surgery through `update`), and the session model's `state` stays a derived convenience over the open flow's value. The six tabs collect with `collectAsState` and recompose per emission. The FakeWire tests now assert emission sequences through Turbine: list-state transitions `idle → loading → ready`, each folded cut of an open session arriving as its own item, and the inbox's append, dedupe no-op (`expectNoEvents`), and retirement after an answer.

## Consequences

Live wire data recomposes the surface the moment it lands, on the lane green (24 tests plus the three sequence cases). `collectAsStateWithLifecycle` stays open for background-aware collection, as the README records; the models themselves are lifecycle-free by design. One test-learning: `assertNull` on a `StateFlow` property without `.value` compares against the flow object itself — the lane caught it as "expected null but was StateFlowImpl".

## Alternatives considered

Compose `State` through snapshot observers was rejected — the models are JVM-pure and tested without Android; StateFlow keeps them framework-free. Exposing the MutableStateFlows directly was rejected — public mutation belongs to the model's methods, not its subscribers.
