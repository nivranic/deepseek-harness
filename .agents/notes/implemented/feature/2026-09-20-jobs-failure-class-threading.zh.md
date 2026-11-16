# Agent Note：任务失败将共享 Remote 失败类别携带到客户端

Status: implemented

[English](2026-09-20-jobs-failure-class-threading.md) | 中文

## 问题

失败的后台任务到达客户端时只剩 `detail`——生产方压平的字符串。共享 Remote 失败分类无法驱动 jobs 呈现：`SessionJob` 过线时类别已经丢失。

## 当前上游边界

分类（`@deepseek-ai/dsh-typert-protocol` 的 `RemoteFailureClass`）命名用户下一步可做什么；`detail` 保持生产方的类型专属事实。工具调用错误行刻意不分类：那是模型/工具产生的失败，不是 Remote 失败。

## 决策

`JobOutcome` 与 `JobSnapshot`（packages/jobs/jobs）新增可选 `failureClass?: RemoteFailureClass`；本地注册表从结算把它带到快照；`jobView` 投影进 `SessionJob`；ui-jobs 的失败行在字段存在时显示类别文案（四个新 locale key），tooltip 保留原始 detail。生产方从捕获的 Remote 错误经 `classifyRemoteFailure` 填充；既有生产方无需改动（字段可选，非 Remote 失败缺席）。

## 备选方案

在 ui-jobs 内从 `detail` 文本分类被否决：压平的字符串没有可分类的稳定码。在 `jobView` 里无中生有地推导类别同理不可能——类别必须发源于捕获 Remote 错误之处，即生产方。

## 后果

`SessionJob` 增加一个可选 wire 字段——纯增量，无消费方破坏。生产方采纳渐进；在其供应类别之前，jobs 显示与以往完全一致。docs 子系统类型块（中英）镜像扩展后的接口；ui-jobs 22/22 与 jobs-local 66/66 覆盖呈现与注册表携带。
