# Apple 支持扫描器接入

[English](2026-09-10-apple-support-scanner.md) | 中文

## 范围

提供 [Support Bundle 任务 4](2026-09-08-support-bundle.zh.md)所需的 Apple 原生库。库打包、原生绑定执行和应用导出是独立验收步骤。最终要求仍是完整的四平台 Support Bundle。

## 选定实现

使用与 Android 相同的 [Go 扫描器](../../native/support-scanner/README.zh.md)和固定 gomobile 生成器。独立的 Apple 生产者处理 Xcode、静态 framework 及平台验证。复用生成的 Objective-C 接口可保留扫描器的不可变字节与取消等待语义。自定义 C 适配器会增加不必要的 ABI 实现；将规则复制到 Swift 会形成第二套扫描器。

XCFramework 包含 iOS arm64、模拟器 arm64/x86_64 和 macOS arm64/x86_64。[Apple 构建策略](../../native/support-scanner/apple-build.json)固定 Xcode 和部署版本。生产者通过既有且经过核验的本地代理读取已提交模块文件，检查各架构静态归档内的实际 Go object，并保留源码、模块校验和与许可证。Framework 版本链接必须与生成布局完全一致；归档元数据规范化时不得重写原生字节。

[原生验证器](../../scripts/verify-apple-support-scanner.py)比较准确包内容与编译输入，链接 Swift 探针，并在 macOS 和自有 iOS 模拟器上运行。它验证准入字节身份、修改隔离、凭据拒绝及取消完成。两个已链接二进制均执行维护中的 Go 漏洞检查。静态 `BUILT` 回执不能替代执行证据，也不能证明物理设备验收。

## 应用接入

扫描协议和诊断投影应独立于二进制 framework。原生 iOS 和 Mac Companion 壳向既有 SwiftUI 组合提供实际扫描器适配器。完整 Mac Host 继续拥有其 supervisor 导出器。导出在扫描前序列化全部字段，在 UI 线程之外执行扫描与取消等待，并且只通过平台保存操作交付已准入字节。

产品验收必须在原生应用中执行未配对和已配对状态、元数据采集失败、取消、扫描器拒绝及实际保存字节扫描。缺失生产者保持明确声明；库探针成功不能关闭 G2-SUPPORT。应用适配器与保存流程在库验证后接入，不改变 Host 权威，也不引入另一 Session domain。

## 验证顺序

1. 在 Windows 和 Linux 执行结构及构建器拒绝夹具，包括受共享元数据检查影响的既有 Android 打包测试。
2. 在固定的 macOS/Xcode 配置下运行已提交生产者，保留全部五个架构绑定、模块清单和包摘要。
3. 针对这些准确 framework 字节执行 Swift 探针，扫描两个已链接二进制，并核验自有模拟器已删除。
4. 接入原生应用适配器和导出 UI，再验证实际保存文档及拒绝路径。
5. 将应用、库、源码和导出证据绑定到同一候选后，再评估完整 Support Bundle 要求。
