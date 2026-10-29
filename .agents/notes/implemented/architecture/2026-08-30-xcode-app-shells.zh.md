# Agent Note: 薄 Xcode 应用壳

Status: implemented

[English](2026-08-30-xcode-app-shells.md) | 中文

## 问题

第 49 章的 target 结构点名了 iOS 与 macOS Companion 应用宿主，但包里只有库——没有可启动的东西，也没有 target 图证明 CompanionUI 能以应用而非测试束的方式链接。

## 决策

`apps/apple/project.yml` 以 XcodeGen 声明两个应用 target：DSH Companion（iOS，`TARGETED_DEVICE_FAMILY 1,2` 覆盖 iPhone+iPad）与 DSH Companion（macOS 伴侣），各是 `@main` SwiftUI `App`，全部主体就是 `WindowGroup { CompanionRootView(client: nil) }`——壳不拥有任何东西；未配对时的配对流程与六标签面都在 CompanionUI。生成的 `Companion.xcodeproj` 是 CI 本地产物（gitignore；车道每次运行重新生成），评审中不漂移任何生成物。Apple Swift 车道在 `swift test` 之后新增三步：生成工程、按 iOS 模拟器 destination 构建 iOS scheme、按 Mac destination 构建 macOS scheme。

## 后果

两个壳在车道上对测试所用的同一本地包构建全绿——产品面在两个平台首次成为可编译的应用，任何破坏应用链接的 CompanionUI 变更都会被 CI 拦下。车道首跑抓到一个跨 SDK 事实：`SecCertificateCopyKey` 在 iOS SDK（Xcode 26）同样返回裸 `SecKey`，平台拆分收敛回单次调用。macOS 直连宿主 target（第 49 章第四个 target）与更丰富的查看器保持开放；重启动仍需重新配对，因为端点未持久化（既有的单宿主限制）。

## 考虑过的替代方案

提交生成的 xcodeproj 被否决——需要新鲜度门禁，且相对 project.yml 零信息量的 pbxproj 噪声进评审。SwiftPM executable target 被否决——iOS 应用交付需要真正的 app bundle，且方案点名 Xcode 宿主。
