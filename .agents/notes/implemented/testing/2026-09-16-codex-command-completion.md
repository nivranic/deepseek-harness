# Agent Note: Codex fixture completion follows command exit

Status: implemented

English | [中文](2026-09-16-codex-command-completion.zh.md)

## Problem

A scripted model can announce completion while Codex still owns a yielded command. A file-existence assertion may then race the command, and an early write can hide a later command failure. Reusing a function call id also prevents a multi-request fixture from attributing results to the command or poll that produced them.

## Decision

The [Responses fixture](../../../../packages/subagent/subagent-codex/tests/responses-fixture.ts) gives each emitted function call its own id. Its command-completion behavior accepts exactly one result for the latest emitted id. A running session produces an advertised `write_stdin` call with the returned session id; each poll gets a new call id. Completion requires an explicit zero exit status in the command metadata before the output section. Missing, duplicate, unrelated, unsuccessful, or ambiguous results fail the fixture; text printed by the command cannot supply its exit status.

The [real Codex command tests](../../../../packages/subagent/subagent-codex/tests/real-product.spec.ts) retain the pinned CLI and local Responses server. The yielded case holds its command behind a private workspace file. The test releases that file only after observing a poll result, then verifies the final file contents and managed process exit. This observes yielding without assuming that a fixed sleep outlasts startup. The [existing teardown decision](2026-09-07-subagent-teardown-test-budgets.md) continues to own cleanup ordering and execution-lane budgets.

## Alternatives considered

**Send completion immediately after requesting a command.** This proves only that the scripted model answered, even if a process remains active or later exits unsuccessfully.

**Search any tool output for a zero exit code.** An earlier command, an unrelated call id, or the command's own printed text could satisfy that search. Metadata and result attribution must both agree.

**Increase the post-command wait.** A larger pause still does not prove terminal completion. The file barrier and returned process status provide the relevant observations.

## Consequences

Fixture metadata parsing intentionally follows the pinned Codex tool formats and fails if they change. HTTP tests cover repeated polling, unique ids, and rejection cases; the actual CLI verifies command execution and cleanup in an isolated workspace. This changes test infrastructure only: provider code, CLI version, permission modes, production timeouts, and Session output remain unchanged. A local Responses fixture does not qualify a real model provider or other operating systems.
