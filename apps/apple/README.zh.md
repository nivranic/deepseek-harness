# @deepseek-ai/dsh-apple

[English](README.md) | 中文

DeepSeek Harness 的下游 Apple 薄壳工程。设备首先是 Remote Companion：不运行 Agent runtime，不维护第二份 Session 真相。本工程从镜像共享 Remote 失败词汇表的 contract 包起步，原生外壳随后迁入。

## 使用本工程

`contract` Swift 包镜像当前候选的 Remote 失败分类：`RemoteFailureClass` 与 `RemoteFailureClasses.classify(code)` 镜像 `@deepseek-ai/dsh-typert-protocol` 的 TypeScript 权威。没有共享语义的码——包括更新 Host 的所有未来码——解析为 `unknown`，必须保持为可呈现的不透明诊断。类只命名 Client 接下来可做的事；从不授予能力、权限、重试策略或协议版本准入。

自检可执行程序断言镜像与生成投影（`remote-failure-classes.json`）一致、每个已分类码都被 [Remote 失败 JSON Schema](../../packages/typert/protocol/remote-errors.schema.json) 声明、schema 的不透明未知分支排除全部 92 个已知码、未分类词汇解析为 `unknown`。夹具经 `node scripts/gen-remote-failure-classes-json.mjs` 再生成；已提交产物由自检验证，漂移即失败。在 `apps/apple/contract` 内用 `swift run dsh-contract-check` 运行（需要 macOS + Xcode；CI 在 macOS lane 上运行）。

本契约同时采纳第 28 节原生 Host 名册词汇：`NativeHostRoster.decode` 镜像 Android core 的 `FileNativeHostStore`——精确字段集、非空白字符串、`native-gateway-v1` 传输格式、四个配对角色、64 位小写十六进制钉定指纹、32 字节签名密钥、规范可达 HTTPS origin、互异 Host 键（`NativeHostRoster.hostKey`，`[hostId, pinnedFingerprint]` 的 SHA-256）、以及必须指向已存身份的 active 键。Kotlin 权威与本镜像消费同一批夹具（`fixtures/native-host-roster/`，一份规范文档加 14 个拒绝用例）；`NativeHostCatalogTest` 把完全相同的字节送入 Android store，两个实现的接受与拒绝保持对等。

本契约同时采纳第 30 节模型选择词汇：`NativeModelCatalog.decode` 镜像 Android core 的 `SessionModel.modelCatalog`——provider 分组的可路由模型，且宽容语义一致（无字符串 id 的条目被丢弃、名称回退为 id、非对象 `reasoning` 字段视为缺席、default 的非字符串成员读为空），`NativeModelSelection.wireBody()` 镜像 `SessionModel.selectModel`（`session/selectModel` 请求信封，`reasoningEffort` 仅在存在时携带——不带力度的选择与力度出现前的 wire 字节一致）。共享夹具集（`fixtures/native-model-catalog/`，一份规范文档、三个宽容边界用例、一个残缺用例）经 Kotlin 侧 `NativeModelCatalogFixtureTest` 与本侧自检双向消费，两个解析器的丢弃与回退保持一致。

本契约同时采纳第 29 节会话位置事实：`NativeLocationFacts` 镜像 Android core 的 `NativeLocationFacts` 对象——相同的在场规则与回退（名册名称空白时回退 hostId、工作区目录名取双分隔符下最后一个非空白段并回退全路径、最新的 `permission/preset` 记录获胜而缺字符串 preset 的匹配事件保留先前值、仅六个第 18 节族状态词自名、细节行仅在有工作区时存在即协议固定的完整运行时词加全路径）。本地化词汇仍归客户端所有；契约只说标识符。共享夹具集（`fixtures/native-location-facts/`，一份规范文档、四个边界用例、一个残缺用例）经 Kotlin 侧 `NativeLocationFactsFixtureTest` 与本侧自检双向消费，两侧推导保持一致。

## 已知限制与后续工作

Swift 侧未重实现 schema payload 校验；本包只固定分类与 schema 结构证据。未声明任何原生外壳、模拟器或真机资格、商店打包或多版本行为。wrapper 需要 macOS；本工程无法在 Windows/Linux 主机构建。
