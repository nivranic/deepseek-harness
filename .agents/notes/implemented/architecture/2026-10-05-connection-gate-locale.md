# Agent Note: The connection-gate locale matrix is closed by construction

Status: implemented

English | [中文](2026-10-05-connection-gate-locale.zh.md)

## Problem

Section 18's remaining work named the multi-language matrix and closed error semantics as still unverified. All eleven connection states had gate strings, but the consumer built its dictionary key by runtime template (`t(\`connection.gate.${state}\`)`), so nothing tied the `ConnectionState` union to the dictionaries: a future twelfth state without a gate key would compile cleanly and render a raw key at runtime, and no test asserted that both the zh (key-set source of truth) and en dictionaries actually carry every non-ready state's string.

## Decision

Spell the mapping statically. `ConversationRoot` now owns an exported `CONNECTION_GATE_KEYS` object — one literal `connection.gate.<state>` string per non-ready `ConnectionState` member — validated by `satisfies Record<Exclude<ConnectionState, 'ready'>, \`connection.gate.${…}\`>`, so a union member without an entry fails typechecking, and the renderer reads `CONNECTION_GATE_KEYS[state]` instead of interpolating. A lane test walks `Object.keys(CONNECTION_GATE_KEYS)` and asserts both dictionaries carry a non-empty string for every key, pinning the en/zh matrix at runtime.

## Alternatives considered

Deriving the key set inside the test from the `ConnectionState` union alone (a `keyof`-style exhaustive list in the spec file) would duplicate the member list and drift silently; anchoring the runtime walk on the exported map keeps one source of truth. A dictionary-driven `t` overload that rejected template keys was rejected as a locale-seam-wide change for one consumer's benefit.

## Consequences

The gate matrix is closed twice: at compile time by the `satisfies` record, at test time by the bilingual key-set assertion. Adding a connection state now requires its dictionary lines in the same change or the build and the lane both fail. The audit's client full-suite list grows to 86 files with the new spec; the multi-version (real release N/N-1) interoperability matrix remains the open §18 item.

## Open follow-ups

Cross-release-version connection interoperability (§18's remaining multi-version matrix) and the device-facing matrix classes stay open as recorded.
