# Agent Note: The remaining owners declare their device permissions

Status: implemented

English | [中文](2026-09-21-remaining-capability-permissions.zh.md)

- Date: 2026-09-21
- Class: feature
- Scope: 14 packages: `packages/api/settings-controller`, `packages/api/workspace-files`, `packages/client/file-upload`, `packages/client/ui-deliverables`, `packages/context/session-reference`, `packages/extensions/cordis-host-runner`, `packages/feedback/command-feedback`, `packages/feedback/message-feedback`, `packages/goal/goal`, `packages/host/plugin-inventory`, `packages/interaction/commands`, `packages/llm/llm`, `packages/preset/agent-presets`, `packages/subagent/subagent`

## Problem

After session-controller and workspace-controller adopted `requiredPermission`, every other Remote capability owner stayed fail-closed for devices — a paired device holding a role could not use read-only surfaces such as workspace files, model discovery, or preset catalogs, because no capability declared the permission its endpoints need.

## Decision

Declare the section 21 permission on every remaining capability by endpoint semantics. Every set was already homogeneous, so no capability was split and no consumer lock surface changed. Reads and OS-surface actions take `view`: redacted settings description, the settings document, preset-directory operations, credential metadata, all seven workspace-files operation sets, presented-file desktop/open/reveal, session-reference candidates, plugin inventory, the LLM provider directory and model discovery, agent-preset catalog, command catalog, message-feedback listing, goal reads, subagent catalog, and the dynamic-cordis inventory, client source, and inspect handshake. Mutations that drive the session take `prompt.send`: settings and credential writes, file staging, preset selection and management, command execution, message-feedback recording and deletion, session-remark recording, all goal mutations, subagent prompting and parent-addressed interrupts, and the dynamic-cordis run lifecycle — activation, request resolution, user-run settlement, Stop, Undefine, failure reports, and invocation. The device-trust pairing bootstrap (`device-pair.redeem.v1`, `device.admit.v1`) stays deliberately undeclared: those endpoints are reached anonymously before a role exists.

Two tests close the arc. The host-preparation specification asserts that every capability across the twenty business declaration sources names a permission inside the section 21 vocabulary, so a future capability cannot silently reintroduce fail-closed drift. The device-trust specification pins its own split: administration on `device.admin`, the bootstrap pair undeclared. Jobs declares no Remote capabilities (its producer is host-side), so no declaration belongs to it.

## Alternatives considered

- `approval.respond` for `dynamic-cordis.resolve-run.v1` because some settled requests require approval: the human approval reply already rides the section 15 interaction seam; this endpoint is a page completing its own activation handshake, so it belongs with the run lifecycle at `prompt.send`.
- `view` for the dynamic-cordis failure reports because they "only report": both methods write the failure onto the run and steer its outcome, which is session-driving state.
- A stricter tier for credential writes: the five-column table names no configuration-administration column, and the interaction columns name reply abilities rather than privilege tiers, so `prompt.send` is the only defensible mutation column for the first version.

## Consequences

- A viewer device can read every business surface; collaborator and up can also mutate settings, credentials, presets, goals, feedback, files staged for prompts, and subagent and dynamic-cordis runs.
- Three Windows-environment failures (workspace-files symlinks ×6, presented-file symlink, agent-presets dangling install link) were each verified failing on a clean tree and stay out of scope.
