# Agent Note: 伴生端支持文档收集 Host 运行时健康快照

状态：已实现

[English](2026-10-27-host-runtime-health.md) | 中文

## 问题

Android 伴生端的支持导出把 `"runtime-health"` 永久列在 `uncollected` 数组里——该字符串与 `"updates"` 一起硬编码，文档因此从不携带任何 Host §41 健康或就绪事实，无论是否已配对。Kotlin 侧完全没有 Host-health 投影（全仓检索确认为零引用），也没有任何共享诊断词汇过线：Host 早已提供 `hostDiagnostics/health`（六组件加派生的就绪判定）并通告 `host.diagnostics.v1`，但伴生端既不识别该能力也不调用该端点。§41-44 族句还携带一个陈旧半句：分类型默认关闭 telemetry 早已是出厂基线（四类 consent 全 `default(false)`），族句却仍将其列为待完成。

## 决策

支持文档现在在活连接可用时逐字嵌入 Host 的 §41 快照。`HostRuntimeHealth.kt` 精确建模词汇（`HostHealthState` up/degraded/down、六个 `HostHealthComponent` 值、`ready`）并经 `WireValue.toJsonElement()` 严格解析：全部组件与就绪判定必须在场且词汇精确——任何偏差即抛出，fetch 侧归 null，健康快照绝不携带猜测的组件。`WireDriving` 上的 `fetchHostRuntimeHealth()` 以空参调用 `hostDiagnostics/health`，外套两秒 `withTimeoutOrNull`；`CancellationException` 重抛（调用方取消传播进取数动作既有的 CANCELLED 分支），其余一切失败——未配对线路、未通告能力（`host/capability-unavailable`）、超时、偏离形状——一律归 null。`SupportLocalSnapshot` 新增可空 `runtimeHealth` 字段；编码器在 wire 平面与 `connections` 之间发 `runtimeHealth` 段（producer `hostDiagnostics/health`、observation `fetch-time`、六组件加 `ready`）；快照为 null 时 `uncollected` 保持 `runtime-health` 在 `updates` 之前——三份既有资源 fixture 的 null 形字节不变。`NativeObservedCapability` 枚举新增 `HOST_DIAGNOSTICS("host.diagnostics.v1")`，`forEndpoint` 只映射 `hostDiagnostics/health`（伴生端不消费 describe/supportBundle 任一操作），协商因此自动通告它，网关的已通告操作门在派发前拒绝未通告的 Host。`SupportExportAction` 把取数器作为必选参数（无默认——未来挂载点无法静默漏接线），每次导出尝试在 `Dispatchers.IO` 上运行一次；`MainActivity` 两处挂载都传 `CompanionRuntime.wire`。

## 备选方案

经 `WireShape` 式宽松解析（缺席字段读 null）被否决——健康快照正是缺组件不可粉饰之处；严格解析保持整份答案诚实。在 `CompanionViewModel.supportSnapshot()` 内取数被否决——该函数按设计同步且零 I/O，取数动作的点击时补捕前例（`nativeExits`）本就拥有异步补集。默认空操作取数器参数被否决——挂载边界上的显式优于隐式，比静默的 uncollected 回归便宜。把 `describe` 与 `supportBundle` 端点映入 `forEndpoint` 被否决——伴生端一个也不调用，未映射端点无法被陈旧回调索要。

## 后果

已配对伴生端的支持文档现在携带 Host 自己的 §41 词汇——六组件状态加就绪判定，全部使用 Host 的措辞，旁边仍有 `uncollected` 列表在未收集到时点名 `runtime-health`。两个枚举驱动的联动随能力成员一起落地，均在模拟器车道验证：诊断投影的固定客户端白名单多发一个 `supported` 键（`"host.diagnostics.v1":false`——`support-native-gateway.json` fixture 按诚实的 28 字节增量更新，另两份 fixture 未动），能力对话框的穷举 `when` 补上分支并配 locale 所属标签 `Host 运行时健康`。JVM 测试套覆盖解析接受/拒绝、fetch 成功、拒绝形状、虚拟时间超时、取消传播、端点/实参钉住与 `forEndpoint` 映射；支持导出套钉住收集态投影、null 形与 `uncollected` 顺序。connected 轮的八个失败沿 gen-78 分类法精确分解（五个通知权限方法隔离跑绿、两个盖戳依赖测试归验收 APK 车道照该分类法、一个回环套接字网络测试因环境漂移挂而与本代差异零交集——记录而非隐藏）。过程事实随代码记档：一次误跑的全设备 `connectedDebugAndroidTest` 曾短暂把 debug 与 androidTest APK 装到在线的实体设备上，Gradle 轮后的自动卸载随即移除（只读 `pm` 探针确认零残留）；设备车道此后一律钉 `ANDROID_SERIAL=emulator-5554`（或直接 `am instrument -s`），规则——未经用户明确要求不在任何实体设备安装 APK——已写入交接红线。
