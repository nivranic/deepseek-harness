# Agent Note：桌面首次启动延迟——prelude 先行、带 stamp 的模块回退、Defender 作为冷启动地板

Status: implemented

[English](2026-08-21-desktop-first-launch-latency.md) | 中文

## 问题

打包 exe 的首次启动在 prelude 页与 `dsh:` code-cache 修复之后仍要等几十秒才出界面。对已安装的 `F:\deepseek-harness` 的测量（CDP target-URL 时间线、纯 Node `runProfile` 分相计时，以及用无缓冲 `robocopy /J` 副本复现"Defender 视为新文件、缓存全冷"的新装状态）把启动拆成：warm ≈ 0.8 s 到 DevTools 端点 + ≈ 2.3 s 树启动，UI ≈ 2.5 s 就绪。模块冷 I/O 在 NVMe 上几乎免费——树启动读 1,098 个模块文件（约 5 MB），无缓冲冷副本重跑同样只要 ≈ 2.3 s，说明启动是 CPU 密集而非 I/O 密集。两项成本是结构性的：`healProfilesModuleFallback` 每次同步重读约 272 个安装 manifest（warm 264 ms、冷 1.27 s），且 `apps/desktop/src/main.ts` 在 `createWindow()` 之前调用 `startGateway()`，这段遍历发生在 prelude 窗口创建之前。冷启动的主导成本是 Microsoft Defender：对 507 MB / 19,504 个文件的安装做一次自定义扫描要 23.4 s，实时过滤在文件首次打开路径上同步拦截 exe、DLL 与首读文件——每次 release 重建（robocopy 重写整棵树）都会让全部文件重新变成首读。

## 决策

外壳先画界面。`apps/desktop/src/main.ts` 把启动图（`dsh/profile-boot`、`dsh-app-boot`）改为 `startGateway` 内的动态导入，向 `createWindow` 传入一个永不 reject 的 gateway deferred，并且在 prelude 窗口创建之后才启动 gateway；启动失败仍由 fail-loud 报出，屏幕停留在 prelude。

heal 为自己的成果盖 stamp。`healProfilesModuleFallback` 在链接旁写 `.dsh-heal-stamp.json`，记录 anchor 的 stat 与每个链接目标 manifest 的 stat；未变化的安装只做 stat 校验（不读 manifest、不重写链接）。stamp 信任文件身份而非文件内容——mtime 比较取整到毫秒，因为外部时间戳恢复工具会截断到毫秒以下，而真实的闭包变化（部署、安装、编辑）远大于半毫秒。anchor、任一链接或 manifest 变化都会重跑全量遍历并重写 stamp；`packages/boot/app-boot/tests/profile.spec.ts` 钉住跳过路径（stat 保持不变的非法 manifest 不得抛错）与失效路径（anchor 变化、链接被改指）。

Defender 是剩下的杠杆，属于机器设置而非代码：安装目录需要一次性管理员执行 `Add-MpPreference -ExclusionPath 'F:\deepseek-harness'`。记录在此，因为非管理员 shell 里没有任何仓库门禁能替它应用或验证。

## 备选方案

**Electron 主进程启用 `module.enableCompileCache()`。** Electron 39 的 Node 22.22 有此 API 但属实验性，实测首跑不稳定（同一 warm 基准 16.8 s 对 3.8 s 稳态）；它瞄准的解析耗时只是 2.3 s CPU 密集树启动的一小部分，放弃。

**打包主进程导入图。** 整张静态导入图只有 12 个文件 / 288 KB，无利可图。

**并行预取 1,098 个树模块。** 无缓冲冷副本重跑证明树启动在 ≈ 2.3 s 内是 CPU 密集；预取攻击的是实测免费的 I/O 项。

## 后果

冷首次启动只需等 Electron 核心启动就能画出 prelude，不再等导入图加 manifest 遍历；未变化的安装每次启动省掉约 272 个 manifest 读，每次重建后的首次启动仍会全量遍历一次（anchor stat 变了——恰是闭包可能变化的时刻）。不加 Defender 排除，exe 与 DLL 的实时扫描仍是冷启动主导项；加上之后这块地板消失。stamp 在 `$DSH_HOME/profiles/node_modules` 里新增一个 heal 专属文件；撕裂或过期的 stamp 会回退到全量遍历，不可能把启动弄挂。
