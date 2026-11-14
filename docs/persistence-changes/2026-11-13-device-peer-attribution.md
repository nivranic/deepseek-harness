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
    previous: "2026-11-05-timeline-priority-notice"
    after: "0e1f05a1d95e6d5a9a51d85ac586e54a8424441e3deb3dc7f87d5e30ae28f55b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "ce3b81f86ecfc0c957e596122772bc769319ed954481e7999d07a8211552825e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "1ea3962d738d29aef30224326ca6444948e6fe9bdcb492b6e835c1bd661958d0"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "6fe6e6887692846e5473238e682c39d97fb06a193d41d0d630fbc20205567dc6"
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
