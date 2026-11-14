# Agent Note: Apple 契约采纳第 28 节原生 Host 名册词汇

Status: implemented

[English](2026-09-30-apple-roster-contract.md) | 中文

## Problem

第 28 节剩余工作清单载有「Swift 采用」——Swift 契约包此前只镜像了 Remote 失败词汇，Apple 客户端对 Android core 已拥有的持久化原生 Host 名册（整文档选择、严格解码、原子替换）没有任何采纳的读取能力。apple README 也仍写着 84 个 schema 已知码，而自检断言的是 92。

## Decision

- `NativeHostRoster.swift` 采纳名册的 JSON 词汇与 `FileNativeHostStore` 的全部解码不变量：根对象与每行的精确字段集、非空白字符串、`native-gateway-v1` 传输格式、四个配对角色（viewer/collaborator/controller/owner）、64 位小写十六进制钉定指纹、恰为 32 字节的 base64 签名密钥、规范可达 HTTPS origin（无 userinfo/query/fragment、空或根路径、合法端口、排除 any-address 主机；去尾斜杠）、互异 Host 键、以及必须指向已存身份的 active 键——名册为空时恰为缺席。
- `NativeHostRoster.hostKey` 镜像 `nativeHostKey`：JSON 数组 `[hostId, pinnedFingerprint]` 的 SHA-256 十六进制，键独立于可替换的设备授予。两处平台解析差异显式处理：JSONSerialization 把 JSON 布尔桥接为 NSNumber 且 `NSNumber(true) == 1`，`version` 在整数比较前先拒布尔；Kotlin URI 报 IPv6 any-address 为 `[::]` 而 URLComponents 报 `::`——两种拼法都拒绝。
- 一批夹具是共享的对等证据：`fixtures/native-host-roster/` 含一份规范文档（两个 Host、active 键、尾斜杠 origin、端口）加 14 个拒绝用例（版本、根/行多余字段、空白字符串、角色、指纹大小写、短密钥、传输格式、http endpoint、query endpoint、重复 Host、未知 active、空名册带 active、缺 active 键）。Swift 自检（`main.swift`）解码规范文档并按规则拒绝每个无效用例；`NativeHostCatalogTest` 把完全相同的字节送入 Android `FileNativeHostStore`，两个实现对同一批文档接受与拒绝一致。
- 本地验证：Kotlin 对等测试经 gradle 全绿（`:core:test`，375 测试 0 失败）；Swift 半边只在 macOS CI lane 编译运行（`swift run dsh-contract-check`）——本 Windows 主机无 Swift 工具链，Swift 侧执行只在拿到 CI 证据后才声明，循 swiftCiRecovery 先例。apple README（双语）记录采纳并修正过期的 92 码计数。

## Alternatives considered

- **从 JSON Schema 生成 Swift 模型：** 名册没有 schema 权威（权威是 Android core，与配对模型一致）；手写严格镜像加共享夹具保持单一事实源，不为一种文档类型引入 schema 生成器。
- **用 XCTest 用例替代自检可执行程序：** 本包刻意只带一个可执行目标（托管 macOS runner 非确定性失败 test-target 导入）；名册检查扩展同一普通退出码模式。
- **把夹具复制进 Android 测试树：** 复制夹具会漂移；Kotlin 测试向上走到仓库根发现规范目录，保持单一夹具集。

## Consequences

- §28 的 Swift 采用项有了契约级证据：两个原生实现对相同字节执行同名册词汇与不变量，未来 Apple 外壳可以读取 Android 写出的名册文档。
- 任一实现的接受语义漂移都会破坏自己的车道（Swift 自检在 CI；Kotlin 对等测试本地与 CI）。

## Open work

- Swift 半边在 Windows 主机无法本地执行；其绿色状态依托 macOS CI lane（在该运行完成前依托桌面复查的对等性）。
- 名册写入/重新配对语义（原子替换、preserve-and-start-fresh）仍是 Android core 行为；Swift 镜像作为契约层只读取与校验。
