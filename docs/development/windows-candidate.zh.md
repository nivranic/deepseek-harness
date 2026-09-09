# Windows 候选生产

[English](windows-candidate.md) | 中文

## Summary

[Windows workflow](../../.github/workflows/windows-candidate.yml) 从明确的同一源码提交构建未签名安装器与 portable 应用。它安装候选、操作两种应用启动器、扫描打包目录，并在上传前验证[平台回执](release-candidate.zh.md)。该 workflow 不验收其余三个平台，也不发布生产版本。

## Table of Contents

- [源码与执行](#source-and-execution)
- [安装与 GUI 检查](#installation-and-gui-checks)
- [打包清单与证据](#packaged-inventory-and-evidence)
- [限制](#limitations)
- [Dev Note](#dev-note)

-----

<a id="source-and-execution"></a>
## 源码与执行

修改已声明输入的 pull request 使用完整 head SHA 执行 workflow。复用调用和手动 dispatch 必须提供 `source_sha`；手动 dispatch 仍受 GitHub 默认分支可用性规则约束。源码验证先于 checkout，生产前再次比较实际 checkout SHA。完整 Action revision、禁用 checkout 凭据保留和 `contents: read` 遵循仓库 [workflow 策略](workflow-security.zh.md)及 GitHub [安全使用参考](https://docs.github.com/en/actions/reference/security/secure-use)。

作业在一次性的 `windows-2025` runner 上使用原生 PowerShell。它安装锁定依赖、检查生成的产品标识、运行 SBOM 回归、构建官方客户端，并调用[现有打包器](../../scripts/build-desktop-exe.ts)。Electron 和 builder 从上游 GitHub release 下载。打包保持未签名并禁用发布。

打包要求原生 Windows 和 Python。[桌面扫描器安装器](../../scripts/release/support_scanner.py)验证固定的 Gitleaks 归档、版本及检出/脱敏 canary 后，将 `gitleaks.exe`、`LICENSE` 和 `scanner.json` 放入应用的 `resources/SupportScanner`。许可证条目缺失、重复、为链接、为目录或为空时，获取失败。打包器在内存中保留获取回执，并在 NSIS 或 portable 收集前比较实际 Electron 输出资源；字节变化、多余文件和非普通文件均使打包失败。

打包后，生产者通过 `node --import tsx/esm` 使用已经安装的开发工具链。生产部署会修改 pnpm workspace-state 元数据；随后运行 `pnpm exec` 可能自动按仅生产依赖重新安装，在验证工具启动前将其移除。

[生产者](../../scripts/produce-windows-candidate.ts)要求在 `RUNNER_TEMP` 下新建输出目录，并为安装和应用状态创建另一个唯一运行目录。托管 runner 标记用于防止在开发者机器上误执行；它不认证故意伪造环境变量的调用方。不得在持久化自托管 runner 上运行该生产者。

-----

<a id="installation-and-gui-checks"></a>
## 安装与 GUI 检查

NSIS 候选为当前临时 runner 用户静默安装到本次运行目录。生产者比较已安装主程序与解包主程序的字节；[Windows 元数据检查](../../scripts/release/verify-windows-product.ps1)核对安装器、portable 启动器、解包主程序和已安装主程序的字符串版本、数字版本及 `NotSigned`。文件引用必须互不重复。

[Playwright Electron 驱动](../../scripts/release/windows-smoke.ts)分别启动已安装可执行文件和实际 portable 启动器。每次启动使用全新的 Harness 与应用数据目录，移除名称涉及凭据的环境变量和开发启动钩子。驱动通过真实首次提示继续，选择稍后配置凭据，打开设置、选择模型并打开提供方表单，不保存凭据，也不调用模型。

NSIS 不转发 Electron 子进程的 stderr，而 Playwright 从该流获取调试地址。仅用于测试的 [portable 适配器](../../scripts/release/windows-portable-launch.ts)启动实际 portable 文件，发现两个已请求的本机回环端点，并将地址通知转发给同一 Electron 驱动。它等待 portable 进程退出，并保留在 Playwright 拥有的进程树中以便失败清理。Portable 启动允许四分钟完成解压与连接，已安装程序允许九十秒；驱动在交互前核验已连接应用的独立 user-data 路径。

驱动截取已渲染的提供方表单、检查未捕获页面错误、记录运行中应用版本，并在 portable 清理前计算实际执行文件的哈希。两种运行中主程序均必须与打包主程序一致。正常应用关闭和进程退出都必须完成，退出码须为零；失败清理只终止该次启动拥有的进程树。PNG 大小阈值不用于授予启动验收。

对于两种启动器，驱动通过运行中应用的 `app.getAppPath()` 定位扫描器资源，将三个文件与解包候选的回执比较，并执行已安装扫描器的版本查询。平台回执将该扫描器标识保留为带哈希的附件。

[支持导出场景](../../scripts/release/windows-support-smoke.ts)打开 General 设置，通过 [UIAutomation](../../scripts/release/windows-support-dialog.ps1)操作真实原生文件名控件和 Save/Cancel 按钮。它将保存字节与 Gateway 结果比较，要求取消时保留既有文件，并拒绝扫描器资源缺失、多余扫描器元数据，以及嵌入其余字段合法的产品元数据中的合成凭据。每次临时修改候选资源后均恢复原件。另一个原生对话框待完成时关闭应用，必须关闭该对话框并正常退出。

[独立验证器](../../scripts/release/windows_support_exports.py)拒绝未知或矛盾字段，要求新启动应用的 Session 计数为零且 Link 观测为 stopped，并重扫准确的已保存字节。只有通过验证的文档才复制到候选证据。已保存、已取消和拒绝的 Settings 反馈由所有者本地期望文件固定，每个场景保留截图。诊断明确不完整：尚缺运行时健康、连接、有效角色、更新和原生崩溃，仍在 `uncollected` 中列出并标记 `complete:false`。

驱动按进程、窗口类名和应用拥有的标题定位原生通用对话框。它选择唯一可见、启用、可写且包含已知默认文件名的文件名编辑框，核验输入的目标路径，再向重新确认的所属进程发送对话框的原生 IDOK 或 IDCANCEL 命令。多个匹配会失败。发现、控件就绪、命令投递与关闭共用一个有界等待。查找失败诊断最多保留 64 个交互控件的固定类型、标题角色和就绪字段。独立 Win32 投影仅对确认属于对话框后代的句柄记录控件/父控件 ID 和固定类名类别。标题归一化仅输出固定角色。名称、句柄、路径、文本与输入值保持私密；诊断不可用不能把失败变成验收通过。

候选车道在构建应用前，通过真实 Windows 通用保存对话框执行驱动。夹具检查保存和取消结果，为两个自有进程设置期限，并在删除私有临时目录前等待它们退出。启动器与子进程均在原生交互前拒绝持久主机。此回归不能证明已安装 Electron 应用的导出成功；完整安装版与 portable 场景仍是必要条件。

生产者记录安装、Inspector、窗口和表单阶段。主操作与清理失败同时保留，包括 Electron 驱动返回进程句柄之前的失败。目录删除在有限时间内重试 Windows 临时文件锁，清理仍未完成时继续报错；重试不构成启动验收。

验收失败后，独立的[只读诊断](../../scripts/release/read-windows-installer-crash.ps1)查询此前 45 分钟内最多 100 条 Application Error 事件。它匹配传入的绝对路径或文件查询返回的完整路径，保留 Windows 展开 8.3 名称时的匹配。工作流为迟到事件提供 10 秒诊断等待；查询不可用时立即结束。脚本的 `WaitMilliseconds` 接受 0 到 30000，默认只立即查询一次。它记录查询次数、经过的毫秒数、安装器哈希、字节数和选定的崩溃字段，不输出完整事件消息或路径。空结果或事件日志不可用不能解释崩溃，也不改变作业失败状态；已验证产物仍只在验收成功后上传。仅失败时上传的 artifact 以 `windows-installer-failure-` 为名称前缀，包含候选 SHA、run ID 和 attempt，保留实际安装器及该诊断 JSON 七天；其中没有平台验收回执。

-----

<a id="packaged-inventory-and-evidence"></a>
## 打包清单与证据

[SBOM 生产者](../../scripts/release/sbom.py)从[扫描器 registry](../../.github/security/scanners.json)下载固定 Syft 归档，先验证 SHA-256 再提取或执行，并检查二进制版本。显式配置禁用更新检查，外部 Syft 配置被移除。CycloneDX 1.6 输出使用 `image` cataloger 集，因为输入是已安装依赖；默认目录 cataloger 会遗漏已安装 npm 包。

npm 审计遍历实际打包应用目录，遇到不可读目录或链接就失败，并将每个具名包及可用的名称/版本对与生成 SBOM 比较。仅包含模块元数据的 manifest 不算包。无版本号的具名 manifest 仍会计数，并且必须按名称出现在 SBOM 中。Windows 扩展路径保证较长部署路径也被覆盖。清单为空或遗漏包时，必须在生成工具回执前失败。

最终平台回执绑定安装器和 portable 文件、命名 PASS 检查、标准 SBOM、截图及观测元数据附件。可移植 SLSA provenance 指明源码仓库、提交、构建者和 workflow 执行，并绑定全部引用文件摘要。公共验证器再次读取所有引用字节后，生产者才写入 `windows/receipt.json`。已验证候选的上传仅在生产成功后运行；artifact 名称包含源码 SHA、run ID 和 attempt，保留七天。

-----

<a id="limitations"></a>
## 限制

失败 artifact 也保留与版本关联的[产品诊断记录](product-diagnostics.zh.md)，其中的采集状态与安装验收分别记录。

合成回归测试不证明安装器或 GUI 成功；只有真实候选 workflow 才能提供此类证据。npm 比较证明相对于已交付 manifest 的覆盖，不证明缺少 manifest 的打包代码依赖或缺失的许可证元数据。此 workflow 检查全新安装和无密钥 GUI 配置，不验证升级、回滚、模型执行、生产签名或商店分发。未签名 provenance 不认证构建者，单个 Windows 回执也不构成完整四平台 RC。

-----

<a id="dev-note"></a>
## Dev Note

[候选完整性决策](../../.agents/notes/implemented/process/2026-09-06-candidate-artifact-integrity.zh.md)负责信任与证据语义。[产品标识参考](product-release-identity.zh.md)负责平台版本表示。
