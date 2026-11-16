# Agent Note: 桌面打包把构建修订标识盖进清单封存的 dsh 资源树

Status: implemented

[English](2026-10-07-revision-stamping.md) | 中文

## Problem

§42 诊断快照从 `process.env.DSH_BUILD_REVISION ?? 'source-tree'` 读 `sourceRevision`（早期交付，逐调用现读使启动器可在首次 describe 前盖戳），但从没有任何启动器盖过戳：打包应用由 Finder 或 Explorer 启动、进程环境里没有该变量，于是每个发布都「诚实地」报 `'source-tree'` 而毫无用处。gen-34 的遗留项——「在桌面发布构建流程中盖戳 DSH_BUILD_REVISION」——正是缺失的另一半，挂在 §56 发布流程名下。

## Decision

1. **写入侧**（`apps/desktop/scripts/prepare-dsh.ts`、`build-revision.ts`）：打包准备阶段把 `build-revision.json`（`{"revision":"<40 位小写 hex>"}`）写入 dsh runtime 树根，且在 `writeDesktopRuntime` 封存清单**之前**——文件进入 `desktop-runtime.json` 完整性清单、随 `extraResources` 进全部产物（dmg/zip/NSIS/unpacked）、并落在 macOS 签名豁免的 `dsh` 树内。revision 值源：显式 `DSH_BUILD_REVISION`（校验 40 位 hex）→ 否则 `git rev-parse HEAD` 完整 40 位；client 构建记录存在时对其短哈希交叉校验，分叉大声失败打包（misconfiguration fails loud——打包环境与 git 状态不得静默分家）。
2. **读取侧**（`apps/desktop-host/src/index.ts`）：host 入口在 `runDesktopHost` 之前读 `join(runtimeDir, 'build-revision.json')`，仅当进程未显式继承该值时物化为 `DSH_BUILD_REVISION`。文件在场但损坏（缺席之外的不可读、坏 JSON、非法 revision）抛错——损坏的包大声失败，绝不静默回退 `source-tree`。文件缺席——一切 dev/源码启动（其 runtime 目录是 development project）——零动作，gen-34 语义原样保持。
3. **验收**：文档记载的无签名 Windows 路径端到端跑通——prepare 链绿、产物 `win-unpacked/resources/dsh/build-revision.json` 等于被打包 HEAD 的完整 40 位 hex、产物自身 `desktop-runtime.json` 以同一 sha256 收录该文件、NSIS 安装器与 blockmap 产出。签名与公证验收仍随 §56 开放。

## Alternatives considered

- **Electron 主进程启动器盖戳**（afterPack 在 resources 根写文件、main.ts spawn 前读取设 env）：拒绝——三处改动面取代两处、resources 根新文件进入 macOS 代码签名封条需重新评估、`--prepackaged` 重打包路径的 afterPack 行为需实测、且 stamp 游离于 runtime 清单的防篡改保护之外。
- **发布环境 env 注入**：单独拒绝——env 只活在打包进程里；用户启动的应用一无所获。盖戳必须是产物内的文件。
- **构建期 define 内联 revision**：gen-34 裁定已拒——每个 commit 都会产生不同的库字节。
- **Electron main 读 stamp 后按 spawn 传 env**：拒绝——host 入口是唯一知道 runtime 目录实参的地方，在那里读文件使 main.ts 零改动。

## Consequences

打包部署的诊断现在报出它由哪个确切源修订构建，且 stamp 与其余 runtime 文件一样被同一完整性清单封存。dev 与源码启动行为与此前完全一致。本代打包验收顺带暴露并根因修复两个既有缺陷：(a) 四个 client 包对 `dsh-client-locale/client` 助手的值导入未声明模块表行——client 纯度门（自引入以来没有任何门禁或 CI 构建过的面）现以 `dsh.client.external` 声明通过，即设计中的 loader 行请求路径；(b) Windows 上 GNU tar 把盘符路径解析为 rsh 主机——tar 调用统一走平台旗标助手（仅 win32 加 `--force-local`，bsdtar 不受影响）。无签名验收同时记下其环境需求：`DSH_DESKTOP_APP_ID`，以及本宿主上的 npmmirror Electron 镜像。

## Open follow-ups

- §56 签名打包、公证与更新源验收（签名材料）仍开放。
- loader-composition e2e 既有基线红（无关项）仍钉开放通道。
