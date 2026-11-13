---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-13-device-peer-attribution

English | [中文](2026-11-13-device-peer-attribution.zh.md)

## Summary

Adds device and device-pairing variants to the optional principal attribution carried by user message sources, including inbox splices, developer messages, and title-model request history. Signed device prompts retain DeviceId instead of appearing as local owner input.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-13-device-peer-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "aadff61da3cbeaa1051cd21f0e381bad74c3faf26f9531f748a1d5455f195c42"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "7902213d406314fff432699d779f9757870b5b3aa15e4a0c11da0bf8dc795c2a"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "a0a53c28b26332bbcb5da67227fe74d4eaf99d351700a27c4c8ac759dcbf9997"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "0b6ab9f028918513d5e9c349909af78d6931bc39beb8a358252d9a2136a18b82"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same Session version. Existing principal variants and absent principal fields retain their meanings. The unchanged V4 source reader validates the source kind and preserves its JSON metadata, including unknown principal kinds, so earlier V4 readers retain these added identities without converting them to owner or truncating a log. New readers retain historical owner and share-viewer records. Persisted attribution does not grant execution authority: Gateway derives authority from the current admitted Peer and live Device Trust policy. The device-pairing variant permits only pairing redemption and does not produce prompts; its inclusion makes the declared principal union complete.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-persistence-jsonl/tests/native-source-admission.spec.ts packages/api/session-controller/tests/remote-access.host.spec.ts: 55 tests passed. These cover preserved device, device-pairing, and unknown principal JSON in plain and zstd logs opened for reading and writing, unchanged file bytes, and device prompt attribution alongside unchanged owner attribution. The native/Gateway/Remote Access and error-generator batch passed 229 tests, including signed identity, role checks, cross-device replies, revocation during admission, and carrier teardown. Normal build:artifacts passed 8/8.

<a id="dev-note"></a>
## Dev Note

None.
