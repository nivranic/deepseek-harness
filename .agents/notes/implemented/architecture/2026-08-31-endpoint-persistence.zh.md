# Agent Note: 端点随身份一并持久化

Status: implemented

[English](2026-08-31-endpoint-persistence.md) | 中文

## 问题

配对持久化了伴侣是谁，却没有持久化宿主在哪：载体端点与 SPKI 指纹只活在配对载荷里，于是即使存在持久身份，每次重启动仍弹出配对屏——两个平台共同的"重启动需重新配对"限制。

## 决策

`LinkCredentials` 在两个平台都增加 `endpoint` 与 `pinnedFingerprint`，`pair` 直接从配对载荷持久化二者。两个客户端都新增 `restore` 工厂——Apple 的 `LinkClient.restore(store:)`、Android 的 `LinkClient.restore(store)`——从持久凭据重建客户端，以存储的指纹钉扎存储的端点。Apple 壳在启动时用 keychain 存储调用 restore；Android 运行时在首次组合前从 core 新增的文件型 `FileLinkCredentialsStore` 恢复（应用传入其 files 目录，配对也写同一存储）。测试覆盖往返、pair 持久化的字段、以及恢复的客户端对本地测试服务器签名完成一次可用的 describe。

## 后果

两个平台重启动都跳过配对、直接落在六标签面——两条车道对该变更全绿。单宿主限制仍然成立（每存储一个身份），吊销在恢复后仍以载体拒绝的形式暴露；多宿主切换保持延后。Android 的文件存储是 files 目录下的纯 JSON——签名密钥的 Keystore 加密随方案后续安排的安全轮到来。

## 考虑过的替代方案

端点存进单独偏好被否决——身份只有连同端点与指纹才可用，一份文档使三者不会漂移分开。重连时经 describe 重取指纹被否决——钉扎必须先于任何信任建立，而 describe 本身就跑在钉扎连接上。
