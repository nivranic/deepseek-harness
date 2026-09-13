# Agent Note: CI 故障切换手册 — 托管池 → 自有池

Status: implemented

[English](2026-07-26-ci-failover-runbook.md) | 中文

## 问题

所配置的 runner 标签不可用时，必需 CI 作业无法完成。Fork 不会继承上游企业池，托管池故障也会让必需检查停在队列中；合并工作流修复本身又可能依赖这些检查。因此 Linux 与 Windows 需要独立的 runner 选择和故障切换，并为新仓库提供可直接使用的标准托管默认值。

## 决策

三个 Linux 工作作业默认使用 `ubuntu-24.04`，四个原生 Windows 作业默认使用 `windows-2025`。仓库变量 `DSH_CI_LINUX_RUNNER` 和 `DSH_CI_WINDOWS_RUNNER` 可指定已配置的托管标签。`DSH_CI_FAILOVER_LINUX=selfhosted` 优先为 Linux 工作作业和 `all checks passed` 选择 `vm-backup`；`DSH_CI_FAILOVER_WINDOWS=selfhosted` 为原生 Windows 作业选择 `dsh-win-ci`。Dependabot 仍不能进入这两个自托管池。Linux 故障切换跳过托管 pnpm 缓存恢复。`ci.yml` 中独立的并发变量保留适合标准 runner 的有界默认值，已配置的大型池可以显式提高它们。全部必需测试和聚合依赖列表保持不变。仓库写者无需合并即可修改这些变量，master 热备通道验证所配置的自托管池。

`ci-master.yml` 只豁免一个事件不做取消（`${{ github.event_name != 'push' }}`），因此一次 master 推送不会取消上一次推送留下的、仍在运行的演练。每次演练以单门禁工作进程执行完整的未分片聚合流程，耗时长于 master 合并的间隔；在无条件取消下，演练会在得出结论前被后续运行取代，该通道无法产出供响应者查看的就绪证据。

这项豁免比「演练总能跑完」要窄，有两点限制。其一，GitHub 每个组只保留一个待运行条目，更新的待运行条目会顶掉更早的，繁忙时段中间的推送运行仍会以 `cancelled` 结束。其二，该表达式是针对**新触发的运行**求值的，因此自身事件不是 `push` 的运行——例如在 `ci-master.yml` 内的 master 上派发的基准测试，与其演练共用 `CI master-<ref>` 组——求值为 `true`，会取消正在运行中的演练。这属于罕见的手动操作，且下一次 master 推送即可恢复证据，因此不值得为它再加机制。这项豁免换来的是该通道**周期性**地得出结论，而这正是它能作为证据的前提。

这个决定必须放在工作流级：取消作用于被取代的整个运行，作业级 `concurrency` 组并不能豁免其所属作业。采用否定式写法而非仅指名 `pull_request`，是有实质作用的：后者会连 `workflow_dispatch` 一起停止取消，而每次运行器基准测试会在 master 上的同一并发组内同时占用 12 台大规格运行器、最长 15 分钟，届时重复派发会排在演练之前，而不是替换掉已过时的测量。成本之所以可控，是因为 `ci-master.yml` 中一次 master 推送只承载 `wine-apt-cache` 和这两条演练；拉取请求作业位于独立的 `ci.yml`（不监听 `push`），而基准测试在 `ci-master.yml` 内受 `workflow_dispatch` 门控。`scripts/ci-workflow.spec.ts` 会锁定这个推送可达集合——按条件精确匹配，因为否定式事件判断会包含它所排除的事件名——使新的推送可达作业无法悄悄开始累积未取消的运行。

### 自有池是什么

`vm-backup`：一台 64 核虚拟机，6 个常驻 systemd 管理的运行器实例。其镜像必须预装 Playwright Chromium 的 Linux 系统软件包；CI 会下载锁文件选定的浏览器，但绝不在这台持久化共享主机上运行 `apt`。切换前先看 `serial / linux (self-hosted standby)` 最近一次运行：其聚合流程包含浏览器回放，因此绿色热备同时验证常规容量和这项浏览器先决条件。

#### Windows 池

`dsh-win-ci`：公司内部 Windows CI 服务器（一台 96 核 / 580 GB 机器）上 32 个常驻运行器实例（计划任务 `GH-Runner-01`…`GH-Runner-32`）。标签：`[self-hosted, dsh-win-ci, windows]`。镜像必须预装 Node 24、pnpm、Git（Git Bash 在 `PATH` 上，即 `C:\Program Files\Git\bin`——`bash` 工具按名称 spawn `bash`）、PowerShell 7，并为符号链接支持启用开发人员模式。切换前先看 `serial / windows (self-hosted standby)` 最近一次运行：绿色热备验证该池能端到端执行 `check:ci:windows-complete`。

### 切换步骤（任何具备写权限的协作者，约 1 分钟，无需合并）

两个开关相互独立：只切换发生故障的那个平台。

1. 仓库 **Settings → Secrets and variables → Actions → Variables → New repository variable**：名称 `DSH_CI_FAILOVER_LINUX`（Linux 池故障）或 `DSH_CI_FAILOVER_WINDOWS`（Windows 池故障），值 `selfhosted`。
2. 重新触发必需作业，使其重新解析运行器池。已经为托管标签**排队**的作业不会重定向，也无法原地 re-run，因此对于本手册所述的无限排队故障，应取消卡住的运行并 re-run all jobs，或推送一个新提交；“Re-run failed jobs”只有在作业真正失败（而非仍在排队）时才有用。
3. 重跑受影响的作业。Linux 故障切换跳过托管 pnpm 缓存恢复，由持久 store 提供热安装。`DSH_CI_SNAPSHOT_MAX_CONCURRENCY` 独立于 runner 选择控制回放并发，默认值为 4。覆盖率保留四个插桩分区与两个豁免 worker。Windows 开关只改变 runner 选择。

#**Dependabot 例外。**两个开关的选择器都刻意排除了 `dependabot[bot]`：故障切换期间，Dependabot 拉取请求继续在托管池排队，而不是把依赖项提供的代码放到持久化虚拟机上执行。故障期间 Dependabot PR 持续排队是预期行为而非切换失败；托管池恢复后它会自行完成。

**谁能扳动这个变量。**GitHub 的 API 允许任何具有写权限的协作者管理仓库变量，因此每个开关实际是写者级而非严格的管理员级。在本仓库的信任模型下这并不构成升权：runner group 接纳本私有、禁 fork 仓库的全部工作流（这是让 PR 引用的故障切换得以成立的刻意取舍），因此任何写者本就可以通过推送分支工作流触达这台虚拟机。抵御不可信代码的边界是仓库成员资格；变量只是为成员路由工作。

## 切换期间的容量

6 个常驻实例可承接正常 PR 流量（该池平时唯一的稳态负载是每次 master 推送一个串行热备作业，故障切换时几乎全池可用）。若仍出现排队，用组织级注册 token（组织 Settings → Actions → Runners → New runner）追加注册实例。复制现有 runner 目录时**必须排除身份文件**——`rsync -a --exclude '.runner*' --exclude '.credentials*' --exclude '_diag' --exclude '_work' <src>/ <dst>/`（通配同时排除 `.runner_migrated`/`.credentials_migrated`——GitHub 会在迁移过的运行器上写入这些文件，它们同样会触发 already-configured 拒绝）——再跑 `config.sh`（原样拷贝 `.runner`/`.credentials` 会使其以 "already configured" 拒绝），然后**启动监听器**：`sudo ./svc.sh install ubuntu && sudo ./svc.sh start`。仅注册不会上线；只有启动了服务的 runner 才会增加容量。每个约一分钟。


### 切回

删除 `DSH_CI_FAILOVER_LINUX` 或 `DSH_CI_FAILOVER_WINDOWS` 变量（或改为 `selfhosted` 以外的任何值），新的运行即解析回托管企业池。若故障期间追加注册过实例，将其移除。

### 信任边界

这些变量是写者可管理的仓库状态；`pull_request` 事件本身既不能设置它们，也不能让不同的值生效，选择器表达式存在于工作流定义中。需要注意：故障切换期间，`pull_request` 运行执行的是 PR merge 引用自带的工作流定义——抵御不可信代码的边界是仓库成员资格（私有、禁 fork、选择器排除 Dependabot），而非该变量。关于 runner group 策略的说明：把 runner group 绑定到 master 引用的工作流与本故障切换机制**不兼容**——五个故障切换作业是从 PR merge 引用求值的 `pull_request` 运行，master 绑定的组会让它们持续排队（2026-07-27 实际故障中亲历；当时将组放宽为本仓库全部工作流才疏通了切换）。更严格的运行器侧策略以牺牲 PR 故障切换为代价；当前采用的形态是仓库范围、全工作流的组访问。

## 曾考虑的替代方案

**通过合并一次工作流改动来切换池。** 否决，因为触发切换的故障状态恰恰是任何 PR 都无法合并的状态：必需检查正是失败的那些。仓库变量是写者可管理的状态，重跑即生效，无需合并。

**让自托管池长期处于必需路径中。** 否决，因为这是拿托管池的可用性去换自有虚拟机的可用性，只是搬移了单点故障而非增加回退。这些变量让托管池保持主路径，自托管池作为一个经过验证、一步即可启用的热备；按平台拆分意味着一个平台的故障不会重定向另一个平台。

## 后果

标准 runner 无需上游企业配置即可使用。托管池故障恢复仍需要已配置的自托管池、变量修改和一次重跑。master 热备作业验证这些池，Linux 缓存恢复仍受故障切换条件控制。显式托管标签和并发变量增加了配置项，同时保持平台选择独立并保留每项必需检查。
