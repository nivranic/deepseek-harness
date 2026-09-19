# Agent Note: LSP cancellation observes request receipt

Status: implemented

English | [中文](2026-09-16-lsp-request-observation.zh.md)

## Problem

A fixed pause after starting a language-server query does not establish that initialization finished or that the server received the query. Cancelling during initialization can satisfy an abort assertion without exercising request cancellation. A write-callback failure also does not prove that a later stdin `error` event rejects every pending request before the server process closes.

## Decision

The [scripted server](../../../../packages/lsp/lsp-stdio/tests/fixture-server.ts) can record query receipt in a private workspace marker before replying or hanging. The [instance tests](../../../../packages/lsp/lsp-stdio/tests/instance.spec.ts) wait for that marker using the active test budget and signal, then cancel the actual in-flight query. Query rejection is observed before waiting for the marker, so setup failure or teardown cannot leave an unobserved rejection.

The acknowledging server records both the definition request id and the matching `$/cancelRequest` id before replying. Immediate and delayed initialization use the same receipt condition. The test verifies matching ids and a successful subsequent query on the same instance; the unacknowledged cancellation case observes the real subprocess outcome before accepting the query's rejection. The [existing completion decisions](2026-09-08-ci-readiness-and-completion.md) retain ownership of lane budgets and readiness, while the [backpressure observation](2026-09-08-ci-completion-observations.md) separately covers pending native writes and their teardown.

The [connection test](../../../../packages/lsp/lsp-stdio/tests/connection.spec.ts) emits an error through the real child's stdin stream while the child remains alive. Two pending requests and a later request reject with the same retained transport cause before `closed` settles. Cleanup terminates the child and waits for both its close and managed-range exit. Writer-callback failure keeps its separate case.

## Alternatives considered

**Increase the fixed initialization pause.** This still depends on host scheduling and cannot distinguish startup from an in-flight request. Receipt records identify the protocol phase directly.

**Infer successful cancellation only from the abort exception or `instance.dead`.** Both can describe a different lifecycle phase. The request/cancel ids and subprocess outcome provide independent evidence.

**Use only mocked connection completion.** This omits stream error delivery and real child lifetime. The tests retain actual processes and stdio while controlling protocol replies.

## Consequences

These changes strengthen test observations without changing LSP implementation, production timeouts, or the protocol. Private markers are owned by each temporary workspace, and teardown precedes directory removal. Controlled replacement of the receipt wait with the old pause, or removal of stdin error propagation, makes the corresponding regression fail. The scripted server does not qualify an installed language server or an external CLI.
