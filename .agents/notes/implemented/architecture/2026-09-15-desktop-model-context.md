# Agent Note: Desktop model context belongs to the local Host

Status: implemented

English | [中文](2026-09-15-desktop-model-context.zh.md)

## Problem

The Desktop composition disables the browser runtime, which owns the Web application's model-facing orientation. A standard Desktop Session retains its working directory and tool guidance but otherwise does not identify the application carrying the conversation. Restoring the retired Desktop bundle would also restore obsolete composition and in-process execution assumptions.

## Decision

The private [Desktop Host](../../../../apps/desktop-host/src/index.ts) registers its [application context](../../../../apps/desktop-host/src/desktop-context.ts) through the existing SystemPrompt service. The section identifies the Desktop window and the local machine hosting the Session. It preserves the distinction between that Host and each tool's declared execution environment, and grants no implicit DOM, route, or screenshot access.

The registration uses the existing application-orientation position after reusable tool guidance and before the persona suffix. A standard preset's persona does not shadow this separate section; a complete persona suppresses it through the registry's normal rules. The dependency subscription restores the section after prompt-service reload and removes it when its owner is disposed. The agent loop records the resulting prompt through existing `system/message` events; no Session event type or transport message is added.

## Alternatives considered

**Restore the legacy Desktop bundle.** The official private Host already owns Desktop composition. A second bundle would duplicate that ownership and carry obsolete frontend execution claims.

**Put the application facts in the global persona.** Standard presets replace the deployment persona, so ordinary Desktop Sessions would lose the facts. Editing every preset would mix application identity with reusable agent configuration.

**Describe all tools as local.** The Session's Host location does not determine every provider's execution environment. Remote and container providers retain their own tool semantics.

## Consequences

Desktop requests gain a late prompt section while their reusable instruction prefix remains stable. The registration affects local Desktop Sessions only; the [environment suffix decision](../bug-fix/2026-09-06-environment-prompt-suffix.md) retains prompt ordering and the [Desktop packaging decision](2026-08-25-electron-desktop-packaging-and-updates.md) retains runtime and transport ownership. Neither decision is superseded.

Required evidence includes registration disposal, service reload, complete-persona suppression, a keyless recorded Session with the exact prompt, and an actual Desktop model request containing the same section. The recorded-session fixture supplies the private registration through the shipped headless profile and disables platform-specific shell tools; it proves logged prompt content, while the Desktop run proves application wiring.
