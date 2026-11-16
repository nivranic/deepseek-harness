# Agent Note: 陈旧存储 preset id 渲染为装配失败行，而非崩溃

Status: implemented

[English](2026-10-22-preset-stale.md) | 中文

## 问题

§33 预设面收口时，`resolve` 保持 fail-loud，配置表单把陈旧选择挡在保存之外——表单注释点名了剩余缺口：「a stale id gates save off until a valid option is picked, without its own error line」。装配侧则什么都没有：`LiteChatFace` 在身份键控的 `remember` 里裸跑 `LiteSessionAssembler.assemble`，于是 APK 升级后变陈旧的存储 `presetId`——重捆绑的预设 projection 不再携带密封配置点名的 id——使 `resolve` 在组合期抛错，直接崩掉 Lite 面。配置读取失败已有自己的失败行；装配失败是这张面唯一撑不住的失败。

## 决策

兜住装配、渲染失败、保持 fail-loud。`LiteChatFace` 在同一个身份键控 `remember` 内以 `runCatching` 包住 `assemble`；抛错时该面渲染 `lite-preset-stale` 错误行，携带新 locale 键 `lite_preset_stale` 并以异常文本作格式参数——resolve 的信息（陈旧 id、目录来源、携带的全 id）逐字直达用户——且不渲染来源行或会话面。上方的重配置入口（`lite-config-edit`，已配置面既有按钮）即自愈路径：保存有效预设递增 revision、重读存储、按同一装配身份重跑。其余零移动——`resolve` 照旧抛错绝不猜、身份键族不变，无存储预览面（其 null preset id 不会变陈旧）为剩余的资产失败路径免费继承同一兜底。唯一字符串入 `native_companion.xml`（应用唯一 locale 文件）；双语覆盖由本 note 对承担。

## 备选方案

陈旧 id 静默回退默认 preset 被拒——§33 的禁猜边界正是 `resolve` 的要点；本代把崩溃转为可读失败行，不是转为用户从未选择的静默替换。吞错改渲未配置空态被拒——装配失败会被读成「从未配置」，恰是配置读取失败行早已拒绝的混淆。静默装配 BARE——丢掉 persona 跑裸 prompt——被拒——携带 projection 的 APK 悄悄发送裸 prompt 是无人选择的请求面变更。猜最近 id（最接近的 order、或字典序最低）被拒——静默套上错误 persona 比点名陈旧 id 与目录所携 id 的诚实失败更糟。

## 后果

升级跨越被移除预设的已配置设备落在一条可读行上——点名陈旧 id、点名所携 id、自愈入口可达——而非一次崩面的抛错。`LiteEntryNativeTest` 增至八测，新增陈旧配置用例：以真实 Keystore cipher 写入 `presetId = "vanished-preset"`，断言失败行渲染且同时点名陈旧 id 与捆绑的 `minimal`、edit-config 入口保持可见、失败身份上不装配任何会话面。八测在 emulator-5554 全绿。core JVM 测试维持 85 套件 608 测、contract 维持 4 套件 37 测（纯 app 源集改动）；debug APK 基线随生产 UI 变更漂移。

## 开放跟进

connected 用例以直写存储注入陈旧残留；真实的空中升级路径——旧 APK 的存储配置遇到新 APK 被移除的预设——仍属未验证的 e2e 领域。runtimeMode 披露文本仍是硬编码字面量（gen-70 开放项）。
