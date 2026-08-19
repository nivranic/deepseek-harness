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

版本表面在原生外壳菜单里：Help → About 报告 staged manifest 的版本（`app.getVersion()`），旁边是内置的 Electron/Node/Chromium 版本。`scripts/build-desktop-release.ts` 把发布整链串起来（依赖重同步 → 构建 → 打包 → 固定位置安装 → 成品冒烟 → 桌面快捷方式 → 再同步）；每次运行都用 `robocopy /MIR` 把新产的 win-unpacked 树镜像到 `%LOCALAPPDATA%\Programs\deepseek-harness`，并把桌面快捷方式重写为指向其 exe。输出目录每次运行都会清空、安装器产物名带版本号，因此这个固定安装位是跨版本稳定的启动路径——冒烟步骤启动的就是它，判定覆盖的正是快捷方式所启动的东西。heal 中途被硬杀曾会在某个 junction 路径留下空的真实目录（Windows junction 先建成目录、再设 reparse 点），使之后每次启动都报 not-a-symlink 而瘫痪；`ensureSymlink` 现在会接管这种中断创建的残留，真实内容仍然报错。
