# Agent Note: Linear path suffix trimming

Status: implemented

English | [中文](2026-09-15-linear-path-suffix-trimming.zh.md)

## Problem

Workspace display and file-address helpers accept lexical paths. A suffix regular expression can repeatedly scan a long internal separator run before discovering that a later filename prevents a suffix match, blocking the calling browser or Host thread.

## Decision

[`workspace-path`](../../../../packages/util/workspace-path/src/index.ts) removes trailing separators with a backward scan that stops at the first non-separator. Home abbreviation still recognizes only `/`; path joining, display splitting, and workspace relativization retain their existing slash and backslash rules. File addresses retain their normalization and Session scope.

## Alternatives considered

**Keep the suffix regular expressions.** End anchoring does not prevent retrying the pattern at every start position in an internal run.

**Normalize paths through filesystem or URL parsing.** These helpers must preserve unresolved dot segments and lexical path spelling. Canonicalization changes their behavior and cannot run portably in a browser.

## Consequences

Trailing-separator removal takes time proportional to the suffix length. Long internal runs remain byte-for-byte intact. The [workspace file service](../architecture/2026-09-05-workspace-files-service.md) continues to own authorization and filesystem resolution; this change neither validates paths nor changes resource addresses.

Verification preserves POSIX, Windows drive, UNC, mixed suffix, root, and home-abbreviation results, plus the existing address corpus. A source-launched child with a deadline covers long internal runs across every affected public helper so synchronous rescanning can be interrupted without blocking the test worker indefinitely. Model-visible text and resource-address grammar are unchanged.
