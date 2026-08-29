# Agent Note: 桌面 exe 在 dsh-base 层之上的启动闭包

Status: implemented

[English](2026-08-29-desktop-exe-boot-closure.md) | 中文

## 问题

把 master 0.1.2-alpha.1 合入 dev 后，打包出的桌面 exe 在冒烟启动时失败，三个相互独立的缺口都只有打包后的启动才能暴露。其一，合并把持久 storage 栈（`storage`、`storage-json`、`storage-domain`）与 `session-projection-cache` 移入了 `dsh-base` 层，而桌面叠层仍以相同 id insert 这些行；Loader 在启动时拒绝重复的 insert id，应用在窗口出现前即死亡。其二，`@deepseek-ai/dsh-settings` 与 `@deepseek-ai/dsh-session-query` 是 Service Definition 包，所有消费方都只以 peerDependency 引用它们；按生产裁剪的 deploy 把它们带进了 stage store，但没有任何包的生产依赖图能到达它们，而 electron-builder 恰恰只打包那张图——于是打包出的应用 import 了不存在的模块，三个 loader 条目（`ui-desktop`、`ui-conversation`、`agent-presets`）失败。其三，桌面浏览器花名册漏掉了 master 加进 web 花名册的十一行与载体无关的行——三个 API controller（其 client 半提供浏览器树的 `sessions` 与 `workspaces` 服务根）、`ui-session`（`uiSession`）、`ui-chat`、`ui-approval`、`ui-attachment`、`ui-reference`、`session-reference`、`file-reference-local`，以及子代理模型选择设置命名空间——打包出的窗口于是渲染出 "Failed to load plugins"，十七个条目永远等在没有任何已挂行能提供的服务上。三个缺口都没有无密钥的见证者：各 bundle 的测试只孤立解析自己的补丁，web 表面的 e2e 从工作区而非部署闭包启动，桌面组合 e2e 也只断言了本来就在的行，而没有钉住 provider 根。

## 决策

桌面叠层以顶层 `- id:` 补丁形式按 id 重述 base 行，绝不 insert base 层已插入的 id；`verify-cordis-config` 通过 `validateOverlayInsertDisjointness` 对每个依赖 `dsh-base` 的 bundle 强制这一点，spec 证明了重复情形被拒绝、按 id 重述的形式被接受。桌面浏览器花名册等于 web 花名册减去 web 载体行（`webserver`、`web-startup`、`web-runtime`、`client-hmr`）再加上桌面专属行；缺失的十一行已连同 bundle 依赖一起挂载，桌面组合 e2e 现在在服务的 boot graph 里钉住 provider 根（`session-controller`、`workspace-controller`、`ui-session`、`ui-chat`），丢失服务根的花名册今后会再次无密钥失败。exe 打包脚本的补充步骤现在会计算 stage 清单依赖图在扁平顶层上到达的集合——即 electron-builder 收集的集合——对每个被 staged 清单要求却不在该集合里的名字，要么照旧从仓库拷入 workspace 包，要么（当 deploy store 已仅经 peer 边把该包提升到 stage 顶层时）把它声明进 stage 清单的 dependencies，让打包器带上它。声明仅限 workspace 包：同样 rides peer 边的注册表包（react、typescript……）保持不声明，因为应用运行的都是自己打包的内容，从不随包发布工具链。

## 曾考虑的替代方案

**用无密钥测试把每个 profile 模板跑过真实 Loader，替代静态 id 检查。** 不采用：insert-id 规则对重复 insert 这一类缺陷机械精确，且跑在既有顶层门内；完整的 Loader 组合需要打包后的插件图，等于以单测速度重复冒烟的职责。

**把每个被 peer 引用的要求都声明进 stage 清单，注册表包也不例外。** 不采用：修复的第一版正是这样做的，会把 react、react-dom、scheduler、loose-envify 和 typescript 打进 exe——应用从不执行这些兆字节：前端 dist 自带打包好的 react，也没有任何东西运行 tsc。

**给 `apps/desktop` 或桌面 bundle 加 Service Definition 包的生产依赖。** 不采用：peer 加 dev 的拆分是全仓库 harness 包的约定，一个消费方提升自己的清单只会让下一个 peer-only 包以同样方式失败；loader 条目在运行时 import 什么，是打包依赖图的事实，不是单个消费方的选择。

## 后果

exe 重新通过打包冒烟启动，storage 栈、投影缓存与两个 Service Definition 包都恰好出现一次。今后任何 base/叠层行重叠都变成无密钥的 `verify-cordis-config` 失败，而非打包启动失败；新掉落的 peer-only workspace 包则表现为补充步骤日志行（`declared N peer-only package(s)`）的计数变化。代价是：打包脚本多了一个镜像 electron-builder 收集语义的小型依赖图遍历器；若打包器将来开始收集 peer 边，这些声明只是冗余而无害。
