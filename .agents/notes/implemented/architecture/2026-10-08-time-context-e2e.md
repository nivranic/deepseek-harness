# Agent Note: Time-context e2e gets the same activation-order pin

Status: implemented

English | [中文](2026-10-08-time-context-e2e.zh.md)

## Problem

`packages/context/time-context/tests/time-context.e2e.ts` failed on win32+tsx with `ENOENT ... .sessions` — the same shape the loader-composition e2e showed before gen-45: the fixture overlay keeps the headless runner disabled, declares its agent inline on the `agent-loop` row, and points `session-persistence-jsonl` at `root: './.sessions'`. Under the loader's concurrent same-group activation the config agent can be created before the jsonl backend activates, the session keeps an undefined persistence handle, and every write no-ops silently.

## Decision

The fixture's `agent-loop` row declares `inject: [sessionPersistence]` — the same row-level order pin the loader-composition fixture and the shipped headless bundle (for `headlessStartup`) use. The config agent's fiber stays PENDING until the persistence backend activates, the session gains a durable handle, and the `.sessions` overlay materializes. One fixture file, zero production code.

## Alternatives considered

- **Waiting or retrying in the e2e driver**: rejected for the same reason as gen-45 — wall-clock hoping instead of stating the dependency.
- **Softening `createStoredSession` to re-resolve persistence later**: rejected — production agents are registry-created after boot and never race the backend.

## Consequences

The e2e passes 1/1 under `vitest.e2e.config.ts` and the package suite stays green at 53/53. §44's ledger sentence, which recorded this sibling race as an open same-class channel, now records the closure with the fixture path inline. The activation-order race family now has two fixture instances closed by the identical one-line pin; any future fixture that disables the headless runner and declares an inline agent over the jsonl persistence overlay should carry the pin from the start.

## Open follow-ups

- Linux and built-lib launch forms were not re-verified locally (win32+src was the red host); CI covers the Linux leg.
