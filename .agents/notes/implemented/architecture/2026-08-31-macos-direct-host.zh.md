# Agent Note: macOS 直连宿主 target

Status: implemented

[English](2026-08-31-macos-direct-host.md) | 中文

## 问题

第 49 章点名四个 target；三个已交付（iPhone/iPad 与 Mac 伴侣），而 macOS 直连宿主——宿主侧运行时界面——只存在于限制清单的一行字里，没有 target 图证明宿主代码能与伴侣保持隔离。

## 决策

`project.yml` 新增 `DirectHostMac`，一个 macOS 应用，源码放在 `Hosts/` 下且不属于任何伴侣 target——第 49 章的隔离规则落成结构：宿主专用代码无法泄入 iOS、iPadOS 或 Mac 伴侣，因为它不在它们的源列表里。该 target 不依赖任何包产品；宿主面自成一体。`HostHomeView` 铺出宿主的三个管理关注点——远程访问、配对签发、已配对设备——每张卡都是如实说明内嵌运行时尚未落地的 `HostEmptyState`，遵守方案"Runtime Authority 保持在桌面宿主"的持守立场。车道在伴侣之外构建该 scheme。

## 后果

第 49 章四个 target 全部存在且在车道上构建（55 个测试加三个应用 scheme）。骨架刻意诚实：没有假开关、没有编造的设备行——空状态点名每张卡在等什么。内嵌宿主运行时是方案自身的后续阶段，如今有了等待它的 target。

## 考虑过的替代方案

宿主面复用 CompanionUI 被否决——伴侣面消费宿主，宿主面管理宿主，混用会招来第 49 章禁止的污染。等运行时落地再做 target 被否决——隔离边界在宿主代码还小时证明成本最低。
