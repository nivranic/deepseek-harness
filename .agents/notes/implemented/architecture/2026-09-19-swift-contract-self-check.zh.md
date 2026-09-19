# Agent Note: Swift 契约列以自检可执行目标运行

Status: implemented

[English](2026-09-19-swift-contract-self-check.md) | 中文

## 问题

Swift 契约包用 XCTest 包承载镜像证据（`DSHContractTests` 以 `@testable import DSHContract` 导入库模块），而 macOS CI lane 无法构建它：二十次调度运行中，测试模块在导入库模块时死亡且没有可用诊断（"no such module 'DSHContract'"，或经合成 module.modulemap 缺失 `DSHContract-Swift.h`）。

## 当前上游边界

已封存 apple-contract 记录中的证据声明要求该 lane 真正运行：镜像与生成投影等值、已分类码被 schema 声明、未分类码解析为 `unknown`、不透明未知分支排除全部 84 个已知码。无法构建的 lane 不产生任何证据。

## 决策

用单一可执行目标 `dsh-contract-check` 取代 XCTest 包：枚举镜像保留在 `Sources/DSHContract`，`main.swift` 以普通退出码断言同样四项检查，夹具移至 `contract/fixtures/`（由 `scripts/gen-remote-failure-classes-json.mjs` 在此刷新）。CI 作业在 `macos-15` runner 上运行 `swift run dsh-contract-check`。二十轮探针把失败定界到托管 runner 的测试包路径而非源码：独立模块发射与 ObjC 头发射均在亚秒内通过，带测试目标的最小全新包在 macos-14 两套工具链与串行构建下复现导入失败，且 macos-14 镜像本身已排定弃用。可执行目标没有 XCTest 包、没有 `@testable`、没有跨模块导入，病理路径不复存在。

## 备选方案

把 `DEVELOPER_DIR` 钉到 Xcode 16.2 混合了工具链（5.10 driver 规划旧模块布局而 6.0.3 编译器写入 `Modules/`），已被 16.2 二进制路径取代。串行 `swift test -j 1` 未改变失败。库先行的两步构建关闭了发射竞态但随后链接测试可执行文件时缺失库对象。保留 XCTest 并钉外部 macOS runner 被否决——为无产品价值引入新基础设施。

## 契约

在 `apps/apple/contract` 下 `swift run dsh-contract-check` 打印四行 PASS 后退出 0；否则在 stderr 打印 `FAIL <detail>` 行并退出 1。`node scripts/gen-remote-failure-classes-json.mjs` 从构建后的协议包刷新 `contract/fixtures/`；已提交产物的漂移使检查失败。

## 持久化

无；该包是构建期证据工件，没有运行时状态。

## 安全

无新输入、网络路径或特权操作；可执行程序只从自身包目录读取两个夹具 JSON 文件。

## 兼容性

包名与 `RemoteFailureClass`/`RemoteFailureClasses` API 不变；仅目标种类（可执行）与夹具位置变化。Kotlin 列不受影响。

## 失败处理

FAIL 行命名被违反的不变量，检查非零退出使 CI 作业失败。夹具缺失或过期导致解码失败，经顶层错误非零退出。

## 测试

CI run 35450241173，job 105916046840（macos-15-arm64，Swift 6.1.2）：四行 PASS，作业结论 success，日志存档于 `.artifacts/swift-ci-recovery-lane.log`。该 lane 在重构前连续十七次调度失败。

## 推行

仅源码树与工作流；lane 从 `swift test` 改为 macos-15 上的 `swift run dsh-contract-check`。

## 回滚

从 apple-contract 记录归档恢复 XCTest 目标与 `Tests/DSHContractTests`，并把 CI 作业回退为 `swift test`。

## 后果

Swift 列的证据是确定性的退出码检查而非 XCTest 包，lane 在 macos-15 全绿。镜像不再是可导入的库模块；未来的 Swift 外壳消费生成 JSON 投影或在自身模块内重建镜像。
