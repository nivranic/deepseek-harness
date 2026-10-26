# Agent Note: 一次真实的替换安装升级端到端验收已删 preset 路径

Status: implemented

[English](2026-10-26-ota-upgrade-path.md) | 中文

## 问题

gen-71 的陈旧 preset 收口用直写 store 的方式验收 connected 用例——真 Keystore 密码件，但残留并非任何用户流程产生的。其 Open follow-ups 点名了仍未验收的部分：「一条真实的空中升级路径——旧 APK 的已存配置遇见新 APK 的已删 preset」。升级机制（经真实配置面做出的选择、平台在替换安装中保留应用数据与 Keystore 条目、升级后 APK 的目录确实删掉了已存 id）此前不在任何车道之内。

## 决策

以两相位车道在夹具 APK 对上验收真实路径。冻结的 lite preset 投影（`packages/preset/agent-presets/lite-preset-descriptors.json`）只携带一个出厂 preset（`minimal`），历史上没有可重放的删项，因此旧 APK 是同一棵树的夹具构建：投影中加入一个探针条目（`vanished-preset`，即 gen-71 注入用的 id）——其余输入完全一致。`LiteUpgradeSeedNativeTest`（`dshUpgradeLane=seed`）不安装也不注入任何东西：打开真实配置面，经 preset 选择器做出显式探针选择——绝不落在空选择解析出的默认值上——保存，留下以 Keystore 密封、名字为探针 id 的 store，随后回读 store 钉住这一持久事实。车道随后替换安装当前 APK（`adb install -r`——数据与 Keystore 条目保留；投影文件先还原为已提交字节，因此升级后 APK 的目录确实删掉了探针）。`LiteUpgradeVerifyNativeTest`（`dshUpgradeLane=verify`）把幸存残留钉在已删 preset 契约上：前置条件是经真实 store 回读到的 seed 相位已存配置——不是本进程写入的——然后陈旧行渲染并点名已存 id 与仍携带的 `minimal`，失败身份上不组装任何会话面，面内重新配置经重选现存 preset 恢复，store 愈合为 `minimal` 并重新组装。两个类在车道参数缺席时干净跳过，常规 connected 车道永不运行它们。

## 备选方案（已否决）

版本号递增的 APK 对被否决——保留 `/data/data` 与 AndroidKeyStore 条目的替换安装正是被验收的升级机制，而版本号差在「已存配置遇见已删 preset」这一接缝上不产生任何可观测差异。重放历史被删 preset 被否决——投影的全部历史只有一次提交、仅携带 `minimal`；不存在真实删项，且跨提交的对会把无关代码差异拖进接缝，而夹具对把差异隔离在投影文档本身。继续扩展注入式 connected 用例被否决——那条路已验收；缺的恰是真实上游（面内做出的选择、由平台携带），这不是单次 instrumentation 运行能跨两个 APK 表达的。

## 后果

升级路径验收成为可重复的车道而非口头声明：夹具上 seed、替换安装当前版、验收幸存残留——每相位是一次带门控的 instrumentation 运行，车道记录两枚 APK 摘要。常规 connected 车道多了两个永久跳过的类，这是诚实的无车道形态。本验收覆盖的是删项接缝——一个被删 id、一份已存配置、模拟器上一次替换安装；不覆盖物理投递通道（商店推送、分阶段 rollout）或台架行——它们留在外部验收台账——且夹具旧 APK 是车道构建，绝不成为已提交状态。
