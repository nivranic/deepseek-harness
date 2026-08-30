# Agent Note: macOS Swift 车道

Status: implemented

[English](2026-08-30-macos-swift-lane.md) | 中文

## 问题

迄今所有 Apple 产物——三个库、它们的测试、契约镜像——都是"已编写未编译"交付的：fixture 漂移在 TypeScript 侧有门禁，但没有任何东西证明 Swift 能编译、测试能通过。第 62 章的一致性承诺（TypeScript 与 Swift 同 fixture 同领域状态）没有可执行的 Swift 半边，而两个延后的用户决策（macOS 轨道时机、中继优先级）恰恰卡在这条车道存在与否上。

## 决策

用户已按推荐落定两个决策点：macOS 车道立即启动；中继维持 LAN 优先、延后。`.github/workflows/apple-swift.yml` 在 `macos-latest` 上对每次 `apps/apple` 变更运行 `swift test`（PR、dev 与 master 推送，加手动触发），带路径过滤、包级缓存与仓库的仅-PR 取消策略。包零外部依赖，任务即 checkout 加测试。十轮日志迭代把从未编译过的源码推到全绿：`SecCertificateCopyPublicKey` 的 CFTypeRef 写法从未编译过（现代 `SecCertificateCopyKey` 本就跨平台）、wire 载荷编码器缺 `try`、`LinkWire` 携带两个结构相同的 JSON 枚举使请求与响应值互不可转换（提升为单一 `Codable WireValue`）、`LiteUsage`/`LiteTodo`/`LiteArtifactStatus` 重复声明服从、`Streaming` 需要可变性与公开 init、工具栏摆位与 `ButtonRole` 成员是 iOS 专属、fixture 往返比较了非 Equatable 的 `Any` 字典（改为排序键字节）、子代理目录的诊断臂缺 `activity`/`hasChildren`/`mode`——契约行改为可选，`SubagentRow.mode` 随之可选。

车道的首个运行期批次暴露了类型系统拦不住的真实缺陷：`WireShape.object` 会返回非对象字段（交互转发从事件名字符串里读载荷）、收件箱去重比较整卡而非事件 id、fake follow 流立即结束使每个视图模型在断言中途重订并重放桩（真实 follow 流只在失联时结束；fake 现在保持打开直到取消）、文件范围按字素簇计数而所有范围说的都是 UTF-16 单位。

## 后果

全部 55 个 Swift 测试在 macOS 上编译并通过——第 62 章的 TS/Swift 一致性首次双侧机器验证，此后每次 `apps/apple` 变更都自带证明。此前每篇 Note 里的"已编写未编译"告解就此退役。Xcode 应用壳作为下一增量解锁。CI 迭代方式是推到 dev 后读车道日志（凭本机已存凭据经 API 取任务日志；跳转第二跳到 blob 时必须去掉认证头）。

## 考虑过的替代方案

在 Windows 侧装 Swift 工具链被否决——SwiftPM 加 FoundationNetworking 在 Windows 上本身就是一套支持面，且方案从一开始就点名 macOS runner。在 ci.yml 里加 macOS job 被否决——路径过滤的专用车道让 Apple 变更不进付费 Linux 作业图，且在 dev 推送上触发，而仅-PR 的主 CI 永远看不到 dev。
