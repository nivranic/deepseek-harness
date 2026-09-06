# 应用发布标识

[English](product-release-identity.md) | 中文

## Summary

应用打包从[根 manifest](../../package.json) 读取唯一 SemVer，从[发布元数据](../../release/product.json) 读取构建号和渠道。生成的平台输入保留同一标识，不改变 Link protocol、contract 或 Session format 版本。本参考只说明标识验证；签名、分发和发布晋级需要各自产物证据。

## Table of Contents

- [版本所有权](#version-ownership)
- [分发渠道](#distribution-channels)
- [生成与验证](#generation-and-validation)
- [平台消费者](#platform-consumers)
- [Dev Note](#dev-note)

-----

<a id="version-ownership"></a>
## 版本所有权

根 `package.json.version` 拥有应用 SemVer。`release/product.json` 仅接受 `schemaVersion: 1`、`buildNumber` 和 `channel`。构建号是显式记录的 1 到 65535 整数。新的分发候选必须相对上一已分发构建递增，包括跨版本和渠道；重试同一产物时保留标识。递增比较由候选分发负责，解析器验证单份标识。

发布序列接受不含 build metadata 的规范 SemVer。数字版本分量必须适配 Windows 无符号 16 位文件版本字段。生成的 marketing version 去掉预发布后缀，完整 SemVer 仍保留在内嵌元数据中。源码 SHA 与产物摘要属于候选 manifest（元数据清单），避免在已提交生成文件中形成自引用。

-----

<a id="distribution-channels"></a>
## 分发渠道

| 渠道 | 接受的应用版本 | 分发含义 |
|---|---|---|
| `dev` | 任意受支持版本 | 开发产物 |
| `canary` | 必须为预发布 | 显式选择的预发布受众 |
| `beta` | 预发布标识以 `beta` 或 `rc` 开始 | Beta 候选 |
| `stable` | 不含预发布 | 稳定版候选 |

渠道元数据不授予发布权限、不启用 capability，也不选择 runtime composition。上传和晋级控制仍由发布 workflow 负责。

-----

<a id="generation-and-validation"></a>
## 生成与验证

编辑版本或发布元数据后，在仓库根目录运行：

```sh
pnpm run gen-product-identity
pnpm run verify-product-identity
```

生成器写入[公共 JSON](../../release/product.generated.json)、[Android properties](../../apps/android/product-version.properties) 和 [Apple xcconfig](../../apps/apple/Config/Product.xcconfig)。重复生成的字节相同。验证器报告过期或缺失文件，不进行修复，并接入 static 和 hygiene 检查。畸形元数据、未知字段、无效版本及不匹配的渠道/版本组合均在生成前失败。

dsh 发布规划器在写入 manifest 前验证目标版本与发布元数据，并将生成的原生输入纳入正常版本提交。vendor 版本规划继续独立。`release:dsh --dry-run` 输出计划，不修改 manifest、生成文件或 Git 历史；它不分发产物，也不证明发布已经就绪。

-----

<a id="platform-consumers"></a>
## 平台消费者

| 消费者 | 版本表示 | 内嵌渠道 |
|---|---|---|
| Android | 完整 SemVer `versionName`；整数 `versionCode` | `ai.deepseek.dsh.distributionChannel` |
| Apple 应用 | 数字 `MARKETING_VERSION`；三段 `CURRENT_PROJECT_VERSION` | `DSHDistributionChannel` |
| Windows 候选 | 完整 SemVer 包版本与 PE 产品版本；四段数字文件/产品版本 | staging 包的 `dshProduct.channel` |

Apple 构建号单调映射为 `1 + floor(n / 10000)`、`floor(n / 100) % 100` 和 `n % 100`；Windows 使用 `<major>.<minor>.<patch>.<n>`。因此构建号 12345 对应 Apple `2.23.45`。Apple 元数据还保留 `DSHProductVersion` 和 `DSHBuildNumber`。

Android 在 Gradle 配置期间消费生成的 properties。三个 Apple 应用 scheme 均消费生成的 xcconfig；[Apple workflow](../../.github/workflows/apple-swift.yml) 通过[产物验证器](../../scripts/verify-apple-product.ts) 比较解析后的 Debug 设置和已构建 Info.plist 字段。Windows staging 拒绝过期生成输入，以及与根版本不同的 staging 包版本。[Windows 候选生产者](../../scripts/desktop-packaging.ts) 在 `afterPack` 中改写主程序的每份 PE 版本资源，然后才由 NSIS 和 portable 目标收集可执行文件。数字文件/产品版本包含构建号；本地化的 `ProductVersion` 字符串保留完整 SemVer。畸形、已签名或缺少版本资源的输入均失败。该生产者禁用发布和证书签名。签名包、安装器行为和 Release archive 需要独立平台验证。

-----

<a id="dev-note"></a>
## Dev Note

[应用标识决策](../../.agents/notes/implemented/process/2026-09-05-product-release-identity.zh.md) 说明版本所有权与平台限制。[npm 发布序列](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.zh.md) 继续拥有包发布职责。
