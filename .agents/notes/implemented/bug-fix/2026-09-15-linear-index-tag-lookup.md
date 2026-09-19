# Agent Note: Linear index opening-tag lookup

Status: implemented

English | [中文](2026-09-15-linear-index-tag-lookup.zh.md)

## Problem

The shared index renderer runs synchronously in Web and Desktop Hosts. Searching for an entire opening tag with a backtracking regular expression can repeatedly scan the remaining document when many tag prefixes lack a closing `>`, blocking startup or an index response. The renderer also accepts fragments and malformed markup, so replacing its matching rules with browser parsing would alter existing injection positions.

## Decision

[`renderIndexInjections`](../../../../packages/host/webserver/src/injections.ts) finds the first case-insensitive `head` or `body` prefix followed by JavaScript whitespace or `>`, then finds the first `>` at or after that delimiter. Each lookup scans the input at most twice. When no terminator exists, it uses the existing fragment fallback.

Matching remains textual: quoted `>` and tag-like text inside comments retain their existing meaning. Attributes, letter case, whitespace, original document bytes, row order, and the readiness tail are preserved. This utility does not sanitize HTML or validate injected content.

## Alternatives considered

**Keep a whole-tag regular expression.** Repeated unterminated prefixes can cause quadratic rescanning. A bounded prefix match followed by one terminator search removes that cause without widening the accepted language.

**Use an HTML parser.** Parsing would change matching inside comments and quoted attributes and could normalize document bytes. The current consumers need insertion into their supplied text; tree construction adds different semantics and a dependency without serving that need.

## Consequences

Malformed prefixes cannot cause repeated scans of their suffixes. The renderer retains its permissive fragment behavior, including matches a browser parser would interpret differently. The [Web transport ownership](../architecture/2026-07-24-web-config-tree-boot-and-transport-layering.md) and [client loading](../architecture/2026-07-23-client-plugin-loading-model.md) decisions remain independently active; this lookup does not change their ownership or startup protocol.

Required verification includes byte-exact insertion and fallback cases for both placements, the Loader-composed renderer's row and tap ordering, and repeated unclosed prefixes in a child process with a timeout so a synchronous regression can be interrupted. No Session event, model-visible input, or rendered product copy changes.
