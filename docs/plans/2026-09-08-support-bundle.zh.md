# Support Bundle 实施计划

[English](2026-09-08-support-bundle.md) | 中文

**目标：** 为 Windows、macOS、iOS/iPadOS 和 Android 导出本地诊断，明确记录采集结果，并确保最终导出字节的密钥发现为零。

**架构：** 每个运行中的应用把自身状态投影为不可变 JSON 文档。运行时和传输所有者提供固定类别与有界计数；导出操作检查完整大小，并在密钥扫描未完成时拒绝交付。现有 profile 启动器、Gateway 授权和 Session 所有权继续有效。

**技术栈：** Swift/Foundation、Kotlin、现有 Cordis 插件与 typed Remote API、固定版本的 Gitleaks 和现有候选工作流。

## 范围与验收

本计划实施[交接文档](../../artifacts/verification/goal-mode-handoff-2026-09-05.md#82-gate-2--release-engineering-foundation)中的 G2-SUPPORT。每个平台必须采集应用版本/构建号/渠道、运行时健康、连接状态、诊断事件、协议版本、相关角色、capability 和更新状态。一个平台或一份部分文档不能关闭 G2-SUPPORT。导出保持本地，并由用户显式触发；它不启用遥测或上传数据。

每个部分标明生产者，以及观测属于当前、最后已知、不适用、不可用还是失败。未采集的信息不能被标记为健康、已授权或最新。初始 Mac 运行时导出在传输、更新和原生诊断生产者接入前保持部分完成。验收记录绑定候选、可执行文件和准确导出摘要。

## 数据所有权与隐私

应用标识来自打包后的产品元数据。Link 包版本不是应用版本。Apple 使用展开后的 AppInfo.plist；Android 使用生成的构建元数据；desktop staging 必须把产品标识传入运行时。没有 source SHA 时保持缺失，直到构建所有者提供相应运行时记录。

Mac 运行时健康来自 RuntimeSupervisor。Web 连接观测使用实际 generation 所有者，并区分初始连接与重连。Link socket 正在监听不能证明连接成功或运行时健康。原生客户端保留的配对角色属于最后已知观测；当前授权需要来自 Device Trust 权威所有者的认证响应。

诊断记录仅包含封闭的状态/失败类别和有界计数。它们排除原始进程输出、异常消息、凭据、提示、工具载荷、路径、地址、设备名称、Host 标识和遥测匿名标识。不能直接创建第二个 SessionTelemetryCoordinator，因为它的模块级 handoff cursor 是共享的。本地诊断采集不得干扰该 cursor 或启用其外部 sink。

文档明确声明未采集部分。导出字符串只允许经过验证的构建元数据和固定协议词汇。完整 UTF-8 文档在扫描前限制大小；打包不得在扫描后添加字段。扫描器失败、超时或不可用时禁止交付。扫描 canary 使用默认规则，并且不能通过源码审阅例外豁免。

## 选定方案与替代方案

从 Mac Host 的原生导出操作开始，因为其 supervisor 已拥有具体的生命周期和健康结果。扩展现有固定扫描器安装器以支持两种 macOS 架构，然后把扫描器随应用打包，离线扫描不可变导出字节。候选清单保留扫描器许可证和二进制来源。现有 Windows/Linux 安装器继续用于发布验证。

仅包含发布信息的 JSON 汇总不能诊断运行中的应用。整份日志脱敏会让未知载荷进入导出，因此采用显式投影。第二个 Gateway 或新的 Session domain 会重复现有权威所有者。这些替代方案均不采用。

移动平台不能启动桌面 CLI。连接移动端交付前，构建并执行使用同一维护中扫描规则的离线库适配器，包括真实 canary 和最终字节测试。如果无法建立该适配器，移动端导出保持不可用，同时继续独立的 Windows、Mac 和生产者工作；这不豁免移动端要求。

## 任务 1：支持经过验证的 macOS 扫描器获取

**文件：** `.github/security/scanners.json`、`scripts/release/secret_scan.py`、`scripts/release/test_secret_scan.py`。

1. 记录官方 Gitleaks 8.30.1 Darwin x64/arm64 归档 URL 和独立核验的 SHA-256 摘要。保留现有 Linux 与 Windows 固定版本。
2. 为两种 Darwin 架构、不支持的平台组合、归档篡改、错误二进制名称和版本不符添加可执行测试。无效选择必须在联网或执行前失败。
3. 扩展现有安装器，不执行其他架构的二进制，不削弱摘要/版本检查。在 Windows 和 Linux 运行聚焦 Python 测试；实际 Darwin 执行归远端 Mac 车道。

## 任务 2：交付 Mac 运行时导出

**文件：** `apps/apple/Sources/DirectHostRuntime/`、`apps/apple/Hosts/HostSurface.swift`、`apps/apple/Hosts/HostCopy.swift`、`apps/apple/Tests/DirectHostRuntimeTests/`、`apps/apple/UITests/DirectHostStartupTests.swift`、`scripts/produce-mac-host.ts`、`.github/workflows/mac-host-candidate.yml`。

1. 添加实际 supervisor 状态和有界生命周期计数的固定字段快照，分别记录失败与采集结果。快照操作不得启动、停止或重新配置运行时。
2. 验证内嵌标识，并序列化为一个不可变 JSON 值。向被忽略的生产者字段加入载荷 canary，证明它们不会进入序列化。为 stopped、ready 和 failed 状态保留所有者本地预期输出。
3. 在最终签名前打包经过验证的扫描器和许可证。运行时不继承配置、ignore 或凭据，仅保留固定扫描结果。限制进程执行时间，并在取消和超时后等待终止。
4. 添加本地化导出操作和原生保存对话框。只交付扫描器放行的字节。保存失败或取消不能宣称成功。运行时启动失败时仍可导出。
5. 执行已安装候选的实际操作，读取真实保存字节，验证产品标识和状态，独立扫描准确字节，并保留摘要和原生 UI 证据。缺失的生产者部分保持明确声明，G2-SUPPORT 继续部分完成。

## 任务 3：连接 Host 与 Windows 生产者

**文件：** `packages/remote/`、`packages/api/`、`packages/client/`、`apps/desktop/` 和 `scripts/release/` 下的现有所有者。

1. 通过现有已授权 Gateway 提供所需诊断投影。不得为方便而扩大远程管理 allowlist；通过实际执行器测试直接拒绝。
2. 接入实际协议/capability 和角色观测。区分本地应用和已连接 Host 的标识，连接丢失时清除该 generation 的观测。
3. 通过有作用域的 effects 采集生命周期类别，不存储原始日志，也不创建匿名身份。测试释放、重复交付和完整输出限制。
4. 在真实 updater 所有者实现后连接其状态。只有该所有者发出事实时才记录未检查、检查中、可更新、应用中和失败；没有实现不代表最新。
5. 在临时 runner 上执行正式 Windows profile 和已安装候选的导出。扫描最终字节，并保留成功和拒绝导出的证据。

Windows 生命周期设计：用仅负责观测的所有者包装现有原生 profile 启动和关闭调用。保留结果和拒绝，防止旧操作覆盖新阶段，并在异步导出采集前复制固定阶段和失败操作字段。将当前观测标为 `profile-lifecycle`，不推断 provider 可用性。在本地验证未完成和失败操作、退役操作结算及快照复制，然后要求新安装版与 portable 导出包含原生 ready 阶段。

## 任务 4：连接原生移动端生产者与扫描

**文件：** `apps/apple/Sources/SharedAppleRemoteCore/`、`apps/apple/Sources/CompanionUI/`、`apps/android/core/`、`apps/android/app/` 及其现有平台工作流。

1. 证明维护中扫描器的离线库适配器可在 iOS 和 Android 执行固定规则与 canary。构建产物按平台独立保存，并公开来源/module 清单。
2. 从所有者投影连接恢复、已认证 Host description、最后已知配对角色和应用标识。执行撤销、断连、重连和不可用状态，不序列化身份存储。
3. 通过相同的不可变字节与零发现准入规则添加原生本地导出。测试取消、过大输入、污染元数据、扫描失败和未知协议数据。
4. 在远端原生车道执行真实 iOS/iPadOS 和 Android 导出操作。本机缺少 Xcode 不阻止独立实现；相关完成声明仍需要远端编译和产品证据。

## 任务 5：仅关闭已验证覆盖

更新受影响的 README 对与决策 Note，重录配对，并运行聚焦测试、`test:docs`、`doc-sync`、lint 和正常 pre-push 检查。保持现有 dev draft PR。保留唯一交接和机器可读的平台覆盖矩阵。只有全部所需生产者及四个平台导出在同一候选上通过，才关闭 G2-SUPPORT；其他 Gate 2–4 要求继续独立验收。
