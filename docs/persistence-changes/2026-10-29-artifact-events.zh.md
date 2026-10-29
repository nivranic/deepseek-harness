---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-29-artifact-events

[English](2026-10-29-artifact-events.md) | 中文

## 概述

artifact 功能（packages/artifact）向日志新增两个 Session 事件：模型调用 artifact_create 时写入 artifact/created，资源通道落定字节时写入 artifact/status。两者均为新增的持久事件判别根；既有 envelope 不变。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-artifact-events
baseline: false
changes:
  - root: "event:artifact/created"
    previous: null
    after: "18a9a30bd6e4c9519bbada9d53f7f5e7fb3b29d5040f7a810d406d6b6de75b12"
    decision: same-version
  - root: "event:artifact/status"
    previous: null
    after: "3e0d43bd710d43096f1436af7500bb54ceaf59ed2a7494367a3e3387a1a2fced"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

同版本新增两个根：按封闭判别切换读取的旧实现会跳过未知事件；两个事件只携带 JSON 安全字段（字符串 id、kind、title、format、status）。没有根被移动、改名或删除，旧日志原样重放。

<a id="verification"></a>
## 验证

packages/artifact 的 artifact-tool.spec.ts 断言 artifact/created 后随 artifact/status 的精确事件序（ready 与 failed 两路）及入日志字段；持久化目录再生成从同一 SessionEventMap 声明导出两个根的 schema，persistence-changes --check 依再生成树校验本记录。

<a id="dev-note"></a>
## 开发备注

无。
