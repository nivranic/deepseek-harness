# Agent Note: 真实 Host 原生 Link 验收

Status: implemented

[English](2026-09-02-real-host-native-link-acceptance.md) | 中文

## 问题

生成式 Swift/Kotlin 模型、fixture 回放、本地 fake server 与 TypeScript carrier slice 都只证明了原生 Link 路径的一部分。此前没有原生客户端对 shipped Host composition 实际执行，因此配对、钉扎 TLS、签名 RPC、Session 流、Remote Approval、取消、重连与撤销可能一起漂移，而全部既有检查仍保持绿色。

## 决策

一份仓库所有的 corpus 以规范顺序列出从配对到撤销的 13 个必需步骤，并拥有每个步骤的可观测值。list 步骤点名 target 与 decoy 会话的精确 id，history 绑定 target opening 并禁止 decoy，prompt 绑定已接受请求与精确应答并禁止 decoy，reconnect 则点名 active stream 中断、follow 与 Remote Event 的精确 replacement 数量、权威快照要求与 Client 身份刷新。每个 driver 都在打开 carrier 前拒绝多余或缺失的键，也拒绝超出这些钉死预期的值。

Vitest orchestrator 以隔离 Harness home 与确定性模型服务器启动 shipped base 加 desktop composition，在每台宿主上执行 TypeScript 参考客户端，并在所属平台车道执行独立编译的 Swift 或 Kotlin driver。两套原生 driver 读取同一个物理 corpus，并使用各自生产 Link client、签名、钉扎、unary、stream 与伴侣状态实现；任何复制进原生资源的文件都不能成为第二个场景 owner。control listener 启动 Approval 前，会等待该 driver 的第二个模型请求进入保持打开的 stall response；随后取消必须关闭该 provider 连接，而模型服务器把这个事实记录为 `client_closed`。reconnect 中断 active follow 与 `$events` generation，再要求生产 view model 各打开恰好一代 replacement，并发布新权威快照与 Host 签发的 `clientId`。

Host control listener 只绑定 loopback，并由随机 bearer token 保护。它可以触发真实 Approval 请求、报告结算结果并撤销已配对测试设备；它绝不替客户端执行业务操作或回答交互。原生客户端通过真实 TLS carrier 完成每个 Link 请求，且必须把每项 corpus 步骤报告为 `PASS`。orchestrator 会拒绝缺失、跳过、乱序或重复步骤，也会拒绝 corpus hash、源码 revision 或协议版本不一致。

Apple 与 Android workflow 安装仓库 JavaScript 依赖，经 orchestrator 执行各自原生 driver，并上传由 Host 发布的结果 JSON。原生 driver 只能向隔离 Harness home 下的 candidate 写入。Host 会先发布不含 credential 的 `FAIL` 结果，只在校验 candidate schema、corpus hash、分离的 Host 与 Client revision、Link protocol、Link contract、Session format 版本、全部终态步骤、control listener 观测，并对启动前使用的同一源码 revision 完成第二次 clean-input 检查后，才把它替换为 `PASS`。clean-input 检查覆盖完整 native app tree，并拒绝被忽略的源码或配置文件。subprocess 服务会从移除 credential 形态变量和 ambient `DSH_*` 项的 parent base 派生子进程环境，并且只显式恢复私有配置路径。在 Windows 上，已校验的 canonical Gradle argv 会经 `cmd.exe` 运行，因为 Node 无法直接启动 batch shim；该解释器不会收到调用方自定义 token。Vitest 取消与独立的 480 秒 deadline 都会请求树级终止；runner 会分别报告取消、deadline、exit code 与 signal，且 candidate 校验只在进程结算和整树退出后开始。teardown 只会在其绝对 deadline 前等待整树退出；越过 deadline 时会发布不含 credential 的 `FAIL` 证据，而不会发布 `PASS`。进程隔离回归要求父进程退出后仍能终止抗拒的孙进程、保留预先发布的 `FAIL` 结果，并以进程启动身份约束兜底清理。仓库 task evidence 会把无法启动 Swift 或 Gradle 的宿主记录为 `NOT_EXECUTED`；已配置的原生启动失败会保留不含 credential 的 `FAIL` artifact。TypeScript 参考运行能证明 Host harness，却不能关闭任何原生结果。

## 考虑过的替代方案

**把生成式 fixtures 当作互操作证据。** 否决，因为解码相同字节不会打开原生 TLS 栈、签署真实 Host 请求、观察 live Session stream，也不会执行重连与撤销。

**使用原生 fake server。** 否决，因为它会在测试内复制 Gateway envelope、授权、Session projection 与 Remote Event settlement，并可能在 shipped Host 已不一致时仍与客户端相互同意。

**启动带测试专用 control API 的独立 supported application。** 本门禁否决此方案，因为既有 real-composition test 已启动 shipped base 与 desktop Loader tree，而 application-level control API 会仅为协调增加非产品 surface。原生客户端仍是独立进程，全部产品请求仍穿过真实 carrier 与 Gateway。

**把场景复制进每个原生测试 bundle。** 否决，因为字节新鲜度不能阻止三位 owner 分别修改语义。两套 driver 都在运行时解析仓库唯一 corpus，并把其 SHA-256 写入结果。

**只终止原生 launcher。** 否决，因为 Gradle 会在该进程下启动 single-use daemon 与 JavaExec driver；direct child 退出仍可能遗留原生工作。测试取消与 teardown 会对附属后代请求树级终止，平台回归则验证普通 child-to-grandchild 情形。

## 后果

原生变更现在承担更重的平台检查：Apple 与 Android 车道除编译自身源码外，还必须安装 Host 依赖并保留机器可读 artifact。该测试保持无密钥且确定性，loopback control listener 在临时运行之外不可用，且 dirty source input 不能产生 `PASS`。[carrier 多设备 slice](2026-08-30-carrier-session-slice-e2e.zh.md)仍是双 controller settlement 的互补证据，而[离线恢复验收](2026-09-03-native-link-offline-recovery-acceptance.zh.md)则以 streaming loss 与权威 projection 检查扩展同一 corpus；每次 native execution 仍只证明一个客户端。
