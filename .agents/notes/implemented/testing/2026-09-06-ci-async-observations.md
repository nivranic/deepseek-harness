# Agent Note: Observe completed persistence and allow real Worker round trips

Status: implemented

English | [中文](2026-09-06-ci-async-observations.zh.md)

## Problem

Short polling deadlines can expire while a correct filesystem write is still running. A Worker cancellation test can time out during Runtime enablement before reaching its intended never-settling evaluation. Complete Workspace type analysis also includes cold compiler and module-loading work that needs the analyzer test family's execution budget.

## Decision

The [mandatory projection checkpoint test](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) observes the actual creation and turn-end write promises before reading storage. It asserts the number of writes, retains the real persistence implementation, and checks the stored event watermark and value after completion.

The [Inspector deadline test](../../../../packages/experimental/inspector/tests/integration.host.spec.ts) gives real cross-thread round trips one second, requires successful Runtime enablement, and verifies that the never-settling evaluation actually started before its deadline. A subsequent evaluation proves that the same Client remains usable. Product timeout defaults are unchanged.

The [tools catalog round-trip test](../../../../packages/typert/generator/tests/tools-catalog.spec.ts) uses the same sixty-second budget as the existing Workspace analyzer tests. It still analyzes the complete Host program and compares the generated service, event, and type records through the runtime registry.

The [LSP cancellation test](../../../../packages/lsp/lsp-stdio/tests/instance.spec.ts) aborts only after its real server records the definition request. The server acknowledges only a cancellation with that request id. Immediate and delayed initialization exercise the same request cancellation path, so slow startup cannot turn this case into the separately covered initialization-abort behavior. The product cancellation grace remains unchanged.

## Alternatives considered

- Fixed sleeps neither establish write completion nor show which asynchronous operation failed.
- Retrying failed assertions can hide a dropped write or an evaluation that never reached the Client.
- Reducing the Workspace input or replacing persistence and Worker communication with mocks removes the behavior these integration cases own.

## Consequences

Persistence failures reject the observed write instead of appearing as an unrelated polling timeout. Runtime enablement failures are reported at enablement, and the negative deadline case takes about one second. Windows and Linux must exercise the same real dependencies; host sandbox failures remain separate from test outcomes.
