# Agent Note: Lite sessions disclose their facts and the app shell mounts a Lite entry

Status: implemented

English | [中文](2026-10-16-lite-session-facts-ui-entry.zh.md)

## Problem

Section 31's four-piece checklist (runtimeMode, capabilities, tool catalog, permission policy) had one piece left after the assembly generation: `runtimeMode = lite` had no carrier. The native-gateway negotiation pins the host's `runtimeMode = "full"` — that is the host's self-description, not Lite's, and a journal event would tax the closed three-fold vocabulary for a static construction fact. Meanwhile `LiteChatScreen` was still a dead UI with zero call sites, and the paired shell's seven tabs only exist after pairing — while the standalone Lite runtime is most useful exactly when no host is paired.

## Decision

The disclosure is a construction-time fact object, `LiteSessionFacts`: the mode word `"lite"`, and the source each catalog came from, reusing the selection enums the catalogs already carry (`BUNDLED_FALLBACK` dispatch, `BUNDLED` schemas and presets) plus the bundled on-device tool names (every bundled name whose fallback capability is null). It states only what is true — no host capability set is mirrored, no enum is invented. `LiteChatViewModel` carries it as a read-only constructor parameter with a default equal to the bundled assembly, and `LiteSessionAssembler` fills it from the actual loaded catalogs. The UI entry mounts on the unpaired branch of the shell: a "Lite 模式" button opens a full-face `LiteEntry` — one disclosure line naming the runtime mode, then the chat surface. While the caller injects no endpoint, an explicit empty state keeps send disabled with one explaining line; no endpoint is ever assumed. Out of scope and deliberately so: an endpoint configuration face, the preset selection face, bundled tool declarations, journal resume, and any paired-face tab.

## Alternatives considered

A journal `session/mode` event was rejected: the fold vocabulary is closed and triple-checked (TS, Kotlin, Swift fixtures), the mode is a static assembly fact rather than turn history, and chapter 64 keeps the journal to fold-visible turn outcomes. A pure UI label was rejected: section 6's "must disclose" is a runtime fact, and a label without a fact source is copy. Extending `NativeSupportDiagnostics` was rejected: that face republishes the observed host's describe result, and mixing Lite's self-description into it would blur the host-facts and device-facts planes. An eighth tab was rejected: the tab strip exists only after pairing, the opposite of the standalone runtime's main scenario.

## Consequences

Section 31's checklist is complete: catalog, persona, permission policy, and now the disclosed mode — each owning an observable source rather than a narration. The unpaired shell gains a working Lite face whose send path stays safely disabled until a later generation supplies real provider settings. The implementation also uncovered and minimally fixed a pre-existing defect: `LiteHTTPProvider` eagerly constructed a `java.net.http.HttpClient` that Android runtimes do not carry, making any on-device assembly fail with `NoClassDefFoundError`; acquiring it lazily keeps construction platform-safe with JVM semantics unchanged. The streaming path still uses the JDK client, so a configured endpoint remains unusable on-device until a later generation swaps in an Android-capable HTTP stack.

## Open follow-ups

An endpoint configuration face (and with it the real on-device send path, which needs an Android-capable HTTP client), the preset selection face, bundling tool declarations for a Host-declared name domain, journal resume for assembled sessions, and the diagnostics projection of the facts into the support export remain open.
