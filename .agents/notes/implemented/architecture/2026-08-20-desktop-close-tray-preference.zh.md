# Agent Note: 桌面关闭按钮偏好——默认托盘，组合为门

Status: implemented

[English](2026-08-20-desktop-close-tray-preference.md) | 中文

## Problem

关闭桌面窗口会拆掉整个 harness：`window-all-closed` 走有界关闭，杀掉所有运行中的会话。桌面用户期望关闭按钮把应用收进系统托盘继续运行，但这必须是可配置的——有用户要的就是"关闭即退出"——且只能存在于 exe 表面：Web 设置弹窗不能推销一个浏览器窗口兑现不了的托盘选项。默认值为托盘。

## Decision

该偏好是一个由新双面包 `packages/client/ui-desktop`（`dsh-client-ui-desktop`）拥有的设置命名空间：

- 宿主半注册 `desktop` 命名空间（`closeAction: 'tray' | 'quit'`，schema 默认 `tray`），别无一物——刻意做成无 surface 的 locale 宿主半形态：typert 工作区发现只在其宿主入口声明 Context/Events 成员时才把包指到 HOST 面，而一旦有了宿主面注册，该包的客户端半（经其单一包 tsconfig）就会被拖进某个宿主批程序，与 `core/agent` 的 `TypertContextMap.agent` 撞上 `client/runtime` 刻意的客户端面镜像。因此 Electron 壳经 settings 服务在关闭按钮按下时读取取值——`booted.ctx.get('settings')?.get(namespace)`——无需该包自建任何服务。按下时读取（而非启动时缓存）让设置行的写入对下一次按下立即生效，壳侧无需任何事件管线。
- 浏览器半是一行 `settings.general.item`（id `desktop-close`），经 `ctx.settingsScope.bind` 绑定，从共享 describe 镜像渲染一个双选项 radio 组；`select` 走 scope 的带 revision 栅栏的 mutate 路径。
- 表面之门是组合而非运行时事实：只有 `dsh-desktop-app` 的 patch 携带此行，Web 组合从不注册该命名空间，其 settings describe 无从暴露。`appInfo` 运行时事实按其文档契约保持仅作展示——该行绝不据此分支。
- 壳（`apps/desktop/src/main.ts`）拦截 `close`：值为 `tray` 时先建托盘（透明 32×32 PNG 素材 `apps/desktop/resources/tray-icon.png`，缩放到托盘的物理槽位），再隐藏窗口并在每次运行显示一次气泡提示。`quit` 或托盘构建失败（含素材缺失）都真实关闭——隐藏后无从唤回的窗口永远不可接受，`trayBroken` 锁存该失败。`before-quit` 与 Windows `session-end` 置 `quitting` 旗标，真实退出（托盘"退出"、冒烟关闭、OS 注销）不被拦截。因为托盘关闭是默认，壳取单实例锁，再次启动唤出隐藏窗口而非叠起第二棵树。节不可读（树仍在启动、花名册漂移）时回退 `tray` 并留一次日志报告——schema 默认让窗口保持可关而不是被搁置，桌面组合 e2e 钉死注册，漂移无法无声到达。
- 托盘与气泡文案跟随 OS 语言（`app.getLocale`）：托盘活在 Web 表面及其 locale 服务之外。

## Alternatives considered

**行按 `appInfo.runtime.electron` 分支。**否决：boot 图的运行时事实有文档化的仅展示契约（"a consumer renders these, never branches product behavior on them"），而组合本就是表面专属花名册的机制。

**常驻托盘 + "关闭即最小化"开关。**同一契约下更多活动部件：托盘的存在意义是承载隐藏窗口，故它在首次关闭入托盘时物化并保留到运行结束。

**发布专用托盘图标素材。**次日采纳，推翻最初的暂缓：用 `app.getFileIcon` 提取 exe 自身图标会在 HICON→NativeImage 转换中丢掉 alpha 通道，托盘把圆形 logo 渲染在不透明白方块上（exe 内嵌图标与 `toBitmap()` 读出的角点都是透明的；编码出的 `toPNG()` 与托盘渲染不是）。发布的素材就是 exe 图标自身的透明提取版（32×32），任务栏与托盘身份保持一致；打包 stage 在 `lib/` 旁复制 `resources/`（deploy 过滤器会漏掉它），`electron-builder` 的 `files` 列表把它带进 app 树。

**偏好走渲染端→主进程 IPC。**否决：壳本就进程内消费树服务（`desktopGateway` 模式），scheme 即桥的设计没有 preload，且主进程本身就持有 settings 服务。

## Consequences

桌面花名册从此比 Web 多一行浏览器行——该表面既有的漂移代价再付一次：此行同时活在 bundle 的 `package.json` 依赖与 `cordis.patch.yml` client 行块，`apps/cli/tests/desktop-composition.e2e.ts` 同时钉死 boot 图中的行与"命名空间 + 托盘默认值"（以及每次提交后的节再解析）。打包路径也变了形状：exe 构建暂存 `apps/desktop` 的 manifest 闭包，新依赖照常被打入——但冒烟启动现在要求应用未在运行（发布链本就先停掉它），因为第二个实例是唤出而非启动。托盘默认意味着退出经由托盘菜单的"退出"或真实的 `quit` 设置；会话在关窗后存活，这正是本改动的目的。
