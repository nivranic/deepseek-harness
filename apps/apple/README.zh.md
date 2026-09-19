# @deepseek-ai/dsh-apple

[English](README.md) | 中文

DeepSeek Harness 的下游 Apple 薄壳工程。设备首先是 Remote Companion：不运行 Agent runtime，不维护第二份 Session 真相。本工程从镜像共享 Remote 失败词汇表的 contract 包起步，原生外壳随后迁入。

## 使用本工程

`contract` Swift 包镜像当前候选的 Remote 失败分类：`RemoteFailureClass` 与 `RemoteFailureClasses.classify(code)` 镜像 `@deepseek-ai/dsh-typert-protocol` 的 TypeScript 权威。没有共享语义的码——包括更新 Host 的所有未来码——解析为 `unknown`，必须保持为可呈现的不透明诊断。类只命名 Client 接下来可做的事；从不授予能力、权限、重试策略或协议版本准入。

自检可执行程序断言镜像与生成投影（`remote-failure-classes.json`）一致、每个已分类码都被 [Remote 失败 JSON Schema](../../packages/typert/protocol/remote-errors.schema.json) 声明、schema 的不透明未知分支排除全部 84 个已知码、未分类词汇解析为 `unknown`。夹具经 `node scripts/gen-remote-failure-classes-json.mjs` 再生成；已提交产物由自检验证，漂移即失败。在 `apps/apple/contract` 内用 `swift run dsh-contract-check` 运行（需要 macOS + Xcode；CI 在 macOS lane 上运行）。

## 已知限制与后续工作

Swift 侧未重实现 schema payload 校验；本包只固定分类与 schema 结构证据。未声明任何原生外壳、模拟器或真机资格、商店打包或多版本行为。wrapper 需要 macOS；本工程无法在 Windows/Linux 主机构建。
