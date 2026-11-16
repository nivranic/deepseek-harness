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
## 兼容性

保持 Session 版本。现有 principal 变体及字段缺席的含义不变。未改动的 V4 来源读取器校验 source kind，并保留包含未知 principal kind 的 JSON 元数据；因此旧 V4 读取器保留新增身份，不把它转换为 owner，也不截断日志。新读取器保留历史 owner 与 share-viewer 记录。持久归属不授予执行权限：Gateway 从当前已准入 Peer 和实时 Device Trust policy 推导权限。device-pairing 只允许配对兑换，不产生 prompt；声明它使 principal 联合完整。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/session/session-persistence-jsonl/tests/native-source-admission.spec.ts packages/api/session-controller/tests/remote-access.host.spec.ts：55 例通过，覆盖 plain 与 zstd 日志以读写两种模式打开时保留 device、device-pairing 和未知 principal JSON、文件字节不变，以及设备 prompt 归属和不变的 owner 归属。native/Gateway/Remote Access 与错误生成器批次 229 例通过，包含签名身份、角色检查、跨设备回复、准入期间撤销和载体清理。常规 build:artifacts 通过 8/8。

<a id="dev-note"></a>
## 开发备注

无。
