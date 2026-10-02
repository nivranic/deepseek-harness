# Agent Note：Apple 契约采纳查看位置 handoff 词汇（§26）

Status: implemented

[English](2026-10-02-apple-view-location.md) | 中文

## 问题

§26 第一阶段 handoff（转移查看位置、绝不转移运行时）以 `dsh-session-view.v1` 载荷交付——Web Client 与 Android core 之间逐字节镜像——但 Apple 侧没有编解码器，Swift 客户端既读不出也写不出 handoff 载荷。§26 traceability 行把 Swift 列为开放项之一。

## 决策

- Apple 镜像 `NativeViewLocations.swift`（apps/apple/contract）采纳 Android core `NativeViewLocations`（其本身是 Web Client `encodeSessionViewLocation`/`decodeSessionViewLocation` 的镜像）的精确语法：encode 以顺序 ASCII JSON `{"hostId":…,"sessionId":…,"anchorSeq":…}` 写出单个 `dsh-session-view.v1.` 前缀 base64url 文档（手工构建 JSON 字符串保留字典无法保证的字段顺序；ASCII 范围内仅 `"` 与 `\` 需转义）；decode 在每个解析边界 fail-loud——未知语法前缀、非 base64url 字符、不可解码 base64、非法 JSON、字段集不恰为三键、非字符串或空 id、以及负数/小数/布尔/`-0`/超安全整数锚点——且绝不静默强制转换。
- 布尔锚点陷阱由 CF 类型标识守卫（`CFGetTypeID != CFBooleanGetTypeID`）：macOS 上 NSNumber 把 `true as? Double` 桥接为 `1.0`，纯数值转型会放行 Kotlin/Web 编解码器拒绝的布尔值。`-0` 经符号与零值判断拒绝，对齐 Kotlin 的原始位检查。
- 共享夹具 `apps/apple/contract/fixtures/native-view-location/`（一份规范往返钉死精确编码字节、三个边界用例——零锚点、携带转义引号字符的 id、最大安全整数——与六个无效类；两列同钉 1/3/6 计数）经 Kotlin 侧 `NativeViewLocationFixtureTest`（以 Companion 的 4096 字符调用方上限驱动真实 `NativeViewLocations.encode`/`decode`）与 `main.swift` 自检段双向消费，两个编解码器对相同文档读写相同载荷字节。
- 调用方尺寸限制与 `dsh-companion://` 深链接包装仍归客户端所有；本契约列只钉共享 v1 语法。

## 备选方案

- **镜像深链接包装：** `dsh-companion://session-view/` URI 是 Android 外壳的通道，不是跨客户端语法；Web Client 无对应物。v1 载荷才是共享面。
- **基于字典的 JSON 编码：** `JSONSerialization` 顺序未定义且 `.sortedKeys` 按字母序——两者都会产出与 Kotlin/TS 插入序编码器不同的字节。手工按字段序构建是钉死字节在各平台一致的唯一途径。
- **纯 Double 转型接受数值锚点：** macOS NSNumber 桥接会放行布尔值；CF 类型标识守卫是文档化的可靠测试（apple-roster-swift 先例）。

## 后果

- Swift 客户端可与 Web Client 和 Android core 按位兼容地读写 handoff 载荷；漂移会让共享钉死字节失败。
- §26 traceability 行的 Swift 项以契约级收口；物理设备、平台分享路由及 §26 其余验收仍开放。

## 开放工作

- 消费该载荷的 Apple 外壳（在锚点打开 Session）仍开放；本列只落编解码器。
- §25 的 Swift 项（follow 续传采纳）仍是独立开放项，物理设备资格验证与跨设备真实 QR/链接投放通道亦然。
