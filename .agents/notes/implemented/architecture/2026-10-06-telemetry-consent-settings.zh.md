# Agent Note: 遥测同意接入运行时设置层并交付五类独立开关

Status: implemented

[English](2026-10-06-telemetry-consent-settings.md) | 中文

## Problem

规格第 44 节要求遥测 UI 不得以单一"Telemetry"总开关隐藏数据类型，且要区分五类数据（session telemetry / provider metadata / relay metadata / Device Trust metadata / crash diagnostics）。此前的逐类同意只存在于组合层：`dsh-session-telemetry-otel` 的 `Config.consent` 五布尔（缺省全关）在插件构造时一次性解析，没有用户层，也没有任何 UI——client 包全库零 telemetry 面。

## Decision

三件交付：

1. **settings namespace `telemetry-consent`**，注册方是 `dsh-session-telemetry-otel` 的后端（今日唯一部署入口与唯一同意消费者）。schema 为五布尔 `default(false)`、无 master 键；词汇（`TELEMETRY_DATA_KINDS` 元组与 `TELEMETRY_CONSENT_NAMESPACE`）从 `dsh-session-telemetry` 单一真值源导出，schema 由注册方用 kind 元组构造，避免服务定义包引入 schemastery 依赖。注册时 `base` 携带组合层 `Config.consent` 种子，`applies: 'restart'` 如实声明——SDK 管线构造时门控保持不迁移（运行时重建 `BatchLogRecordProcessor` 的 shutdown/drain 交互未文档化，与 flush() 不实现的既有裁定同一理由族），UI 变更下次启动生效。
2. **构造时解析序 user > base > schema 默认**（settings 接缝原生层序），`scope.get()` 再过 `resolveTelemetryConsent` 收口（fail-closed：缺类即关）。settings 服务未组合时惰性回退组合层（照 gateway `ctx.get('deviceTrust')` lazy-resolve 先例——服务缺席是合法组合不是配置错误）。`DISABLED` 模式不注册 namespace：禁用后端没有活跃同意面，UI 按缺席不渲染。
3. **新包 `dsh-client-ui-settings-telemetry`**：五个独立 `Switch`（`TELEMETRY_CONSENT_KINDS` 以 `satisfies readonly TelemetryDataKind[]` 钉住联合）、任何位置无总开关（测试断言渲染树恰五个开关）；namespace 缺席渲染 null（§13 能力在场才显示 UI）；写入经 scope 的最新版本围栏与串行化排队（不显式传 `expectedRevision`——钉渲染时版本会把两次快速拨动变成虚假冲突；冲突以宿主重读值与行内 `role="alert"` 如实呈现）；只读文档时全部禁用并附锁文案；restart 生效提示与五类描述文案全部 locale-owned 双语。web-app bundle 的插件行与依赖已登记。

## Alternatives considered

- **运行时门控迁移**（每次捕获读 consent，或同意变化时重建 SDK 管线）：拒绝——重建管线与 shutdown drain 的并发交互未文档化，`applies: 'restart'` 是 settings 接缝为这类 owner 预备的字段，如实声明胜过冒险迁移。
- **consent schema 放服务定义包**：拒绝——会把 schemastery 运行时依赖引进 `dsh-session-telemetry`；导出 kind 元组由注册方构造，耦合最小且词汇仍单一真值源。
- **UI 显式 expectedRevision CAS**：拒绝——scope 写路径已以最新镜像版本作围栏并串行化；显式版本号引入虚假冲突。
- **总开关+子项折叠**：规格第 44 节明文禁止。

## Consequences

用户可经设置文档逐类开关遥测（文档热重载、下次启动生效）；组合层种子语义不变（`DSH_TELEMETRY_CONSENT=1` 仍作为 base 层种子）；settings 未组合的部署行为与此前一致；四个非 session 类的遥测出口仍随生产者待落地——crash 的本地记录源已在、出口待接线；relayMetadata 阻塞于 §23 宿主 relay 服务；provider 的 attribution headers 是否计入遥测的语义裁定留给其出口代际。

## Open follow-ups

- crashDiagnostics 出口：本地记录器 → OTel 记录 + `telemetryKindAllowed('crashDiagnostics')` 门控。
- providerMetadata 出口与 attribution headers 语义裁定。
- deviceTrustMetadata 出口。
- relayMetadata 出口（阻塞于 §23）。
- §56 构建修订号注入接线。
