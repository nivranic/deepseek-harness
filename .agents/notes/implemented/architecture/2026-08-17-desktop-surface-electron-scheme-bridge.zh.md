# Agent Note: Desktop surface over Electron's privileged-scheme bridge

Status: implemented

[English](2026-08-17-desktop-surface-electron-scheme-bridge.md) | 中文

## Problem

浏览器表面出厂时只有一个物理载体：`dsh-host-webserver` 绑定回环 HTTP 服务器，connection node 半在其上注册 `/api` 路由与 WebSocket 下行，`dsh-host-frontend-static` 认领 fallback 席位供给 dist，`dsh-client-modules` 通过 index tap 注入启动清单。桌面应用（用户直接启动的 exe，无浏览器、无开放端口）需要同一个组合表面但不要套接字：webserver README 早已为该形态预留了位置（"Electron loads dist … and carries fetch over an IPC bridge"），却不存在可搭建它的接缝——所有 web 载体插件都在插件级别要求 `webServer`，无 webserver 的组合无法激活它们，客户端半也硬编码了 fetch+WebSocket 浏览器载体。

## Decision

桌面表面是第四个 profile（`desktop`，模板为 `dsh-base` + `dsh-desktop-app`），其载体在进程内，而非 HTTP：

- `packages/host/electron-ipc`（`dsh-host-electron-ipc`）提供 `desktopGateway`：一个 `handle(request)` 分发器，应答渲染端经特权协议发来的 fetch——`/api` 走 Connection 共享通道链（拦截器认领优先于 `toFetchHandler(apiProxy)`），`/plugins/<id>/client.js` 走模块注册表，其余路径走注入了启动清单的 dist，并保持 frontend-static 语义（遍历 403、SPA 回退、未知扩展名 octet-stream）。它注入 `clientModules`、`connection`、`apiProxy`，不绑定任何套接字。桥上不适用 HTTP 信任围栏：每个请求都来自本进程自己的渲染端，因此回环限定的特权方法保持可达。
- `apps/desktop` 是 Electron 壳：在 ready 之前将 `dsh:` 协议注册为特权协议（standard、secure、可 fetch、可流式），经共享的 `profile-boot` 启动器引导 `desktop` profile，把 `protocol.handle` 接到 gateway（早期请求在 boot promise 上排队），并在窗口关闭时经有界 shutdown 释放整棵树。没有 preload：协议本身就是桥，`contextIsolation` 保持开启且不暴露任何东西。事件流以 SSE 形式跑在流式协议处理器上；浏览器专用的 WebSocket 覆写永不被选中。
- 载体插件从"要求 webServer"改为"载体条件化"：connection node 半无条件提供注册表服务，仅在 webServer 存在时绑定路由／upgrade（在场即同步绑定，watcher 在其后出现时重绑）；`dsh-client-modules` 以同样方式绑定 bundle 路由与 index tap；`dsh-host-directory-picker-auto` 在组合声明时从新增的 `bindHost` 配置读取绑定事实（桌面 patch 声明 `127.0.0.1`），否则等待 webServer。
- 客户端 connection 半按页面协议选择载体：出现非 http(s) 协议即选中 `IpcApiClient`（基础 fetch+SSE 客户端——桥两者都能应答），http(s) 保持 `WebApiClient`，`?fixture` 保持 fixture。桌面句柄按构造报告回环同源。
- 桌面 bundle patch 镜像 web patch，去掉其载体行（无 webserver、无 web-startup、无 client-hmr、无 URL 行／shell 变量），加上 electron-ipc 行；其粘合插件注册携带无 URL 约定的 `app:desktop-surface` 提示词段落。

## Alternatives considered

**`file://` 加载 + ipcMain fetch 桥。**README 的字面句子。实施中被否决：`file://` 没有在外壳 bundle 运行前注入启动清单的时机，破坏资源的同源 fetch；ipcMain 变体则需要在两个方向手写 Request/Response 序列化与分块流式传输——重复了 `protocol.handle` 原生承载的东西。特权协议让渲染端真实的 fetch/SSE 栈保持原样，且桥依旧是进程内 IPC。

**保留 webserver 行，让 BrowserWindow 指向回环端口。**一天的工作量、零新代码。按 pre-release"正确基础优先"立场否决：它留下桌面并不需要的开放套接字，与预留的无套接字形态矛盾，且所有信任围栏、URL 行、HMR 路由都会空挂。

**Tauri/WebView2 壳 + 打包 Node sidecar。**二进制更小，但整个 harness 都是 Node：sidecar 只是把这次改动在一个进程之外重做一遍，徒增 IPC 生命周期管理，却不删除任何自有代码。

**把 connection 客户端半拆成独立包以解决无 web 花名册行问题。**双面行正是浏览器半进入启动图的方式；一旦 node 半载体条件化，拆分就为拆而拆了。

## Consequences

代价：四个 web 载体插件各自带上条件绑定分支（均有测试钉住），且桌面组合成为第二份花名册，必须跟随 web 花名册浏览器侧的变化。收益：一个无套接字的桌面表面，仅靠一个薄应用壳就复用了整个组合栈——网关、拦截器平面、启动图、会话平面——并由 `apps/cli/tests/desktop-composition.e2e.ts` 端到端验证（所有行激活；index、bundle、unary、拦截器平面、SSE 全部经 gateway 分发）。打包（`scripts/build-desktop-exe.ts`）将 `pnpm deploy` 闭包暂存到仓库树外，物化逃逸 stage 的链接，补全仅经 peer 边可达的 workspace 包并将其声明为 stage 依赖，使 electron-builder 按 manifest 依赖图收集时把它们打进包里；以未签名、`npmRebuild: false` 运行 electron-builder（node-pty 自带 N-API prebuilds，无需工具链）。应用树以 `asar: false` 打包：启动器引导时会把共享的 `$DSH_HOME/profiles/node_modules` 回退目录 heal 成指向安装内各包的 junction，而 Node 的 CJS 解析从这些 junction 出发无法进入归档——asar 打包的构建曾因此供给空的浏览器启动图，因为 `ClientModuleRegistry` 对每个解析失败的包都静默负缓存。Electron 必须 ≥39：harness 运行时导入 `node:module` 的 `stripTypeScriptTypes` 与 `node:zlib` 的 `createZstdDecompress`，Electron 33 内置的 Node 20 两者皆无；Electron 39 内置 Node 22.20，落在仓库 engines 范围内。

版本表面在网页设置弹窗里：boot 图携带组成安装的版本（`WebBootGraph.version`，由 client-modules node 半从自身 manifest 盖章——发布流程把所有包同步 bump）以及宿主运行环境信息（`WebBootGraph.runtime`：Node 版本、一行 OS 标识、Electron/Chromium 版本——后两者只在 gateway 跑于 Electron 主进程内时盖章，纯 Node 的 web-server 宿主下被 JSON 丢弃），都在 `parseBootManifest` 校验并经 `ctx.appInfo` 提供；ui-settings-general 的"关于"节（导航最后一行）在 web 与桌面两个表面上把它们渲染成标签/值行，缺失的事实显示 `—`（例如 web-server 表面下的 Chromium/Electron 行）。Electron 壳清掉了原生菜单栏（`Menu.setApplicationMenu(null)`）；早前的 Help → About 弹窗被该节取代。`scripts/build-desktop-release.ts` 把发布整链串起来（依赖重同步 → 构建 → 打包 → 固定位置安装 → 成品冒烟 → 桌面快捷方式 → 再同步）；每次运行都用 `robocopy /MIR` 把新产的 win-unpacked 树镜像到固定安装目录 `F:\deepseek-harness`（数据盘，不占系统盘），并把桌面快捷方式重写为指向其 exe。输出目录每次运行都会清空、安装器产物名带版本号，因此这个固定安装位是跨版本稳定的启动路径——冒烟步骤启动的就是它，判定覆盖的正是快捷方式所启动的东西。heal 中途被硬杀曾会在某个 junction 路径留下空的真实目录（Windows junction 先建成目录、再设 reparse 点），使之后每次启动都报 not-a-symlink 而瘫痪；`ensureSymlink` 现在会接管这种中断创建的残留，真实内容仍然报错。0.1.0-rc.8 master 合并之后，`./client` 包装器改从内核保留的 manifest（`moduleSystem.manifest`）读取 `ctx.appInfo`，不再重新解析 boot 文档——master 的 `createClientModuleSystem` 拥有唯一一次经过校验的解析。
rc.8 合并把本注记警示的花名册漂移代价兑现成了一次启动卡死：master 的重构把 `dsh-client-ui-renderer` 变成了 `dsh.client` 插件行（`immediately`，提供 `uiRenderer`——shell 的 `mountApp` 在 `loader.await()` 之后注入它），`dsh-web-app` 的花名册跟进了这一行而 `dsh-desktop-app` 没有。于是桌面端所有 fiber 都激活、进度弧读到 100%，shell 却永远停在 "Loading plugins…"——任何地方都没有报错，因为 loader 全部满足而挂载提供者缺失是静默的。修复在花名册条目所在的两处同步跟进：bundle 的 `package.json` 依赖（可安装性、heal 的 BFS）与 `cordis.patch.yml` 的 client 行块（真正的组合），并由桌面 e2e 断言服务出的 boot 图包含 renderer id 加以钉死。排查必须带外进行：client bundle 仍在执行时发起的主进程渲染器往返（`executeJavaScript`/`insertCSS`）会卡死插件加载，因此工具是 CDP（`--remote-debugging-port`），它不触碰页面就能读到 DOM 与网络。
同一次发布还让 master 的首次运行欢迎弹窗撞上冒烟门：深色就绪 UI 上的弹窗把截图压到约 13.7 KB，低于 40 KB 的就绪门槛（甚至低于约 20 KB 的失败页——尺寸启发式就此反转）。冒烟模式因此改由入口 URL 携带：`DSH_DESKTOP_SMOKE_SHOT` 生效时 `createWindow` 追加 `?dsh-smoke=1`，web boot 内核以页内样式表让 `[role=presentation]` 覆盖层在截图中不可见。仅限视觉——弹窗的持久确认保持未写，真实用户仍会在自己的首次启动见到它。
这条排查弯路还暴露了第二个合并陷阱：`packages/client/modules/src/client/*.ts` 旁滞留的过期 tsc 产物（更早一次误发射——`.d.ts` 孪生甚至被提交过、已随合并移除；`.js`/`.js.map` 孪生留在磁盘上，直到一次 `git add -A` 把它们卷进提交）。Vite 的 `.js` 优先于 `.ts` 解析，孪生文件为所有包子路径导入遮蔽了合并后的源码：vitest 看到的是合并前的命名空间，web boot 规格失败，而直接 `../src/…ts` 导入照常通过。发现源码旁出现孪生产物时，无论是否已被提交，都要在构建或下解析结论之前删除整套孪生。
之后一次对启动延迟的拆解（CDP 带外计时加对安装目录跑纯 Node runProfile）把成品首次启动分成了各段：热启动约 0.8 秒到达 DevTools 端点、约 2.0 秒整棵 profile 树就绪；冷首次启动则多花约 12 秒在主进程模块 I/O 上（exe、DLL 与 main.js 的导入图在数据盘上经杀毒软件冷读），而在 gateway 应答之前窗口什么都不画——包括入口 HTML 在内的每个请求都排队等 boot promise。两项改动针对这个结构。外壳先加载一个主进程自带的预载页（data: URL，承载与客户端 boot 页相同的字标与旋转弧），gatewayReady 一落地就换到入口 URL，窗口因此在第一秒内显示品牌化的加载指示，而不是整棵树启动期间的白板；armSmokeShot 通过检查已提交 URL 的协议忽略预载页的 did-finish-load，截图计时仍以真实页面为准。同时 dsh: 协议特权增加了 codeCache: true，让 Chromium 缓存每个客户端 bundle 的编译产物，约 60 个插件的图在首次之后的每次启动都免于重新解析。
同一次构建还暴露了第二个静默默认：桌面发布链此前跑的是裸 pnpm run build，其 client profile 是 local——构建记录只带 commit 哈希，DSH_CLIENT_BUILD_PROFILE 从未读到 official。ui-brand-official 于是什么也不注册（其占位者以 official profile 为门），侧边栏回退到带 commit 哈希徽标的 DSH Local Build 字标；桌面花名册也漏跟了 master 加给 web-app 的那一行。现在发布链改跑 build:official，build-desktop-exe 开工即校验 official 记录（readClientBuildRecord 对 officialClientBuildEnvironment，其摘要校验同时拒绝过期的 dist 树），花名册行与 renderer 行一样由桌面 e2e 钉死——发布的 exe 是公开产物，必须像 npm 发布族要求的那样携带 official client 环境（品牌字标、窗口标题）。
