---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-13-device-peer-attribution

[English](2026-11-13-device-peer-attribution.md) | 中文

## 概述

为用户消息来源的可选 principal 归属新增 device 与 device-pairing 变体，涉及 inbox splice、developer 消息和标题模型请求历史。签名设备的 prompt 保留 DeviceId，不再表现为本地 owner 输入。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

保持 Session 版本。现有 principal 变体及字段缺席的含义不变。未改动的 V4 来源读取器校验 source kind，并保留包含未知 principal kind 的 JSON 元数据；因此旧 V4 读取器保留新增身份，不把它转换为 owner，也不截断日志。新读取器保留历史 owner 与 share-viewer 记录。持久归属不授予执行权限：Gateway 从当前已准入 Peer 和实时 Device Trust policy 推导权限。device-pairing 只允许配对兑换，不产生 prompt；声明它使 principal 联合完整。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/session/session-persistence-jsonl/tests/native-source-admission.spec.ts packages/api/session-controller/tests/remote-access.host.spec.ts：55 例通过，覆盖 plain 与 zstd 日志以读写两种模式打开时保留 device、device-pairing 和未知 principal JSON、文件字节不变，以及设备 prompt 归属和不变的 owner 归属。native/Gateway/Remote Access 与错误生成器批次 229 例通过，包含签名身份、角色检查、跨设备回复、准入期间撤销和载体清理。常规 build:artifacts 通过 8/8。

<a id="dev-note"></a>
## 开发备注

无。
