# Agent Note: 真浏览器上传去重命中验证与其暴露的命名空间访问修复

Status: implemented

[English](2026-09-30-browser-dedupe-verification.md) | 中文

## Problem

浏览器上传去重增量发布时只有单测覆盖：没有任何真浏览器车道演练过命中路径，页面侧探测也从未在组合出的真实 Web 客户端上运行过。真浏览器车道还必须钉住页面级记忆的决策——存储对象跳过必须来自页面记忆，而不是 Host 侧对载体的处理。

## Decision

- 新增无模型真浏览器车道（`apps/web/tests/file-upload-dedupe.e2e.ts`，真 chromium 跑在交付版 web scaffold 上）：同一页面先选一个文件、再以第二个名字选同字节、再选异字节、最后在全新页面上下文选同字节。载体请求经 upload 路由计数；Host 存储经隔离 harness home 做 stat。车道断言：真实 Host descriptor 广告 `file-upload.dedupe.v1`；已记忆重传只发一次摘要 RPC、零载体请求；存储对象 mtime 与大小不变（零重写）；记忆显示名作为新别名发布到对象旁；异字节与全新上下文都付完整载体，钉住页面级生命周期。
- 车道首次运行暴露探测在组合页面里从未可调用：`FileUploadRuntime` 以直接属性访问读取 `ctx.remote.fileUploads`，Cordis 反射守卫对跨 fiber 调用的服务拒绝该访问（"cannot get property without inject"）——单测 harness 直接提供的 `remote` 对象掩盖了守卫。现在类声明 `inject = ['remote', 'remote.fileUploads']`（加载序依赖，ui-commands/ui-model-selection 模式），client 入口声明同一命名空间，访问改经 `ctx.get('remote.fileUploads')` 解析以保持在服务自身 fiber 的归属下，命名空间未挂载时大声失败为 `host/capability-unavailable`。单测 harness 按 ui-model-selection 测试的方式经 `ctx.reflect.provide` 提供命名空间。
- 探测可调用后，撤回后重试车道的期望换了真值：本页面已成功投递过的字节重上传现在按摘要重暂存、不再二次载体传输，因此 `file-upload-capabilities.e2e.ts` 记录 `retryRestagedByDigest` 取代重复载体上传。
- 车道注册沿用兄弟模式：从 client 注册的 `apps/web` 程序排除，列入检查这些 scaffold 导入车道的 host 面程序（`tsconfig.host.json`）。

## Alternatives considered

- **在模型重放 round 车道上加第二次选取：** 需要重录 fixture（要真实模型 key）才能测一条完全无模型调用的路径；无 key 的兄弟车道更便宜且重放稳定。
- **只靠存储对象 mtime 断言跳过：** 同字节的完整载体重传在存储内部实现不同时也可能不触碰已提交对象；全新上下文对照加计数载体路由才能把页面记忆成因与 Host 侧行为分开。
- **保留 `ctx.remote.fileUploads` 直接访问、只加 static inject：** 守卫按调用者 fiber 的 inject 链归属属性访问；服务自身上下文上的 `ctx.get` 是该类对 `connection` 已用的同一习语，在所有组合下可用。

## Consequences

- 去重命中现已在真实浏览器上经交付版 Web 组合验证，关闭 browser-upload-dedupe note 的开放验证项。
- 今后任何破坏探测路径的变更——能力广告、命名空间挂载或 runtime 访问——都会让本车道失败，而不是静默退化为全量传输。
- 两处本地环境漂移经 HEAD 状态 stash 复现确证为既有（不在本增量处理）：本地全新 client 程序构建下 `ui-primitives/markdown/parse.ts` 的 micromark-util-types 双版本类型身份错误，以及 round 车道的平台状态栏 aria 金色；CI 全新安装在两者上都通过。

## Open work

- 载体计数只观察页面上下文路由；若未来引入 worker 本地载体，需要单独的计数缝。
- 全新上下文对照共享认证 URL 但不共享 localStorage；它钉的是页面级记忆，不是跨标签页行为。
