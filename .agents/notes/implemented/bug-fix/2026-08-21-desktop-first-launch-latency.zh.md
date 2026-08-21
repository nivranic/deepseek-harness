# Agent Note：桌面首次启动延迟——prelude 先行、带 stamp 的模块回退、Defender 作为冷启动地板

Status: implemented

[English](2026-08-21-desktop-first-launch-latency.md) | 中文

## 问题

打包 exe 的首次启动在 prelude 页与 `dsh:` code-cache 修复之后仍要等几十秒才出界面。对已安装的 `F:\deepseek-harness` 的测量（CDP target-URL 时间线、纯 Node `runProfile` 分相计时，以及用无缓冲 `robocopy /J` 副本复现"Defender 视为新文件、缓存全冷"的新装状态）把启动拆成：warm ≈ 0.8 s 到 DevTools 端点 + ≈ 2.3 s 树启动，UI ≈ 2.5 s 就绪。模块冷 I/O 在 NVMe 上几乎免费——树启动读 1,098 个模块文件（约 5 MB），无缓冲冷副本重跑同样只要 ≈ 2.3 s，说明启动是 CPU 密集而非 I/O 密集。两项成本是结构性的：`healProfilesModuleFallback` 每次同步重读约 272 个安装 manifest（warm 264 ms、冷 1.27 s），且 `apps/desktop/src/main.ts` 在 `createWindow()` 之前调用 `startGateway()`，这段遍历发生在 prelude 窗口创建之前。冷启动的主导成本是 Microsoft Defender：对 507 MB / 19,504 个文件的安装做一次自定义扫描要 23.4 s，实时过滤在文件首次打开路径上同步拦截 exe、DLL 与首读文件——每次 release 重建（robocopy 重写整棵树）都会让全部文件重新变成首读。

## 决策

外壳先画界面。`apps/desktop/src/main.ts` 把启动图（`dsh/profile-boot`、`dsh-app-boot`）改为 `startGateway` 内的动态导入，向 `createWindow` 传入一个永不 reject 的 gateway deferred，并且在 prelude 窗口创建之后才启动 gateway；启动失败仍由 fail-loud 报出，屏幕停留在 prelude。

heal 为自己的成果盖 stamp。`healProfilesModuleFallback` 在链接旁写 `.dsh-heal-stamp.json`，记录 anchor 的 stat 与每个链接目标 manifest 的 stat；未变化的安装只做 stat 校验（不读 manifest、不重写链接）。stamp 信任文件身份而非文件内容——mtime 比较取整到毫秒，因为外部时间戳恢复工具会截断到毫秒以下，而真实的闭包变化（部署、安装、编辑）远大于半毫秒。anchor、任一链接或 manifest 变化都会重跑全量遍历并重写 stamp；`packages/boot/app-boot/tests/profile.spec.ts` 钉住跳过路径（stat 保持不变的非法 manifest 不得抛错）与失效路径（anchor 变化、链接被改指）。

Defender 是剩下的杠杆，属于机器设置而非代码：安装目录需要一次性管理员执行 `Add-MpPreference -ExclusionPath 'F:\deepseek-harness'`。记录在此，因为非管理员 shell 里没有任何仓库门禁能替它应用或验证。已于 2026-08-21 在本机经用户 UAC 确认加上；同一无缓冲冷态安装随即测得 UI 就绪 37.7 s → 7.1 s。

## 第二轮：从 7 s 到 2-3 s 目标

扫描消掉之后，冷启动相对 warm 的剩余差距是纯文件 I/O：DLL、`.pak` 资源与 exe 自身的映像节，在渲染进程与 GPU 进程 spawn 时以分散缺页方式按需读入。最终机制：`main.ts` 在打包态于模块顶层启动页缓存预热——安装根目录全部文件 + UI 可能选中的两个 locale pak，按大小升序、约 200 MB 的 exe 垫后——并且 `whenReady` 在建窗前等待它完成，上界 1.2 s。等待是成败关键：与预热竞速时渲染加载是通常输掉的 2-3 s 抛硬币；而中间版本曾跳过 exe（竞速体制下测得净收益为零），实际上丢掉了真正的收益——一旦预热在建窗前被等完，把 exe 的映像页焐热同时消掉渲染进程的冷缺页与主进程的后续缺页（驱逐冷态下：渲染 1.6 s → 0.3 s，核心 ≈ 0.9 s → ≈ 0.7 s）。gateway 启动也从 `whenReady` 提前到模块顶层（单实例锁之后）、且排在预热之后——它的约 1100 次文件打开与预热的整块读共享一块磁盘，竞速时两者都变慢；heal 的同步前缀（盖章后 ≈ 0.2 s、重建后 ≈ 1.3 s）是唯一仍可能推迟 `ready` 的部分。

最终数字：warm UI ≈ 2.5 s；驱逐式代理——无管理员权限下最接近重启的模拟（把约 60 GB 从未读过的数据压过页缓存；Defender 的清白文件缓存与预读器痕迹保持温热，这点与复制式代理相反）——实测 UI 就绪 **2.8-3.1 s**。两种复制式代理各往一个方向撒谎：无缓冲复制后立即启动会叠加数秒的脏页回写竞争（一次测量里 3 s 的渲染进程窗口在让卷稳定 30 s 后消失）；把安装复制到新路径会脱离 Defender 排除（一次误操作直接测回了排除前的扫描时代：80 s）。真实的重启后数字只能用真实重启来测；若超过约 3 s，已发布的 `launchAtLogin` 偏好（托盘隐藏启动、唤出即秒开，见[关闭按钮偏好笔记](../architecture/2026-08-20-desktop-close-tray-preference.md)）是保证路径。

## 备选方案

**Electron 主进程启用 `module.enableCompileCache()`。** Electron 39 的 Node 22.22 有此 API 但属实验性，实测首跑不稳定（同一 warm 基准 16.8 s 对 3.8 s 稳态）；它瞄准的解析耗时只是 2.3 s CPU 密集树启动的一小部分，放弃。

**打包主进程导入图。** 整张静态导入图只有 12 个文件 / 288 KB，无利可图。

**只并行预取树模块。** 被完整安装预热取代——树启动的 I/O 从来不是主导项，但同一遍历顺带覆盖。

**把 gateway 树挪到子进程。** 可以让树挂载 CPU 与核心初始化在别的核上真并行，但树已在模块顶层启动，墙钟时间是两者的 max 而非 sum；为桌面表面加 IPC 桥，现在不值得。

## 后果

冷首次启动只需等（已预取的）Electron 核心启动 ≈ 1.2 s 即可画出 prelude，树挂载并发进行，gateway 就绪后换入入口页；未变化的安装每次启动省掉约 272 个 manifest 读，每次重建后的首次启动仍会全量遍历一次（anchor stat 变了——恰是闭包可能变化的时刻）。不加 Defender 排除，exe 与 DLL 的实时扫描仍是冷启动主导项；加上之后这块地板消失。stamp 在 `$DSH_HOME/profiles/node_modules` 里新增一个 heal 专属文件；撕裂或过期的 stamp 会回退到全量遍历，不可能把启动弄挂。预热在每次打包启动时把几百 MB 读入可逐出的 standby 集合，非打包态完全跳过。
