---
kind: upgrade-guide
description: "重新引入的 1017 模型徽标包再次移除；模型徽标来自 DeepSeek 模型列表。"
---

# `ui-deepseek-model-label-1017` 包再次移除

[English](guide.md) | 中文

## 变更

车道在首次移除该包的版本之后（见[冻结指引](../../v0.2.1-rc.2/model-badge-package-removal/guide.zh.md)）重新引入了 `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017`；其临时 1017 徽标现已过期一月余，因此包与其在 Web bundle 中的 `ui-deepseek-model-label-1017` 行再次移除，包不再发布。composer 模型选择器继续显示 DeepSeek `GET /models` 列表为模型声明的徽标；未声明徽标时 `DeepSeek-V4.1-Flash` 不显示 `1017`。

## 迁移

1. 从 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 与任何经 `--patch` 传入的 overlay 中，删除 `id` 为 `ui-deepseek-model-label-1017` 的 patch（含其 `disabled` 等字段）。
2. 从任何声明它的包依赖中移除 `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017`。
3. 要改变模型名称或徽标的渲染方式，请向 `conversation.input.model.label` slot 贡献；其 owner props 携带目录的 `model.badge`（[label extensions](../../../../packages/client/ui-model-selection/README.zh.md#use-this-package)）。
4. 重启 DSH，确认启动不再报缺失 `ui-deepseek-model-label-1017` 条目。
