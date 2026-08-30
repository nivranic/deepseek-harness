# Agent Note: 签名私钥的 AndroidKeyStore 封存

Status: implemented

[English](2026-08-31-android-keystore-seal.md) | 中文

## 问题

端点持久化让签名私钥变得可持久——却是以纯 base64 躺在应用 files 目录的 JSON 文件里。已 root 的设备或文件备份能直接从磁盘读走密钥；它签署的身份只有文件系统那么安全。

## 决策

core 新增 `CredentialsCipher` 缝——对密钥字节的 `seal`/`open`——`FileLinkCredentialsStore` 接受一个实现：保存时把封存形式写进密钥 base64 原先所在的位置，加载时再解回。应用注入 `AndroidKeystoreCipher`：一把由 AndroidKeyStore 生成且永不导出的 AES/GCM 密钥，每次保存以全新 12 字节 IV 封存、IV 前置拼在密文前。纯等值加密器让预览与只看形状的测试保持原样。core 里的边界测试用可透视的 XOR 假实现：断言磁盘字节永不含明文密钥、加载返回可用身份——磁盘侧保证无需任何设备即可测试。

## 后果

车道全绿：边界测试与应用的 `assembleDebug`（把 keystore 加密器编进 APK）并肩通过。Keystore 持有的密钥随卸载与封存文件一同消失，不留残迹；密钥轮换留作未来的存储迁移。一个测试教训：验证往返并不需要曲线点——伪造的裸公钥在任何断言之前就会在 Ed25519 点解码上失败。

## 考虑过的替代方案

加密整个凭据文件被否决——只有密钥是秘密，其余是备份可以合理看到的操作性数据。EncryptedSharedPreferences 被否决——为一个字段引入第二套持久化栈，而缝让 core 保持 JVM 可测。
