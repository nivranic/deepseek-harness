# Upstream 差异审计

状态：PASS（Gate 0 来源审计）。覆盖全部 17 个工作树、129 个变更归属、1938 个不同路径；29 项能力已完成归属决定。另有 22 项旧工作树未提交报告已记录摘要并保留。处置审查不等于补丁已迁入或运行验收。机器清单见 [CUSTOM_CAPABILITY_INVENTORY.json](CUSTOM_CAPABILITY_INVENTORY.json)。

## 已核实的架构差异

1. 官方 [Desktop Host process](apps/desktop/src/host-process.ts) 使用独立 Node 子进程和 framed pipes；旧 dev Desktop 在 Electron main 中持有 Cordis Context 和 DesktopGateway。采用官方 apps/desktop，旧实现不直接合并。
2. 官方没有 packages/client/runtime。[SessionManager](packages/api/session-controller/src/client/sessions/manager.ts) 位于 API Session Controller 的 Client 程序；[ConnectionController](packages/client/connection/src/client/connection.ts) 拥有连接 generation。
3. 官方 [Gateway](packages/api/gateway/src/index.ts) 保留 pendingRemoteEvents，Client 断开只移除 delivery，新连接重放 pending；完成或过时回答是 no-op。它还没有本规格要求的显式 interaction-closed 回执或跨进程重启后的 PendingInteraction 恢复证明。不能新造平行 Interaction 系统。
4. 官方 [Session types](packages/core/session/src/types.ts) writer 为 3；[格式状态](docs/session-format-status.md) 记录已发布版本 3。旧 SQLite 工作流与官方 JSONL 迁移不同，禁止自动打开用户旧数据。发布链接的在线状态本轮未单独查询。
5. 官方 [settings-file](packages/settings/settings-file/src/index.ts) 使用 namespace 文档，旧来源在相同文档中添加顶层 formatVersion 元数据。实际 Provider 对 formatVersion 1、2 的生成 JSON fixture 均能读取 namespace，读取不改原文，写入保留元数据；它不验证该字段，不能据此宣称未来版本兼容。未测试用户数据或 YAML fixture。
6. 官方 [credentials-local](packages/credentials/credentials-local/src/index.ts) 仍用文件、原子写和锁，并未完成 OS secure store；此项继续作为 Provider 工作。
7. 旧 Swift/Kotlin Handoff 注释和 sender 都指向 session/handoff 创建新 Full Session；新规格要求保留 Host/Session，仅转移查看位置，必须分开处理。
8. 官方 [electron-builder 配置](apps/desktop/electron-builder.config.mjs) 已包含 NSIS、签名、公证和 update 配置；已有源码不等于本候选已完成真实安装、签名或更新演练。

## 六分类迁移清单

分类是处置方向；Delete 表示不进入新候选，不删除仍需保留的旧工作树。迁入前仍需验证依赖、行为等价和数据影响。

| 能力 | 分类 | Phase | 决定 |
|---|---|---|---|
| desktop-shell | Adopt | 2 | 采用官方 Electron、独立 Node、framed pipes、dsh-app:// 和同版本 runtime；托盘和登录 adapter 已进入 Shell；系统注册、旧设置转换和共享诊断继续验证。 |
| desktop-carrier | Delete | 2 | 旧进程内 Desktop Gateway 和旧 profile 组合不进入新候选；官方私有 Desktop Host 负责启动。 |
| desktop-settings | Migrate | 2 | closeToTray 使用 Shell 自有版本化文件，launchAtLogin 读取 OS；旧 Host 设置转换仍须显式设计。 |
| apple-full-host | Experimental | 10 | Swift Full Host 保留于旧来源，退出生产主路线；macOS Full Host 采用官方 Desktop。 |
| apple-companion | Migrate | 10 | 仅迁入连接、Keychain、通知、分享与原生展示；排除 Full Host 与平行业务协议。 |
| android-companion | Migrate | 10 | Remote Companion 优先；保留 Keystore、SAF、分享和前后台恢复价值，Lite 单独准入。 |
| lite-runtime | Experimental | 11 | Lite 及移动本地执行延后，runtimeMode 与能力必须显式；不作为 Full Host 验收。 |
| gateway | Adopt | 3 | 保留官方 RemoteResult、RemoteError、stream/mux 和 scoped waterfall；下游补丁需逐项重审。 |
| client-connection | Adapt | 3 | 基于官方 ConnectionController generation/retry；增加远端状态前保持本地浏览器认证。 |
| session-client | Adapt | 3 | SessionManager 实际在 API Session Controller Client 侧；不存在 packages/client/runtime，不新建大 Facade。 |
| trust | Migrate | 7 | 把设备身份、角色、撤销与持久化从 Carrier 拆开；observer/controller/administrator 与新四角色不能直接等同。 |
| remote-carrier | Migrate | 8 | 仅迁入加密传输和 Device Trust 绑定；禁止复制 Gateway，撤销需断开已有 stream。 |
| remote-contracts | Migrate | 3 | 以官方 Typert owner 重新生成 Swift/Kotlin；不能原样复制旧 Link 类型表或 Session 格式。 |
| remote-management | Migrate | 7 | Device management 和授权由 Host service 贡献到统一 Remote，最终 leaf package 待能力设计。 |
| settings-storage | Adapt | 3 | 旧 formatVersion 是 namespace 文档中的顶层元数据；官方可读取 namespace，但不验证此版本字段，仍需明确版本识别与恢复规则。 |
| credentials-storage | Adapt | 7 | 官方仍使用受锁保护的 .credentials.yaml；OS secure store 是后续 Provider，文件权限不等于模型隔离。 |
| session-storage | Migrate | 3 | 官方 writer=3，具有 0→1→2→3 迁移；旧 SQLite 数据不得交给新启动器自动打开或覆盖，需独立转换证明。 |
| session-follow | Adapt | 9 | 采用 RemoteJournalStream 的 cursor、补页与重连机制；完整旧 persistence 补丁不直接迁入。 |
| artifacts | Migrate | 9 | 先比较官方文件上传/下载和 deliverables，保留文件、流控与元数据差异；不新建平行 API。 |
| shared-ui | Adapt | 5 | 官方 token 和 UI 组件为基础，响应式、safe area、键盘及状态矩阵以真实浏览器验收。 |
| relay | Migrate | 8 | 只保留 routing、presence、加密包转发；Transport 与 Trust 分离，远端不放宽 local Web auth。 |
| support-scanner | Keep | 6 | 保留离线脱敏扫描的独立价值；只有新候选集成、来源和产物校验通过后才准入 production。 |
| release-evidence | Adapt | 12 | 旧平台回执保留历史 SHA；官方 Desktop 发布管线优先，新 Gate 0–4 不继承旧 PASS。 |
| tooling-and-generated | Adapt | 1 | 按当前 owner 重审差异；先改生成源再生成，旧报告/Agent Note 只作历史证据。 |
| desktop-support | Migrate | 6 | 旧 Carrier 删除；诊断导出、scanner 和原子保存独立迁入共享服务。 |
| electron-node-workaround | Delete | 2 | 独立 Node Host 消除 Electron 内执行所需的 confined.env/runnerEnv 扩展。 |
| upstream-process-ownership | Adopt | 2 | 采用官方 SubprocessHandle 与 Job runner 语义，不覆盖为旧接口文档。 |
| owner-metadata | Adapt | 1 | 目录、编译引用、依赖和许可只随实际准入能力更新；保留官方配置。 |
| test-porting | Adapt | 2 | 保留仍适用的确定性 fixture 修正，业务 fake 和目录预期随最终 owner 更新。 |

## 审计结果

已完成 129 个归属处置审查，证据与保留任务见 [组件审查记录](artifacts/upstream-first/component-reviews.json)。未映射归属 0 个。Gate 0 为 PASS；后续按下表任务进入官方 Desktop 收敛，不恢复旧 Desktop 或平行协议。完整计划见 docs/plans/2026-09-14-upstream-first.md。

## 已审查的迁移任务

来源审查与实施状态分别记录。下表投影每项任务的当前状态；PASS 的结果和回执见组件审查记录，未记录实施状态的任务为 NOT_STARTED。

| 审查组 | Phase | 状态 | 任务 | 目标 owner |
|---|---|---|---|---|
| desktop-runtime-selection | 2 | IN_PROGRESS | 迁移 closeAction 和 launchAtLogin 为 Shell 适配；保留托盘创建失败时窗口可恢复 | apps/desktop/src |
| desktop-runtime-selection | 6 | NOT_STARTED | 把旧 runtime diagnostics 和 support save callback 接入共享诊断服务与官方 Shell | apps/desktop/src |
| desktop-runtime-selection | 2 | PASS | 通过原生选择与预览显式导入旧 Desktop 关闭偏好 | apps/desktop/src/legacy-settings.ts |
| desktop-runtime-selection | 2 | PASS | 修正官方 Desktop 原生 payload 检查并验证 unsigned Windows 打包应用 | apps/desktop |
| retire-old-desktop-composition | 2 | PASS | 检查官方 Desktop 模型上下文是否准确声明执行位置；如缺少则通过现有 context owner 补齐并更新快照 | apps/desktop-host、packages/core/system-prompt |
| split-old-carrier-and-support | 6 | NOT_STARTED | 抽取共享 support producer/sanitizer/manifest/checksum 和有限结果枚举，再接入 native save adapter | packages/runtime-diagnostics |
| split-old-carrier-and-support | 6 | NOT_STARTED | 重跑旧 support 导出、取消、并发、内容替换/链接攻击与 scanner 故障回归 | apps/desktop/tests |
| split-desktop-settings-ui | 2 | PASS | close/login 薄适配使用 typed locale 和受限 Shell 操作 | apps/desktop |
| split-desktop-settings-ui | 7 | NOT_STARTED | 设备名、四角色、撤销列表进入共享 Device Management | packages/client |
| split-desktop-settings-ui | 6 | NOT_STARTED | support export 进入共享 Diagnostics UI | packages/client |
| remove-electron-node-workaround | 2 | IN_PROGRESS | 真实 Desktop Node Host 上验证受限 Bash/Pwsh 启动、取消、清理和环境 scrub | apps/desktop/tests |
| generated-owner-maps | 7 | NOT_STARTED | Device Trust/Remote 准入后更新当前目录和子系统链接 | packages/README.md |
| generated-owner-maps | 6 | NOT_STARTED | Support scanner 准入后补原生映射和许可证来源 | native/README.md |
| generated-owner-maps | 9 | NOT_STARTED | Artifact owner 明确后同步 map、生成 catalog 与配对 | packages/README.md |
| source-topology-metadata | 12 | NOT_STARTED | 对应实际准入的 Native/scanner/release 工具重建 SBOM/THIRD_PARTY_NOTICES | scripts/gen-third-party-notices.ts |
| test-artifact-stubs | 9 | NOT_STARTED | 最终 artifact 能力准入后生成工具目录并更新真实 Client fake | packages/client/ui-conversation/tests |
| test-reliability-patches | 2 | IN_PROGRESS | 在当前相应测试仍存在时保留这些确定性 fixture 修正；不移植已被上游替代的断言 | packages/*/*/tests |
| gateway-remote-delivery | 3 | NOT_STARTED | 明确 N/N-1 新增字段和冲突 outcome 字段规则，生成三语言正反用例 | packages/api/gateway/src/stream-protocol.ts |
| gateway-remote-delivery | 4 | NOT_STARTED | 同时回答、被撤销设备和无权 delivery 验证；第二个回答返回 interaction-closed | packages/api/gateway/src/index.ts |
| gateway-remote-delivery | 7 | NOT_STARTED | 设备权限在 Host pending delivery/response 两处一致执行 | packages/api/gateway |
| remote-contribution-assembly | 6 | NOT_STARTED | 共享 diagnostics Remote 贡献在 Host/Client 两面注册并验证卸载 | packages/api/remotes |
| remote-contribution-assembly | 7 | NOT_STARTED | Device management Remote 使用统一权限和生成器 | packages/api/remotes |
| connection-recovery-and-diagnostics | 4 | NOT_STARTED | 回归 stop→start 在旧 source 未 settle 时不恢复旧 loop，并保留 manual/offline recovery | packages/client/connection/tests/connection.client.spec.ts |
| connection-recovery-and-diagnostics | 6 | NOT_STARTED | 诊断读取有界计数，不暴露 host home、payload、请求 id 或错误正文 | packages/client/connection/src/client/connection.ts |
| connection-recovery-and-diagnostics | 8 | NOT_STARTED | 独立 Remote generation source 与原 local cookie/Host/Origin 校验并存 | packages/client/connection |
| module-resources-and-host-facts | 3 | IN_PROGRESS | 版本、runtimeMode、Host 平台等从受验证 HostDescriptor 读取，独立于 bundle manifest | packages/api/remotes |
| module-resources-and-host-facts | 6 | NOT_STARTED | Shell/Host runtime 诊断区分 Electron 与子进程 Node | apps/desktop |
| module-resources-and-host-facts | 2 | PASS | 验证 packaged CLI/Python 的 moduleFallback manifest 与资源解析；仅迁入当前实现仍缺少的解析修复，Desktop 不增加 fallback | packages/client/modules |
| session-artifacts-and-handoff | 9 | NOT_STARTED | 查看 handoff 只传 HostId/SessionId/revision/UI location，不创建 Session 或队列 prompt | packages/api/session-controller |
| session-artifacts-and-handoff | 9 | NOT_STARTED | 复用官方文件读取能力，保留 Session 引用授权，定义字节范围/元数据/背压与错误脱敏 | packages/api/workspace-files |
| session-artifacts-and-handoff | 11 | NOT_STARTED | Lite→Full snapshot 导入若保留则独立命名、显式用户操作和 mutation idempotency | packages/api/session-controller |
| web-index-injection | 2 | PASS | 将 openingTagEnd 的线性查找与缺失/畸形标签测试局部迁入，验证注入次序与正常 HTML 字节 | packages/host/webserver/src/injections.ts |
| storage-domain-lifecycle | 3 | PASS | 移植写入顺序与 owner teardown 的最小修正，回归迟到 flush、detach、并发 close、初始化中卸载与拒绝传播 | packages/storage/storage-domain |
| storage-domain-lifecycle | 3 | PASS | checkpoint 身份与日志 durable cut 同步，保留官方 inheritedEventCount | packages/session/session-projection-cache |
| sqlite-session-export-and-format-chain | 3 | NOT_STARTED | 设计旧 SQLite 一致性快照→逻辑 v0 事件→官方 adjacent chain→独立 JSONL generation 的显式离线导入 | packages/session/session-format |
| sqlite-session-export-and-format-chain | 3 | NOT_STARTED | 验证 custom Artifact event、未知必读事件、packed rows、继承切片、crash tail 与发布原子性；原库及 WAL 备份保留 | packages/session/session-persistence-jsonl |
| settings-metadata-compatibility | 3 | NOT_STARTED | 设置导入显式检查来源标识和已知版本，验证 JSON/YAML、注释、未知 namespace、并发写及恢复；不扩张普通 Provider 成为另一套格式系统 | packages/settings/settings-file |
| workspace-files-security-policy | 8 | NOT_STARTED | 为远端身份在统一 Host 文件操作处校验 grant 与 canonical path，覆盖链接、绝对路径、跨 workspace 与 TOCTOU | packages/api/workspace-files |
| workspace-files-security-policy | 9 | NOT_STARTED | Native 迁移到官方 text/bytes/list/watch DTO，验证超大文件、UTF-8 边界、空文件、取消与断点 | packages/api/workspace-files |
| device-trust-authority | 7 | NOT_STARTED | 拆分 Device Trust 服务与 Carrier，明确四角色保守迁移和 owner bootstrap，已撤销不复活 | packages/identity |
| device-trust-authority | 7 | NOT_STARTED | 保留单次 challenge 消费，补 proof/replay/expiry/re-key/reinstall 测试及原库保留的显式迁移 | packages/credentials |
| remote-carrier-authentication | 3 | IN_PROGRESS | HostDescriptor 使用产品/API/Session 三版本和能力集；错误映射进入共享 Remote | packages/api/remotes |
| remote-carrier-authentication | 7 | NOT_STARTED | 配对公钥 proof、Host/设备重装恢复、撤销所有活跃 stream | packages/identity |
| remote-carrier-authentication | 8 | NOT_STARTED | 独立加密 Carrier 复用 Gateway，验证重放请求、clock skew、IPv6、断连和背压；不能放宽 browser auth | packages/client/connection |
| remote-contract-generation | 3 | NOT_STARTED | 从现有 Typert 类型图输出 Native DTO 与 closed error/capability/version 规则，补新增字段及非法 union 测试 | packages/typert/generator |
| remote-contract-generation | 9 | NOT_STARTED | Companion 只投影 Host 事件，重放/缓存不产生第二份 Session 真源 | packages/api/session-controller |
| remote-contract-generation | 11 | NOT_STARTED | Lite 独立 runtimeMode 与 tool catalog，勿混入普通 Remote Session | packages/experimental |
| remote-preference-bridge | 7 | NOT_STARTED | 共享设备设置提交后更新 Host 状态，快速 enable/disable 不乱序，失败呈现具体 readiness 状态 | packages/settings |
| remote-preference-bridge | 7 | NOT_STARTED | Question 与 Approval 权限按四角色矩阵分别执行 | packages/identity |
| artifact-storage-and-events | 9 | NOT_STARTED | 定义统一 ArtifactDescriptor/FileDescriptor 与 Session 引用授权；stream/range、MIME、零字节与取消均由 Host 执行 | packages/api/workspace-files |
| artifact-storage-and-events | 9 | NOT_STARTED | 模型工具与新事件同时更新快照及 SDK/Native 投影，迁移时保留历史 artifact 字节与引用 | packages/core/session |
| telemetry-privacy-projection | 6 | NOT_STARTED | 迁入默认关闭、必须先投影再删减的 telemetry 发送路径，验证插件无法恢复正文/凭据、无 ambient trace | packages/session/session-telemetry |
| telemetry-privacy-projection | 6 | NOT_STARTED | 按 Session/provider/Relay/trust/crash 元数据分别披露，重建真实 composition 的脱敏测试 | packages/session/session-telemetry-otel |
| thin-native-companions | 10 | NOT_STARTED | 用统一 Remote 生成 DTO/测试向量；迁入 Companion Shell，移除第二套 Session 状态真源 | apps |
| thin-native-companions | 7 | NOT_STARTED | Keychain 使用多 Host 索引、明确错误与恢复；保留 Android missing-key 拒绝恢复测试 | packages/credentials |
| thin-native-companions | 11 | NOT_STARTED | Lite 独立 feature flag 与能力准入，Full Mobile Host 保持 Experimental | apps |
| relay-prototype-quarantine | 8 | NOT_STARTED | 选用维护中的传输原语，认证 rendezvous 身份并约束包大小、队列、背压、过期和重放；中继不读取 Session 明文 | apps/relay |
| support-scanner-library | 6 | NOT_STARTED | 接入共享 support service，重验依赖、规则摘要、取消和 canary；平台构建来源绑定候选 | native/support-scanner |
| regenerate-extension-catalogs | 3 | NOT_STARTED | 从最终准入的 Typert/Remote owner 重生成目录并检查无旧 Carrier 引用 | scripts |
| profile-boot-correctness | 2 | PASS | 对当前 profile owner 最小迁入独占创建与 junction 恢复，测试并发初始化和拒绝非空冲突 | packages/boot/app-boot |
| profile-boot-correctness | 2 | PASS | 验证 packaged CLI/Python 模块来源及资源 manifest，禁止依赖构建机父目录 | packages/boot/app-boot |
| adopt-current-windows-process-owner | 2 | PASS | 将旧先入 Job 再执行、退出码、stdio、进程树回收场景映射到当前 runner 验证，缺口才补测试 | packages/subprocess/subprocess-local |
| small-helper-correctness | 2 | PASS | 在当前 owner 核验 byte 写入、锁删除竞态与 Windows/Unix trailing separator 语义，再迁入缺失修复 | packages/util |
| small-helper-correctness | 6 | DEFERRED | 诊断二进制导出接入时审查实际 byte 写入消费者，再决定扩展 writeFileAtomic | packages/util/atomic-write、共享诊断服务 |
| adopt-cli-entry | 2 | PASS | 允许所选 profile 工作区根目录安装插件，且不修改持久 pnpm 配置 | apps/cli |
| adopt-cli-entry | 2 | IN_PROGRESS | 完成已安装 Windows runtime 的 pnpm 配置与插件安装链验收 | apps/cli、python/sdk-runtime |
| adopt-cli-entry | 2 | PASS | 保留 Windows pnpm shim 中的字面参数与子进程退出语义 | apps/cli/src/plugin.ts |
| native-picker-memory-copy | 2 | PASS | 采用上游 UTF-16 解码，补齐异常释放，并验收实际 Desktop 的原生目录选择、取消与 Abort | packages/host/directory-picker-native |
| shared-ui-settings-and-text | 5 | NOT_STARTED | 迁入仍缺失的 collapsed 设置按钮可访问名称和线性扫描，保留 URI/标签语义并做真实浏览器矩阵 | packages/client |
| shared-ui-settings-and-text | 6 | NOT_STARTED | 以统一诊断事实提供 About；区分 Shell Electron 和 Host Node | packages/client/ui-settings-general |
| linear-host-reference-and-files-endpoints | 3 | NOT_STARTED | 迁入当前仍缺失的扫描修复，测试嵌套前缀、非法 canonical URI、Unicode escape、scope 一致性 | packages/context/session-reference |
| linear-host-reference-and-files-endpoints | 3 | NOT_STARTED | 将 Files endpoint 同一 normalization 用于请求和缓存，覆盖长 slash 输入 | packages/llm/llm-deepseek |
| private-telemetry-identity-and-consent | 6 | NOT_STARTED | 将 privacy projection、seed 派生和 consent 文案一起迁移到当前 telemetry owner；验证并发轮转与敏感字段不外发 | packages/identity/anonymous-user-id |
| private-telemetry-identity-and-consent | 7 | NOT_STARTED | 恢复/权限失败状态与 Windows secure store 适配分别验证；旧 UUID 不用作 HMAC key | packages/credentials |
| composition-follows-admitted-owners | 6 | NOT_STARTED | 默认关闭 telemetry，并让开启模式只通过实际隐私投影 | packages/bundle/base |
| composition-follows-admitted-owners | 9 | NOT_STARTED | 只在完成 Artifact owner 后注册 Full preset，更新模型可见快照 | packages/preset/agent-presets |
| local-device-administration-owner | 7 | NOT_STARTED | 将 device 管理接到独立 Host Trust owner；操作授权和参数验证在 Host 执行，Carrier 仅提供连接观测 | packages/api/remotes |
| acp-current-model-and-process-semantics | 3 | NOT_STARTED | 在当前 ACP owner 核验 options 重复通知、异步顺序与进程启动拒绝；仅补仍缺失的行为 | packages/acp/acp |
| current-owner-test-infrastructure | 3 | NOT_STARTED | 迁入真实生命周期观测的 fixture 修复，保留断言失败；不以延长超时代替同步条件 | packages/test-support |
| retain-targeted-regression-scenarios | 2 | PASS | 迁入 LSP 请求到达、取消后复用及 stdin 错误传播的独立观察 | packages/lsp/lsp-stdio |
| retain-targeted-regression-scenarios | 2 | PASS | 迁入 Codex yielded session、唯一 call id 与成功退出的 fixture 观察 | packages/subagent/subagent-codex |
| retain-targeted-regression-scenarios | 2 | PASS | 审查 SDK/Claude 等待预算，仅依据当前失败证据适配；真实 Claude CLI 验证单列 | packages/subagent |
| retain-targeted-regression-scenarios | 3 | NOT_STARTED | 检查 persistent marker regex，不扩大无关测试超时 | packages/shell |
| linear-catalog-jsdoc-parser | 3 | NOT_STARTED | 迁入 parser 复杂度修复与等价向量，确认 catalog 无无关输出变化 | packages/typert/generator |
| python-cli-windows-lifecycle | 2 | PASS | 验证当前 Windows Python entry 的等待、引号/空格/尾斜杠 argv 与 native exit；迁入缺失修复 | python/sdk-runtime |
| python-cli-windows-lifecycle | 12 | IN_PROGRESS | 对新候选真实打包 runtime 执行支持的 profile smoke，约束 loopback/token 且不保存秘密 | scripts |
| experimental-prototypes-stay-out-of-production | 11 | NOT_STARTED | 若 Lite 复用 worker，逐项验证显式能力和 VFS 限制；调试器不得进入受信任远端控制面 | packages/experimental |
| vendor-entry-guard | 2 | PASS | 确认支持的 profile 入口是否仍能缺失 argv[1]；如需修复按 vendor 同步与本地修改记录规则执行 | vendor/hmr |
| official-workflows-with-source-proofs | 12 | NOT_STARTED | 在官方发布流程附加不可变 source/tree/workflow/run-attempt 证明及 pin/权限检查，不复制第二套签名/更新管线 | .github/workflows |
| official-workflows-with-source-proofs | 10 | NOT_STARTED | Native Companion 准入后恢复平台源码/构建输入绑定；SDK/NDK/Xcode/Go pins 重新验证 | .github/actions |
| security-inputs-revalidate-exceptions | 12 | NOT_STARTED | 更新并验证 scanner acquisition；按实际保留 fixture 精确重建例外，拒绝旧 SHA review 当作新候选验收 | .github/security |
| release-policy-convergence | 12 | NOT_STARTED | 从新 Gate/平台能力生成 policy 和 required checks；扩展兼容/安全/恢复/真实应用证据，拒绝仅产物存在 | release |
| audit-build-release-script-families | 2 | IN_PROGRESS | 核验官方 overlay 插入互斥、profile 可启动性和 packaged module 解析；只补当前缺失的静态拒绝用例 | scripts/verify-cordis-config.ts |
| audit-build-release-script-families | 3 | NOT_STARTED | 旧 Session/settings/trust conversion 替换为明确新旧格式转换，并保留 source backup/WAL/失败恢复 | scripts/release |
| audit-build-release-script-families | 6 | NOT_STARTED | 固定 diagnostic 状态区分 NO_REPORT/UNAVAILABLE/INCOMPLETE；扫描后导出且取消 join，关联当前应用实际输出 | scripts/release |
| audit-build-release-script-families | 12 | NOT_STARTED | 迁移源绑定、bounded safe file reader、不可变 hash 和独立 authenticated execution 核验；旧 RC/平台回执不得当新证据 | scripts/release |
| audit-build-release-script-families | 12 | NOT_STARTED | 只在当前 gate 图确有并发源污染时补 knip/probe 顺序；保留最小无敏感 child-exit 诊断 | scripts/run-gates.ts |
| official-manifests-and-lockfile | 12 | NOT_STARTED | 按已准入工具验证必要依赖后更新官方锁文件；使用安装与目标构建验证，移除无 consumer 依赖 | package.json |
| web-regression-scenarios-follow-current-client | 5 | NOT_STARTED | 迁入仍缺失的中英可访问性/可导航状态测试并使用正常 dev 浏览器做产品验收 | apps/web/tests |
| web-regression-scenarios-follow-current-client | 6 | NOT_STARTED | 以当前 settled event vocabulary 重建 telemetry collector 回归，验证默认不发及显式 consent 后无敏感字段 | apps/web/tests/feedback-release.e2e.ts |
| snapshots-regenerate-from-owners | 3 | NOT_STARTED | 根据真实模型/用户可见改动更新 keyless session 与双 SDK 预期，保留平台无关 fixture | snapshots |
| historical-documents-and-evidence | 2 | IN_PROGRESS | 为实际收敛改动记录新决定并检查 supersession；保留仍适用的官方 Note | docs |
| historical-documents-and-evidence | 12 | IN_PROGRESS | 以新候选执行结果重建报告；旧回执可引用历史来源但不能满足新 Gate | artifacts |

规格依据：[按初始 SHA 恢复的原文](artifacts/upstream-first/original-specification.md)与[完整追踪记录](artifacts/upstream-first/specification-traceability.json)。追踪覆盖不替代逐项验收，未完成范围不因局部测试通过而缩减。
