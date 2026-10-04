# 新版 Agent 实施状态

状态：IN_PROGRESS。Phase 0、1 / Gate 0 已完成，Phase 2、3、4、5、7、8、10 正在实施。采用新 Upstream-First 规格，在隔离分支继续收敛到官方实现；旧 Gate 的历史 PASS 不迁移为新方案 PASS。[Git 基线](UPSTREAM_BASELINE.md)、[差异审计](UPSTREAM_DELTA.md)和[机器回执](artifacts/upstream-first/evidence.json)共同限定本状态。

| Phase | 工作 | 状态 | 当前结果或下一步 |
|---|---|---|---|
| 0 | Upstream Refresh | PASS | 官方 HEAD 已 fetch，17 个工作树已采集，隔离分支已建立 |
| 1 | Delta Audit | PASS | 已审 129/129 个归属；0 个待审 |
| 2 | Desktop Convergence | IN_PROGRESS | 官方 unsigned Windows 安装包已构建，实际打包应用的设置/主题/托盘/恢复/退出通过；插件安装、安装/更新/系统登录、macOS 与其余迁移待完成 |
| 3 | Contract Stabilization | IN_PROGRESS | checkpoint/Storage、Host 发现、协议 2/1 与主要能力 UI 已验证；Prompt 去重、普通 Session 目标取消及条件重命名已验证；其他变更幂等、其余入口、完整兼容、错误体系及转换待完成 |
| 4 | Interaction Reliability | IN_PROGRESS | 版本、过期、Host 重启、回答丢包、Question 答案竞争、取消/重试交错及页面刷新已验证；后台恢复、权限执行及变更确认语义仍待完成 |
| 5 | Responsive Shared Client | IN_PROGRESS | 配对设置已验证桌面/390px 布局；完整浏览器、方向与真机矩阵待完成 |
| 6 | Diagnostics | NOT_STARTED | health/readiness/support |
| 7 | Device Trust | IN_PROGRESS | 一次性配对、角色、撤销、操作员入口及 Android Keystore 跨进程恢复已验证；其他平台 secure store 与真机采用待完成 |
| 8 | Remote Transport | IN_PROGRESS | 独立 TLS 入口、签名 Gateway 调用及 Android 采用已验证，本地 Web 防线保留；其他原生平台、发现与 Relay 待完成 |
| 9 | Follow/Attach/Handoff/Multi Host | NOT_STARTED | 先实现查看位置转移 |
| 10 | Thin Native Companions | IN_PROGRESS | Android 已验证配对、重启恢复、Question、Session、文件分页及撤销提示；Apple、工件/Handoff、原生诊断和真机验收待完成 |
| 11 | Lite | DEFERRED | 前置能力完成后再准入 |
| 12 | Release/RC | IN_PROGRESS | Windows runtime/wheel 与 unsigned Desktop 先行验证；completeRc=false，安装、签名及跨平台证据缺失 |

## Android 外壳消费 Gateway 失败契约

[历史来源记录](artifacts/upstream-first/gateway-consumption-source.json)把外壳的契约消费接缝落地：LinkWire 不再丢弃其本就校验过的信封 details（单次结果与流失败帧两径保留），LinkClientException.Refused 携带 code、envelopeMessage 与结构化 details 透出；GatewayFailurePresentation 消费共享 RemoteFailureClasses 镜像——已知类别得到唯一的下一步动作与呈现文案，词汇表之外的码保持不透明诊断（code 与 message 原样、details 留存信封）；文件查看器先查分类器再走私有 lite-fold 细化。契约测试 + core 185/185（含 LinkClientTest 信封保留用例），:app:assembleDebug 通过门禁，重建 APK 在本地 AVD 安装启动零崩溃。局限：未驱动真实 Host↔设备拒绝交换（需 Host 配对夹具）；呈现文案为外壳本地中文常量（独立模块，不适用 web/desktop 字典模式）。

## Web 查看位置交接生成端与接收端（第 26 节）

[历史来源记录](artifacts/upstream-first/view-handoff-source.json)补齐 §26 第一阶段 Handoff 的 Web 两端。规格钉准：编解码两端（ClientSessions.encodeViewLocation/openViewLocation）与 Android 消费、Swift 契约镜像此前已交付，但 Web 自身无捕获入口、收到链接的页面不作为——本代交付生成端与接收端。锚点=Chat 时间线最后轮次 turn/start seq（loadThrough 契约原文同源，「复制的正是将被揭示的位置」）；链接=当前页 origin+pathname+#dsh-view=<payload>（URL fragment 从不随请求发给服务器——「只承载查看位置、不承载传输」的最小真实通道）；QR 渲染与真实跨设备投放通道仍属外壳工作。实现：新包 @deepseek-ai/dsh-client-ui-view-handoff（ui-open-in-app 配方，web-app profile 装载）——生成端经 slots 占用 conversation.session.header.actions（order 20）注入「继续到其他设备」动作，仅当已准入 Host（generation 带 descriptor，与 encodeViewLocation 的 requireConnectedHostId 同信号）且存在最后轮次锚点时可见；接收端 apply 时一次性消费 fragment（读后即清、刷新不循环），waitForAdmission 推迟打开使 payload 永不触达错误 Host，失败大声上报不重试，剪贴板拒绝降级 title 呈现链接。ISessions 契约面显式加宽两动词（接口自述 "the explicit act of widening what features may do to the sessions domain"），TestSessions 经真实编解码器实现（单一测试 Host 常量）、FixtureSession.loadThrough fail-loud stub 补 seq 报出；包根入口为空 apply node 半（client 面经 exports["./client"]），装配四线齐备（tsconfig.base.json paths、tsconfig.client.json solution、web-app cordis.patch.yml+依赖、catalog/module-graph/client-catalog 再生成）。车道 packages/client/ui-view-handoff/tests/handoff.client.spec.tsx 五例（隐藏条件、编码锚点+链接复制+copied dress、剪贴板拒绝 title 降级、admitted 派生+buildLink、一次性消费+准入后打开+失败不重试）两连绿；邻域回归 4 套件 41 绿、波及套件 76 绿。门禁多轮收敛如实（types-lint 四轮至 0/0——首版 references 指错 face、ISessions 面加宽波及三个实现者、根入口 re-export 拉运行时依赖入 Host 面等返修清单入 iteration-notes）；test:docs 17、doc-sync 36（config-catalog 双再生成+zh 镜像、Model Experience 登记、README 骨架对齐、pairing 910 对）、审计串行双轮 47 文件/631 断言（46/626+新车道）、gate0 双形态 PASS、traceability 6/6（§26 remaining 改写+candidateEvidence 11→16）。hygiene 14 过/2 继承失败均经 stash 探针钉为 HEAD 基线（file-upload admitEncodedImages 未分类——政策明令须人工审查；vendor rescope 指向封存工件快照旧名——封存证据不可编辑），如实上报开放通道；本包 publint/invariants/dependencies 全净。快照判定：test:snapshot 四文件（corpus/acp/sdk/headless）经 stash 探针定性为 HEAD 基线红（环境漂移与 checkpoint 未收录清单），零本增量暴露面，记录不修改。本代无 Kotlin/Swift 改动，gradle 验收轮（scanner env+-PdshNativeAcceptance）BUILD SUCCESSFUL（89 任务 47 executed，release 管线冷启如实记录），空派生以字节证明：两枚 APK 与前代记录 sha256 逐字节一致、core XML 聚合 77 套件/477 测试全绿。深链接、平台分享路由、QR 渲染、物理设备及本节其他要求仍开放，不授予整节 PASS。完整目标未完成。

## 手机档 header 溢出菜单（第 10 节）

[历史来源记录](artifacts/upstream-first/header-overflow-source.json)交付 §10 手机顶栏线框的 ⋮ 溢出 affordance 并解除其遗留阻塞。规格钉准：§10 线框顶栏 `← Sessions Host ● ⋮` 中的溢出项是本节唯一开放件，phone-top-bar 增量（eba95825a4）留下「其条目取决于尚不存在的工具栏集合，如实不预造」的开放句；本代勘察定论该「工具栏集合」为台账自造指称——81 节规格任何处均未定义 ⋮ 条目——聚合现存 header 两个次要列表（actions=agent-preset/jobs/schedule、utilities=运行位置 chip 之外=open-in-app）是唯一有真实控件清单的读法，设计裁定随 note（2026-10-03-header-overflow 三件套）记录。实现：⋮ 定性为 strict header 自有的手机档布局决策而非新座位——ConversationSessionHeader 经 usePhoneTier()（matchMedia('(max-width: 599.5px)') 订阅、与既有全部手机档 affordance 同档、matchMedia 缺席默认宽档护 node e2e）在「宽档内联原标记（逐字节不变）」与「HeaderOverflowMenu 渲染」间切换，两列表恰一次挂载于唯一容器；位置裁定：运行位置 chip 留栏（§10 强制醒目+线框 Host ● 内联）、corner 单座位占用者不动、触发器居 utilities 行末端与 chip 相邻（正合线框 Host ● ⋮ 画法）；面板沿用 ScheduleCatalogAction 配方（useAnchoredPosition+useDismissOnOutsidePointer+Escape 还焦+createPortal），两表皆空显示本地化空态行；新手写字形 IconOverflowVertical16 入 primitives 图标集（手写产品字形既有惯例）、session.overflow.aria/empty 双语键落地。车道 packages/client/ui-conversation/tests/header-overflow.client.spec.tsx（直挂 ConversationSessionHeader+可控 matchMedia 桩）五例：宽档不变式、手机档聚合（chip 与 corner 留栏、两列表仅存 portal 面板）、Escape 关闭还焦、空态命名、tier 翻转跟随；两连绿，既有 skeleton 33 与 input 套件全绿（宽档默认不变验证）。门禁一次返修如实：首轮 types-lint 3 个 TS 错误（slots 类型名误用再导出别名）+4 个级联 lint unsafe 错（client-locale zh 具名导出名误用），修复后 0/0 一次通过（失败轮输出被复跑覆盖、错误清单入 iteration-notes）；其后审计串行双轮 46 文件/626 断言（45/621+新车道，两轮首跑全绿）、test:docs 17、doc-sync 36（README 双语+note pairing 重录）、gate0 双形态 PASS、traceability 6/6（§10 remaining 溢出句改写+candidateEvidence 2→5）。本代无 Kotlin/Swift 改动，gradle 验收轮（scanner env+-PdshNativeAcceptance）BUILD SUCCESSFUL（70 任务 1 executed），空派生连续第四代：两枚 APK 与 gen-25 记录 sha256 字节一致；prepare 空集派生、write-reports 不新增 replaced 集合。完整尺寸/主题/状态/访问性矩阵与 iOS/Android 真机输入、后台及原生附件验收仍开放，不授予整节 PASS。完整目标未完成。

## Host 切换期观察与 Composer 禁用车道（第 28 节）

[历史来源记录](artifacts/upstream-first/active-host-switch-source.json)钉住 §28 Multi-Host 切换期三连要求（规格 1104-1108 行：必须明确显示 active Host／切 Host 时 Composer 暂时 disabled／禁止 UI 已显示 Host B 请求仍发往 Host A；开工 WIP 与续推指令写作「§26」系节号笔误，按行号锚定 §28 记账）。机制勘察先行定论三重结构性成立：retarget 同步先翻 selectedOrigin（路由权威，业务调用与流载体每次尝试重读）并即刻退休旧代（已发布代蕴含 controller 末态 ready，故 'reconnecting' 发射不会被去重吞掉——dedup 边角不可达）；无代期间网关 $host 返回无 capabilities 壳使 createComposerControlSource prompt:false（InputBar 经 controlAvailable=false 禁用），composer 恢复门禁另以本地化原因阻断非就绪态；「显示 B 发 A」两个方向均被次序排除。本代为证据车道代（§29 outage 先例）：车道 A `packages/client/connection/tests/host-switch.client.spec.ts` 在真实 Connection 插件上以门控双源（A 立即准入、B 停门拉长切换窗）走完 A 就绪→retarget(B)→旧代调用内同步退休→新代在 B 建立整周期，target/generation/state 三观察源全 flush 采样断言不存在「target=B 而 generation=A」与「generation=B 而 target≠B」观测、切换开始后零面向 A 的连接尝试、新代建立后名册当前行与所选 origin 一致（两行各录其源）；车道 B `packages/client/ui-conversation/tests/host-switch.client.spec.ts` 以真 createComposerControlSource 走网关 $host 形态序列（A facts→无能力壳（按 getter 实际成员书写）→B facts）钉 prompt true→false→true、interrupt/fileUpload 跟随当前代事实（B 无 A 独有上传能力）、A 留存快照 current() 失效；单条全链车道因包边界不可行（ui-conversation 不依赖 gateway client service、反向亦然，组合只在应用装配根），拆分如实入 traceability。既有覆盖盘点不重复声称（retarget URL-per-call、selection-observer 次序、$host 恒等、InputBar controlAvailable 公式面均沿用既有）。审计 client 清单 43/618→45/621（新增两车道文件，connection 包首次入清单）。门禁一次返修如实：首轮 types-lint 4 个 TS 错误（ConnectionTargetState 观察源接口误用作快照类型）加 7 处箭头括号风格错，修复后一次通过（失败轮原始输出被复跑覆盖，错误清单入 iteration-notes——hosts-roster-reorder 先例形态）；其后审计串行双轮 45/621 全绿、typecheck/lint 0/0、test:docs 17、doc-sync 36（note 三件套 pairing 重录）、gate0 双形态 PASS、traceability node --test 6/6（§28 remaining 切换车道句+candidateEvidence 22→25）。本代无 Kotlin/Swift/TS 包源码改动，gradle 验收轮（scanner env+-PdshNativeAcceptance）BUILD SUCCESSFUL（70 任务 1 executed），空派生同前两代：两枚 APK 与前代 source 记录 sha256 字节一致（emulator 未运行、无设备车道，字节比对以前代记录为基准）、core XML 聚合 77 套件/477 测试 0 失败；prepare unresolved-scan 派生 allowlist 空集（7510/0）、write-reports 不新增 replaced 集合（既有 13 集合未动）。真机、Swift 外壳、后台/推送及整节其余验收仍开放，不授予整节 PASS。完整目标未完成。

## Android 持久化窗口后台载体断开与前台恢复车道（第 25 节）

[历史来源记录](artifacts/upstream-first/android-follow-foreground-source.json)为 §25 持久化窗口补上前台恢复证据。规格钉准先行：§25 原文只点名网络中断与游标续传，「前台/推送恢复」是台账验收标签；有约束力的规格句为 §80「断网、后台、Host restart 后可恢复」+§25 游标语义+§19/§67 禁止偷发/禁止自动提交；推送观察的一次性前台重启属 push-foreground 车道（§64/§50）声称不重复。新车道 `apps/web/tests/android-follow-window-foreground.e2e.ts`（outage 骨架+生命周期驱动）：配对打开种子 Session、加载一页旧史、断线前追加三条并让设备显示（持久截点前移）、systemHome 后台化并轮询后台态（CREATED/无焦点/外来窗口），随后在后台执行 Host 侧 `terminateDeviceConnections`——follow 循环生命周期无关（viewModelScope、无前台钩子、1s 重试），后台进程自行以含断线前新增的持久化游标重开 follow（requests[1].fromSeq==cursor+3）；后台期间再追加三条被重连的后台跟随者消费（游标无 UI 推进）；经普通启动器 am start（driver 新增 bringToFront()，singleTask、无意图路由）回前台后整窗 first..cursor+6 连续呈现、未发送输入与单设备授权保留、零业务写。如实边界：健康后台往返按设计不产生新请求（流存活，两种结局均合法）；OS 后台回收行为（Doze/真机）与 FCM 投递未验收；重开快照形态不钉。工程修复：driver 单请求预算 40s→90s（测试基建非断言——整窗滚动按 Host ~192 条窗口界在负载模拟器上实测 ~60s 仍 server 侧完成，从根上吸收既有超时类；turns 降档被证伪：窗口界吞下整个 20 轮夹具使 loadOlderHistory 无旧史）；回前台采样改为三条件合并轮询（lifecycle RESUMED 与焦点授予在途竞态）。车道 run-8/9 两连绿（101.0s/102.6s）；本代无 Kotlin 源码改动，gradle 验收轮 BUILD SUCCESSFUL（1 executed，APK 字节不变），unresolved-scan 派生 allowlist 如实为空集、write-reports 不新增 replaced 集合（既有 13 集合未动）；门禁一次全绿：typecheck/lint 0/0、test:docs 17、doc-sync 36、审计串行双轮 43 文件/618 断言无抖动、gate0 双形态 PASS、traceability node --test 6/6（§25 前台恢复句+32 evidence 含 driver 变更）。README 双语前台恢复场景句+边界句改写。真机与 OS 后台回收行为仍未验收，不授予整节 PASS。完整目标未完成。

## Android 持久化窗口物理载体断开车道（第 25 节）

[历史来源记录](artifacts/upstream-first/android-follow-outage-source.json)为 §25 持久化窗口补上物理传输中断证据。新车道 `apps/web/tests/android-follow-window-outage.e2e.ts`（持久化车道骨架+载体销毁）：配对打开种子 Session、加载一页旧史、在仍打开的流上追加三条记录并让设备显示（持久截点前移），随后 Host 侧 `terminateDeviceConnections({ deviceId })` 销毁配对设备的流载体——设备自行检测到的真实传输中断，不涉及 adb reverse 移除（§29 已记载空闲流检测不到 reverse 隧道移除的缺口如实保持，不以 reverse 移除充当断网）。网关侧 spy 钉契约事实：首请求无游标；重开请求 fromSeq==含断线前新增记录的最后应用序号；断线期间不追加记录、不为断线期 Host 写入作声称；重连后三条新记录到达重开的流并无缺口合并入保留页面（assertSessionWindow 以 attempts=2 断言，其本身证明重连尝试确实发生）。未发送输入、单设备授权与零业务写请求断言在案；截图落 .artifacts/screenshots/android-follow-window/outage.png。整窗断言用三步有界重试梯覆盖两类已观察抖动——慢响应被 driver 计时器丢弃而 server 侧仍完成、契约事实已匹配后 Compose 滚动验证器自行放弃（更深历史分页使滚动更重）——均属再观察类，两连绿锚定稳定；期间模拟器一次整体崩溃属基础设施故障（重启后安装态保留、崩溃路径残留 Temp 租约锁清除后复跑）。本代无 Kotlin 源码改动：gradle 验收轮（:app:assembleDebug+:app:assembleDebugAndroidTest+:core:test，scanner env+-PdshNativeAcceptance）BUILD SUCCESSFUL 且 APK 字节与安装态逐字节一致，unresolved-scan 派生 allowlist 如实为空集、write-reports 不新增 replaced 集合；typecheck/lint 0/0、test:docs 17、doc-sync 36、审计串行双轮 43 文件/618 断言、gate0 双形态 PASS、traceability §25 载体断开收口（node --test 6/6、28 evidence）。前台与推送恢复及真机验收仍开放，不授予整节 PASS。完整目标未完成。

## Android 持久化窗口安装态进程死亡车道（第 25 节）

[历史来源记录](artifacts/upstream-first/android-follow-lane-source.json)把 §25 持久化窗口从 core 级提升到安装态级。新车道 `apps/web/tests/android-follow-window-persistence.e2e.ts`（cursor-resume 骨架+进程死亡）：配对打开种子 Session、加载一页旧史、在 follow 流仍打开时追加三条记录（Host 已发布窗口仅在跟随者在场时推进——kill 后再追加对重开快照不可见）、driver.kill() 强停、同安装态重启、assertRestored 门控、重开。网关侧 spy 钉契约事实：首请求无游标；重开请求 fromSeq==持久化最后保留序号；Host 省略已覆盖尾部恰返三条新增（first==cursor+1）；assertSessionWindow 全范围合并窗口连续保留较早页面（attempts=1——重启进程只计自己的 follow）。恢复进程列表自顶起、全窗口 performScrollToNode 可超 driver 单请求计时器而 server 侧操作仍完成——车道侧一次重试观察已就位列表（两次连绿+lint 修复后复跑三连绿锚定稳定）。未发送输入、单设备授权与零业务写请求断言在案；截图落 .artifacts/screenshots/android-follow-window/。主线程文件 IO 移出 main dispatcher 的产品侧修复经评估否决为挂起根因（每进程 2-3 次数百毫秒级有界写、网关无重连风暴；同步 save-before-load 被 core 测试钉死）——评估记录于 note 备选方案节。:core:test 77 套件随 APK 重建轮通过（-PdshNativeAcceptance+scanner env，nativeacceptance id 安装验证）；typecheck/lint 0/0、test:docs 17、doc-sync 36、审计串行双轮 43 文件/618 断言、gate0 双形态 PASS、traceability §25 安装态车道收口（node --test 6/6）。物理断网、前台与推送恢复及真机验收仍开放，不授予整节 PASS。完整目标未完成。

## Android 进程重启后的持久化 follow 窗口（第 25 节）

[历史来源记录](artifacts/upstream-first/android-follow-window-source.json)收口 §25 remaining 点名的持久化窗口项（core 级）。follow 窗口此前仅内存：`NativeSessionJournal` 按内存所有者保留记录与续传游标，同一所有者重连可 fromSeq 续传，进程重启必然冷开。本代新增 core 持久缝 `NativeJournalStore.kt`：`NativeJournalWindow`（sessionId/address/cut/hasMore/records）+ `NativeJournalStoring` + `FileNativeJournalStore`——每 principal 一份加密 v1 文档（`<sha256>.journal`，FileCompanionInputStore 布局：精确字段集、同目录原子替换、读写双界）；窗口是 Host 可重建缓存而非用户输入：不可读字节（残缺文档/cipher 认证失败）隔离为 `.unavailable-<uuid>` 后按缺席读取——文档化恢复=冷开，绝不崩溃或静默替换；超限时从最旧侧丢弃并强制 hasMore=true，截点与最新记录永不丢；持久契约允许 live 事件越截点（last≥cut+连续性校验；空窗口携带空截点 -1）。`NativeSessionJournal` 增 `installPersisted`（reset 后校验装入，此后由既有续传合并治理）与 `checkpoint` 两缝；SessionModel 四处接线（打开时加载并 session+address 双匹配播种——子代理地址绝不播种、替换性发布持久化、两条关闭路径持久化含越截点 live 事件的最终窗口；无 store 全新模型仍冷开）；CompanionRuntime.followJournal 按恢复安装构造一份（native-journal/、AndroidKeystoreCipher("dsh-native-journal")、1 MiB，uploadDigests 先例），两处 CompanionModelSet 构造点传入。:core:test 77 套件通过（新增 NativeJournalPersistenceTest 8 用例：往返、越截点窗口、超限裁剪保新、乱码/空文档隔离冷开、异 principal 不播种、foreign session/address/非连续拒绝、双实例重启携带 fromSeq=3 且合并 0..5、子代理地址无游标）；:app:compileDebugKotlin 通过（scanner 门禁带 env）。物理断网、前台与推送恢复及模拟器进程重启车道仍开放，不授予整节 PASS。完整目标未完成。

## Apple 契约采纳 follow 续传请求词汇（第 25 节）

[历史来源记录](artifacts/upstream-first/apple-follow-resume-source.json)收口 §25 remaining 点名的 Swift 项（契约级）。§25 follow 续传的请求信封此前仅 Android core 内联构建；本代把构建规则抽取为 core 纯对象 `NativeFollowResume`（sessionAddress/subagentAddress 两种 follow 地址、sessionRequest/subagentRequest 置于 address 键下、withMaxMessages 正数页大小、withResumeCursor 非负游标仅在场时携带——全新 follow 信封不含 fromSeq 键、request 组装 `{"request":{"address":{…},maxMessages,fromSeq?}}`），CompanionModels 原四处内联点改为行为等价委托（openSession/openChild 地址构造、replaceFollow 页大小注入、follow 游标注入）。Apple 镜像 `NativeFollowResume.swift` 同构采纳（可抛静态函数 + NativeFollowResumeError 两例，自检可捕获断言）。请求信封契约是结构相等而非字节相等（catalog wireBody 先例；键序归构建方）——与用户可见字节钉死的 view-location 刻意对照。共享夹具 `fixtures/native-follow-resume/`（规范 1/边界 3——全新 follow、零游标、子代理地址——/无效 1，计数 1/3/1 两列同钉）经 Kotlin `NativeFollowResumeFixtureTest`（驱动真实 core 对象、WireValue.fromJsonElement 结构比较）与 Swift 自检段（wireEqual 递归结构比较）双向消费；Host 端 fractional/-0/布尔类 wire 验证留 Host 边界所有方。:core:test 76 套件通过；审计串行双轮 43 文件/618 断言全绿（第二轮 client-bundle 超时抖动留证 -r1 后串行复跑）；typecheck/lint 0/0、test:docs 17、doc-sync 36、gate0 双形态 PASS。完整目标未完成。

## Apple 契约采纳查看位置 handoff 词汇（第 26 节）

[历史来源记录](artifacts/upstream-first/apple-view-location-source.json)收口 §26 remaining 点名的 Swift 项（契约级）。§26 第一阶段 handoff 载荷 `dsh-session-view.v1` 此前仅 Web Client 与 Android core 逐字节镜像；本代 Apple 镜像 `NativeViewLocations.swift` 采纳同一语法：encode 手工按字段序构建 ASCII JSON `{"hostId":…,"sessionId":…,"anchorSeq":…}`（字典序编码器都会产出不同 base64url 字节——JSONSerialization 顺序未定义、sortedKeys 按字母序；ASCII 范围仅引号与反斜杠需转义）写为前缀 base64url 文档；decode 在每个解析边界 fail-loud——未知语法前缀、非 base64url、不可解码、非法 JSON、字段集不恰为三键、非字符串或空 id、负数/小数/布尔/-0/超安全整数锚点——布尔锚点由 CF 类型标识守卫（NSNumber 桥接陷阱，apple-roster-swift 先例）、-0 经符号与零值对齐 Kotlin 原始位检查，绝不静默强制转换。共享夹具 `fixtures/native-view-location/`（一份规范往返钉死精确编码字节、三个边界——零锚点、含转义引号的 id、最大安全整数——与六个无效类，计数 1/3/6 两列同钉）经 Kotlin `NativeViewLocationFixtureTest`（真实 NativeViewLocations.encode/decode，Companion 4096 字符调用方上限）与 Swift 自检段双向消费——两列读写相同载荷字节。调用方尺寸限制与 dsh-companion:// 深链接包装仍归客户端；Apple 外壳消费与 §25 follow 续传 Swift 项、物理设备、分享路由及两节其余验收仍开放。:core:test 75 套件通过；审计串行双轮 43 文件/618 断言全绿（上代并行争用超时教训落实）；typecheck/lint 0/0、test:docs 17、doc-sync 36、gate0 双形态 PASS。完整目标未完成。

## Apple 契约采纳会话位置事实推导（第 29 节）

[历史来源记录](artifacts/upstream-first/apple-location-facts-source.json)收口 §29 开放项"Swift 外壳与位置事实"的推导级半面。Android 侧五元位置事实的推导规则抽取为 core 纯对象 `NativeLocationFacts`：presentedHostName（名册名称空白回退 hostId、无条目不加事实）、workspaceBasename（双分隔符下最后一个非空白段、全空白回退全路径）、latestPreset（最新 `permission/preset` 记录获胜，缺字符串 preset 的匹配事件保留先前值——自 CompanionModels 原文迁移并回委托）、stateWord（open 状态不加词、六个第 18 节族状态词自名、未知词丢弃）、factsLine（仅在场标识符）、detailLine（仅在有工作区时存在：协议固定 full 运行时词加全路径——NativeGatewayProtocol 只接纳 full）。本地化词归客户端；契约只说标识符。Apple 镜像 `NativeLocationFacts.swift` 同构采纳并提供整文档 decode（非对象 host 视为无 Host、非字符串 cwd/state 视为缺席、非数组 journal 视为空、残缺 JSON 抛出、非对象根读为全缺席）；嵌套数组转型按 catalog 先例逐元素 compactMap，basename 用 omittingEmptySubsequences:false 对齐 Kotlin 空白段语义。共享夹具 `fixtures/native-location-facts/`（规范 1/边界 4/残缺 1，两列同钉计数）经 Kotlin `NativeLocationFactsFixtureTest`（驱动真实 core 对象）与 Swift 自检段双向消费：规范文档四段事实+细节行、空白回退、全缺席、preset 保留先例、未知状态词丢弃逐字一致。MainActivity composable 保留本地化渲染但委托 core 对象（单一权威）；:core:test 74 套件通过、:app:compileDebugKotlin 通过（scanner 门禁带 env）；审计 43 文件/618 断言（首轮 1 超时留证 -r1、串行复跑双轮全绿）；typecheck/lint 0/0、test:docs 17、doc-sync 36、gate0 双形态 PASS；traceability §29 remaining 收口 Swift 位置事实（真机/Swift 外壳/后台推送/follow cursor/handoff 仍开放）。完整目标未完成。

## 已保存 Host 名册手动重排（第 28 节）

[历史来源记录](artifacts/upstream-first/hosts-roster-reorder-source.json)收口重命名一代留作待办的手动重排（该代曾记"与最近优先不变量冲突"）。模型：`SavedHost` 增可选 `order`（客户端选择的位置，`sortRows` 先按 order（`order ?? +Infinity`）、有序块内及其后按最近连接降序）；`SavedHostsStore.moveHost(hostId, direction)` 与相邻行交换后给整册每行显式打戳——一次移动即整册进入手动模式，编排因此全量且稳定而非部分有序，边界与未知移动不改动、不通知、返回 false；`record()` 保 order 如保 customName（描述事实随新生成刷新、行保持手动位置、从未移动的新行按新近度落在有序块之后），`rename()` 原地重写携带 order，`parseRow` 在 order 存在时校验其为有限数——重排前的持久化行原样解析，损坏值随其所在行丢弃。连接面 `ConnectionHandle.moveSavedHost(hostId, direction)` 与 renameSavedHost 同构：名册缝、无连接效应；区块面每行新增 上移/下移 动作（`data-host-move-up`/`data-host-move-down`，首末位置禁用，first/last 由 map 下标传入），zh/en 字典增 moveUp/moveDown。证明：存储套件 13 断言（相邻交换+全行打戳+跨存储生命周期持久化、边界/未知静默、编排经受刷新/重命名/无序到达存活、解析准入）、组件套件（边界按钮禁用、点击经注入动作换序、据发布名册重渲）、插件套件（face.move 经句柄入持久化名册、order 戳 [0,1]）、真实浏览器车道 hosts-settings.e2e（上移使外部 Host 居前+边界按钮禁用+`dsh-saved-hosts.v1` 出现 `"order"` 戳、下移恢复新近度序，golden 增 Reorder 行）；cordis inspect 目录经 gen-cordis-inspect-catalog 再生成（moveSavedHost/moveHost/SavedHost.order 三镜像），ui-settings-hosts README 双语限制行改写，traceability §28 remaining 收口本地编辑与手动重排（node --test 6/6）。审计双轮 6 文件/44 断言通过（vitest.config.ts）；typecheck/lint 0/0、test:docs 17、doc-sync 36、gate0 双形态 PASS；实现过程迭代如实留证（lint 首轮 5 错修复、e2e 三跑到绿含构建产物陷阱、pairing 一次同步失败后重录）。完整目标未完成。

## Host 侧设备载体终止原语（第 29 节）

[历史来源记录](artifacts/upstream-first/gateway-outage-source.json)收口 session-location-facts 一代裁定的确定性断线缺口。该代三轮物理排查证明：adb reverse 移除对空闲 follow 流不可检测（无应用层 keepalive 触达控制层）、同 Session 重开复用活流、穿过已移除隧道的新连接仍能成功——确定性断线必须由 Host 侧主动终止载体。本代落地：`RemoteStreamMuxConnection` 向流 opener 暴露窄接口 `RemoteStreamConnectionHandle`（唯一方法 `terminate()` 无关闭握手销毁载体套接字——真实断线在客户端眼中的物理形态）；网关在某设备的已准入流打开的物理连接上绑定设备（业务流 admitRpcDevice 后、$events admitDeviceClient 后，集合同一性守卫防陈旧解绑误删替换条目）；公开 host 平面方法 `terminateDeviceConnections({deviceId})` 销毁该设备全部活载体并返回数量——准入与授权不动，这是连接卫生不是撤销；`TypertGateway` 声明接口同步扩展（`ctx.typertGateway` 表面由此门控，类方法不声明即不可见），`TypertGatewayWireStream.open` 增可选第 4 参 connection 且 `createDeviceConnection` 适配器透传——该透传是 Android 链路的关键：设备经 native-remote TLS 载体上的同一 mux 协议接入（NativeRemoteService 自建 RemoteStreamMuxServer 走 createDeviceConnection 适配器），适配器不透传则绑定永不发生。Android companion 零代码改动：既有状态机把载体丢失读作传输中断，重连延迟期间呈现重连中状态词后以同一准入身份重开 `session/follow`。新车道 `android-connection-outage.e2e.ts`（沿用 location 车道双 scaffold providers-only 结构 + 新 op `waitLocationFactsContains` 设备内 waitUntil 轮询）证明：稳定事实行→重连中状态词→原样恢复、follow 流恰在断线后重开、terminate 返回恰 1；location 车道的不可行注释与 golden 勘误指向本原语。实现过程三次迭代如实记录（首次 spy 丢 connection 参、types 接口未声明致 lib 面缺失、适配器不透传——后两次为设计发现的真缺口，非仅测试修正）。网关套件 492+2 通过（新增 stream-server 句柄测试与跨设备终止测试）；完整目标未完成。

## Apple 契约采纳模型选择词汇（第 30 节）

[历史来源记录](artifacts/upstream-first/apple-model-catalog-source.json)补齐 §30 的 apple 契约列。`NativeModelCatalog.decode` 镜像 Android core `SessionModel.modelCatalog` 的宽容解析语义——无字符串 id 的分组/模型/力度条目被丢弃、名称回退为 id、非对象 `reasoning` 字段视为缺席、`default` 的非字符串成员读为空、残缺 JSON 失败、非对象文档读为空目录；`NativeEffortChoice`/`NativeModelReasoning` 承载力度词汇（efforts 带 id 回退名、可空 defaultEffort）。`NativeModelSelection.wireBody()` 镜像 `SessionModel.selectModel` 的请求信封，`reasoningEffort` 仅在非 nil 时携带——不带力度的选择与力度出现前的 wire 字节一致。共享夹具集 `apps/apple/contract/fixtures/native-model-catalog/`（一份规范文档含推理模型与仅 id 分组、三个宽容边界用例、一个截断文档）双列消费：Kotlin 侧新测试 `NativeModelCatalogFixtureTest` 经 FakeWire 驱动真实解析器并钉住精确解析结构（:core:test 全绿），Swift 侧 `dsh-contract-check` 自检解码相同字节断言一致结构与信封形态（macOS CI lane 编译运行——Windows 本机无 Swift 工具链，编译证据在 CI）。刻意保留与名册相反的宽容语义：名册是本地持久文档损坏即拒绝，目录是 Host wire 响应未知形态降级——镜像各采用所在面自己的语义。apple README 双语各增一段采纳说明并重录 pairing；traceability §30 remaining 收口契约列、余下 apple 外壳 UI 入口与真机验收仍开放。Kotlin 双套件（:core:test 含新夹具测试、:contract:test）绿、TS 门禁（typecheck/lint/test:docs/doc-sync）绿、审计 43/618 不变；完整目标未完成。

## Android 选择推理力度（第 30 节）

[历史来源记录](artifacts/upstream-first/model-effort-source.json)收口 §30 的 reasoningEffort 半缺口。勘误先行：model-select 增量的 remaining 曾记"reasoningEffort 选择面无任何 client UI"——实际上 Web 选择器早已暴露（`ModelSelect` 读取目录 `model.reasoning` 的 efforts/defaultEffort 并在选择时携带力度），真正的缺口仅限 Android，本代补齐。`NativeCatalogModel` 增加可选 `reasoning: NativeModelReasoning?`（`[{id,name}]` 力度加 `defaultEffort`）从既有目录 wire 解析，无推理模型解析 null；`selectModel` 第三参 `reasoningEffort` 仅在非空时附加请求字段——不带力度的选择 wire 字节不变。选择器在各推理模型行下渲染力度按钮行（testTag `catalog-effort-<id>`）：点模型行按其 `defaultEffort` 选择，点力度按钮按该力度选择，确认文本同时命名模型与力度（`已选择 <model> · <effort>`）；力度行使对话框变宽而非 composer 行（模型调控宽度约束沿用）。验收车道以真机 AVD companion 对接 header-only providers-only 回放 Host（零模型调用），三断言证明：恰一条设备签名 `session/selectModel` dispatch 携带 `provider/model/reasoningEffort:"max"`、`model/selection` 会话事件携带同一力度、设备端确认命名模型与力度；JVM 测试覆盖目录解析与两次 selectModel（无力度 wire 不带字段、带力度携带字段，`selectModel` 由 open 门控故测试先 openSession）。本代门禁阶段自身两处失手如实记录：车道文件首次 typecheck 报 TS2379（`exactOptionalPropertyTypes` 下 `string|undefined` 不能赋给可选属性，改为与事件监听同款条件展开后复检通过），docs 门禁在我先行写下英文 note 而中文侧尚未存在时触发 pairing/md-links 失败（补齐 zh.md、修正四级相对路径、pairing --write 后复检通过）——均为实现期正常迭代，非交付物缺陷。受影响客户端套件 43/618 不变（无 web client 改动）、16 车道回归与 Kotlin JVM 双套件全绿；apple 侧入口与真机验收仍开放，完整目标未完成。

## Android 公开会话位置事实（第 29 节）

[历史来源记录](artifacts/upstream-first/session-location-facts-source.json)补齐 §29 的 Android 半面：`SessionRow` 解析 wire 行本就发布的可选 `cwd`，位置事实行由它派生工作区目录名（双分隔符切分）；权限预设不进三语一致性契约 `DomainState`，`SessionModel` 以 `permissionPreset: StateFlow` 从 journal 发布回调取最新 `permission/preset` 记录（替换窗口无记录为权威 null，openSession 重置）；`StreamTransitionOwner` 把原子连接快照镜像为 `StateFlow`（每次迁移后发布），follow 流在线状态首次 Compose 可观察。会话屏在 composer 行之外渲染一行事实 `Host · 工作区目录名 · 预设词 · 状态词?` 与一行细节（完整运行时词+工作区全路径，运行时词如实标注为协议不变量——原生网关只接纳 full）；内置预设复用共享中文词汇，Host 自定义预设显示原始 id。验收车道将真实 AVD companion 配对到 header-only providers-only 回放 Host（读取事实零模型调用），以整行相等断言证明稳定事实行与细节行。断线状态词的车道级驱动经三轮物理排查判定为当前工具集不可行（reverse 移除对空闲流不可检测、同 Session 重开复用活流、已移除隧道新连接仍成功——Host 侧 ESTABLISHED 在案），状态词机制由 JVM 连接状态迁移测试覆盖，确定性断线需要 Host 侧流终止原语（开放）。开发期间两起宿主事故如实披露：无属性构建产物被安装覆盖用户真实 companion（同签名、数据保留、现为当前源码），宿主 adb server 一次崩溃经 kill/start-server 恢复。受影响客户端套件 43/618 不变（无 web client 改动）、15 车道回归与 Kotlin JVM 双套件全绿；真机与 Swift 侧位置事实仍开放，完整目标未完成。

## Android 模型选择器入列共享能力契约（第 30 节）

[历史来源记录](artifacts/upstream-first/model-select-source.json)推进 §30 的 model-select 半面：每个 Host 既有的 `model.select.v1`/`model.catalog.v1` 广播在 Android companion 落地——经 `NativeObservedCapability.MODEL_CATALOG`/`MODEL_SELECT` 观察能力（网关诊断表映射两新端点，support 导出快照按枚举序补两 `false` 键），`SessionModel` 新增 `selectModel`（`cancelActive` 同形 `{request:{sessionId, provider, model}}` 信封）与 `modelCatalog`（解析 `groups`/`default`；零参调用必须空 args——网关严格参数检查拒绝任何多余键，`session/list` 的 `_request` 参数名是该方法签名事实而非无参模板）。会话屏在 composer 行之外按广播渲染 模型 入口（model-steer 单行 composer 约束），首次打开按 Session 加载目录、点选发送一条 `selectModel` 并按名确认（已选择 …），加载与选择失败弹窗内呈现。验收车道将真实 AVD companion 配对到 providers-only header-only 回放 Host（选择不驱动模型调用，启动期校验 fixture 无调用取代 teardown 消费断言，scaffold 仍挂载回放 provider 目录），证明恰一条设备签名 `session/selectModel` dispatch（`args.request.provider/model`）、`model/selection` 会话事件与设备端按名确认，不涉及 prompt 或 turn。车道三轮调试：`_request` 信封拒（改空参）、断言消息被 op 序列化吞（改 fetchSemanticsNode 返回文本、lane 侧断言）、teardown fixture 消费断言（replayProvidersOnly 出口）。受影响客户端套件 43 文件 618 测试不变（本代无 web client 改动）、composer 面 14 车道回归全绿（3 条 Playwright 浏览器版本环境重跑、2 条 EEXIST 租约竞争重跑，均非产品回归）、Kotlin JVM `:core:test`/`:contract:test` BUILD SUCCESSFUL。§30 仍开放：`reasoningEffort` 选择面（无任何 client UI）、apple 侧入口、同候选真机验收；完整目标未完成。

## Steer 提交通入共享能力契约（第 30 节）

[历史来源记录](artifacts/upstream-first/model-steer-source.json)推进 §30 的 steer 半面：HostDescriptor capabilities 现广播 `model.steer.v1`——该条目 ride 既有 `prompt` 方法并与 `session.control.v1` 重叠声明同一 `prompt.send` 权限，网关首匹配权限查找与此顺序无关；Web composer 按能力渲染显式转向提交（`ComposerControlAvailability.steer` 取广播与可接纳 prompt 路径的合取，一次性子代理地址排队不转向），Android 经 `NativeObservedCapability.MODEL_STEER` 观察该能力在排队发送旁渲染两字短标签转向入口，`submitPrompt` 以 `steer` 参数选择 wire mode、默认 `queue` 逐字节不变。转向标签保持单行 composer——全宽标签在手机宽度会溢出行、挤压输入框竖向撑高并使会话列表高度塌缩（待确认发送重试车道经 pending 卡片滚出组合树暴露），证据链存 composer-layout-fix 诊断日志。本地 AVD 真实 companion 对回放 Host 的物理车道证明恰一条携带 `mode:"steer"` 的设备签名 `session/prompt` dispatch（版本化载体信封 `args.request.mode`）且录制 turn settle；受影响客户端套件 43 文件 618 测试（新增广播缺失排队与五断言门控两用例）、composer 面 14 车道（camera 一次负载抖动复跑绿）、Kotlin JVM 73 套件 469 测试全绿（support 导出快照补 `model.steer.v1:false` 键）。§30 另一半——Android 侧 model-select 采编入口——与真机验收仍开放，完整目标未完成。

## Session 头部 chip 公开第 29 节全部位置事实（§29）

[历史来源记录](artifacts/upstream-first/session-location-chip-source.json)推进 §29 的位置元数据公开：Web Session 头部运行位置 chip 的可见文本现在承载 Host 事实、工作区目录名（session summary `cwd` 的最后一段）与权限层级，连接非 ready 时追加本地化状态短词；`title` 属性另行公开运行模式（`完整运行时`，读自 Host descriptor 的 `runtimeMode`）与工作区全路径，使规格要求的五个位置事实（Host、runtime mode、workspace、permission preset、online state）每项都可达而 chip 保持简洁。header 经注入的 `ConnectionHandle.state` observable（与 root composer gate 同一观察源）直接观察 §18 的十一个连接词汇：ready/未观察保持成功色圆点，connecting/authenticating/reconnecting 取业务色，七个阻断状态取警示色并显示短词（`session.locationState.*` 双语十键）。列表尚未收录的 Session 自然省略工作区段，未协商 descriptor 的 Host 不显示运行模式段——缺席语义与 chip 既有的 Host 事实缺席一致。同一提交修正 §34 remaining 的过期开放项：桌面分屏差异已由 DiffBody 逐页签切换交付（共享配对行、同一虚拟化器），开放项只剩同候选四平台真机验收。组件矩阵（ui-conversation skeleton 39 用例 + assembly surfaces，共 616 受影响测试）覆盖 title 公开、缺席、状态词与三档圆点色调；follow cursor、查看位置 handoff、多 Host 切换与真机验收仍开放，完整目标未完成。

## Android 双 Host 待确认 Question 跨主体隔离物理验收（§28）

[历史来源记录](artifacts/upstream-first/android-host-question-source.json)关闭 §28 剩余工作中「Question 与待确认输入跨主体隔离仅有 core 证据」项：隔离验收应用在本地 AVD emulator-5554 上与两个真实 Host 配对（普通脚手架 A；重放已录制 Question 回合的脚手架 B），共用同一 Session id，验证 A 从不暴露待处理交互；B 升起 Question 后，选中 A 时其卡片、选项与作答草稿全部不可见，切回 B 恢复 Question 与保留草稿，另一进程重启后两者都恢复；草稿仅经 B 提交一次——双脚手架 spy 设备签名 `$events/result` 派发恰一次到 B、零次到 A，B 的录制回合完成而 A 无 prompt 无应答；作答后退役 Question 在 A 上仍从不出现；每个 Host 恰保留一个设备授权。设备端能力由 `NativeCompanionAcceptanceTest` 新 op `assertNoQuestion` 承载：先等 `$events` 观察流 ready 帧（Host 快照落定）再断言提交控件、收件箱与指名题目文本全部缺席，使缺席断言对事件时机免疫。车道 `apps/web/tests/android-host-question.e2e.ts` 无浏览器依赖，golden 为 `apps/web/tests/expected/android-host-question.expected.md`；决策记录见 note「物理 Android 车道上待确认 Question 只属于其已保存 Host」。验收限模拟器与 nativeacceptance 应用 id（真机、Swift 外壳、后台/推送、完整 Session 位置元数据仍开放）；Approval 交互类型共享同一收件箱与按主体模型但没有专属物理车道；完整目标未完成。

## Apple 契约采纳第 28 节原生 Host 名册词汇（§28）

[历史来源记录](artifacts/upstream-first/apple-roster-swift-source.json)关闭 §28 剩余工作中的「Swift 采用」项：`NativeHostRoster.swift` 采纳 Android core `FileNativeHostStore` 的名册 JSON 词汇与全部解码不变量（根/行精确字段集、非空白字符串、native-gateway-v1 传输格式、四配对角色、64 位小写十六进制钉定指纹、恰 32 字节 base64 签名密钥、规范可达 HTTPS origin（无 userinfo/query/fragment、空或根路径、合法端口、排除 any-address；去尾斜杠）、互异 Host 键、active 键指向已存身份且名册空时恰缺席），`hostKey` 镜像 SHA-256(「[hostId,指纹]」) 且独立于设备授予；两处平台解析差异显式处理（JSONSerialization 布尔桥接 NSNumber(true)==1 先拒、IPv6 any-address 的 [::]/:: 两拼法都拒）。共享夹具 `fixtures/native-host-roster/`（1 规范文档 + 14 拒绝用例）为对等证据：Swift 自检 main.swift 解码规范文档并按规则拒绝全部无效用例，`NativeHostCatalogTest` 新用例把完全相同字节送入 Android store（gradle :core:test 375 全绿）；Swift 半边本机无工具链、只在 macOS CI lane 编译运行（swiftCiRecovery 先例，桌面复查过渡）。apple README 双语记录采纳并修正既有 84→92 码计数漂移。名册写入/重新配对语义仍归 Android core（Swift 镜像为契约层只读校验），Swift 侧 CI 执行证据待 PR 通道运行收口，完整目标未完成。

## 第 34 节差异预览的分屏视图（§34）

[历史来源记录](artifacts/upstream-first/diff-split-view-source.json)给差异预览补上第二种第 34 节呈现：纯配对模块 `diff/split.ts`（无 React/DOM）把已解析的 unified 行转为分屏行——上下文行出现在两侧，每个无上下文衔接的删除/新增连续段按位配对（首删对首增），较长一侧尾部对着缺席对侧，前导/hunk/note 行保持整行并保留 unified 索引使文件链接与语法高亮按源行寻址；`DiffBody` 在现有工具栏加按 tab 生效的视图切换（aria-pressed），所有视口默认 unified 满足手机默认、桌面按需切分屏，分屏行复用同一虚拟化器（一个配对行仍是一个虚拟行），每半各带行号/符号/变色与经该侧 unified 索引查得的共享语法 span，整行分屏行与 unified 同渲染保留当前文件打开。证明：纯配对单测（按位对齐/纯删纯增/长侧尾部/边界冲刷/索引保留）、组件测试（默认视图、data-diff-view 与 data-diff-side-kind 语义的切换往返、空白对侧）、真浏览器车道 diff-preview.e2e.ts 扩展（切入分屏、配对半边各行号、旧左新右几何布局、切回 unified，golden 增分屏行）。README 双语以分屏契约替换「分栏 diff 仍为未实现的可选项」。跨 tab/持久化视图偏好与配对行内词级高亮保持开放，完整目标未完成。

## 第 28 节名册的已保存 Host 本地重命名（§28）

[历史来源记录](artifacts/upstream-first/hosts-roster-rename-source.json)给名册补上本地命名：`SavedHost` 增可选 `customName`（客户端自选显示覆盖），`hostDisplayName` 独占呈现优先级 customName→displayName→hostId（行标题与切换提示共用）；`SavedHostsStore.rename(hostId, customName|undefined)` 原位设置或清除——顺序永不移动（近度是连接事实而非命名事实），缺 id 与无变化不改动不通知，真实变化如 record/remove 般持久化并通知；`record()` 从新世代刷新描述符事实时把既有 customName 携带到刷新后的行（重连存活），`parseRow` 按「存在即字符串」准入（重命名前的持久化行照常解析、坏值随行丢弃）；`ConnectionHandle.renameSavedHost` 镜像 forgetSavedHost（纯名册接缝，无连接效应）。设置区沿设备区行内重命名模式：草稿自呈现名播种、空草稿行级警示拒绝、保存去首尾空白、回车保存，自定义名存在时才出现「恢复原名」。真浏览器车道 hosts-settings.e2e.ts 扩展：出厂设置区内空草稿被拒绝、`  Desk  ` 去空白后持久化进 dsh-saved-hosts.v1、重置回到重命名前的呈现名（golden 增 Rename 行）；单测覆盖 store 语义（原位设置/清除、无变化静默、重连保留、解析准入）、区呈现（空拒绝、提示名、重置接线、无自定义名时隐藏）、插件接线到持久化名册与外部重命名的订阅驱动重渲。cordis inspect 目录再生成携带新方法契约；connection 与 ui-settings-hosts 两包 README 更新并替换「除忘记外无名册编辑」限制条目。覆盖按浏览器 profile 隔离、无跨设备同步、无手动排序保持开放，完整目标未完成。

## 真浏览器上传去重命中验证与命名空间访问修复（§35、§28）

[历史来源记录](artifacts/upstream-first/browser-dedupe-verification-source.json)以无模型真浏览器车道（真 chromium 跑交付版 web scaffold）关闭浏览器去重的开放验证项：同页面同字节二次选取只发一次 `fileUploads/uploadDedupe` RPC、零载体请求，存储对象 mtime 与大小不变（零重写），记忆显示名作为新别名发布到对象旁；异字节与全新页面上下文都付完整载体，钉住页面级记忆生命周期；真实 Host descriptor 广告 `file-upload.dedupe.v1`。车道首次运行暴露探测在组合页面从未可调用——`FileUploadRuntime` 直接属性读 `ctx.remote.fileUploads` 被 Cordis 反射守卫按调用者 fiber 拒绝（单测 harness 提供的 remote 对象掩盖了守卫）；修复为类与 client 入口声明 `remote.fileUploads` 注入（ui-commands/ui-model-selection 先例）并以 `ctx.get` 归属服务自身 fiber 解析，命名空间未挂载时大声失败 `host/capability-unavailable`，单测 harness 按 ui-model-selection 方式 `ctx.reflect.provide`。探测可调用后撤回重试车道换真值：已投递字节重试按摘要重暂存不再二次载体（`retryRestagedByDigest`）。车道注册循兄弟模式（client 程序排除、host 面程序列入）。本地两处漂移经 HEAD stash 复现确证既有不在本增量处理：parse.ts 的 micromark-util-types 双版本类型身份错误（本地全新 client 构建）与 round 车道平台状态栏 aria 金色；CI 全新安装两者皆绿。worker 本地载体计数缝与跨标签页行为保持开放，完整目标未完成。

## Android 摘要记忆跨进程持久化：重启后的首次重传即去重（§35、§28）

[历史来源记录](artifacts/upstream-first/native-digest-memory-source.json)给 companion 的已上传摘要记忆一个持久归宿：core 新增 `NativeUploadDigestMemory` 接口与 `FileNativeUploadDigestMemory`（有界明文 JSON 文档，version 1、容量 256、仅收小写 hex SHA-256，同目录原子替换；缺失或损坏按空读取，代价是一次完整上传而非被阻塞的上传），`NativeFileAttachmentsModel` 可选注入——`load()` 播种进程内集合、完整上传成功后 `remember` 持久化、去重命中不写盘；`CompanionModelSet` 透传，应用侧每个已恢复安装装配一个（`CompanionRuntime.uploadDigests` 惰性单例，restore 目录下 `upload-digests.json`，注入两处 model-set 构造点，未配对读取为无记忆）。不扩展加密输入快照（用户数据固定字段集与旧格式拒绝策略不与提示性缓存耦合）。JVM 新增 5 例（round-trip/容量环形+近度刷新/损坏回退/格式拒绝+坏条目忽略/跨「进程」实例经持久记忆首传即探测去重），core 459 全绿；验收 APK 随改动重建（scanner 守门变量 + -PdshNativeAcceptance），真实 Host 重启 e2e 双轮保持绿，持久路径与已封存去重语义可组合。按 principal 分文件作用域、容量调优与存储级浏览器记忆保持开放，完整目标未完成。

## 浏览器上传去重：记忆摘要的载体免传输寻址（§35、§28）

[历史来源记录](artifacts/upstream-first/browser-upload-dedupe-source.json)把按摘要去重延伸到浏览器 Client：页面级 `uploadedDigests` 记忆每次成功上传主体的摘要，Host 声明 `file-upload.dedupe.v1` 且输入为 `Blob` 或精确字节时，runtime 先以有界 1 MiB 分块哈希主体（`@noble/hashes` sha2 增量，分块间保留取消），记忆命中经 `remote.fileUploads.uploadDedupe` 寻址，命中零字节传输即得回执且不报告字节进度；`FILE_DIGEST_NOT_KNOWN` 精确回退一次完整上传并在成功后重学摘要，其余拒绝原样对传绝不静默重传；一次性 `ReadableStream` 不可重读、从不哈希，始终走流式载体；无该能力的 Host 完全跳过哈希，首次上传与既有行为逐字节一致。拒绝分支按宽容形态窄化错误码——Host 注入的附件拒绝码位于静态失败联合之外，属 wire 边界动态码。测试新增 4 例（命中免载体、未命中回退、他错对传、无能力不探测）共 28；真浏览器端到端命中路径未演练，属开放项。流式载体的去重路径与 companion 跨进程摘要记忆保持开放，完整目标未完成。

## Android 附件上传去重：按摘要重新暂存已存储字节（§35、§21、§28）

[历史来源记录](artifacts/upstream-first/native-upload-dedupe-source.json)落地第 35 节上传方向的中断传输恢复：Host 新增 `fileUploads/uploadDedupe({ digest, name? })`（能力 `file-upload.dedupe.v1`，权限 `prompt.send`），摘要只负责定位——`AttachmentStore.ensureFileByDigest` 对存储对象重新哈希验证后才经既有别名机制发布显示名并签发新回执，未命中以 `FILE_DIGEST_NOT_KNOWN` 拒绝、格式非法以 `FILE_DIGEST_INVALID` 拒绝、子代理会话在任何存储查询前拒绝；seam 默认返回未命中使非本地后端自然回退。Android companion 对每个 FILE 上传计算 SHA-256 并在本进程记忆成功上传过的摘要，重上传已记忆字节时先探测 uploadDedupe，未命中或 Host 未广告该能力时精确回退一次完整上传，其余拒绝保持致命；首次上传不探测，常规路径零额外往返。uploadImage 因规范化改变字节保持完整上传。真实 SIGKILL 重启 e2e 扩展断言：存活 companion 重传同一文件时存储对象 mtime 与大小不变（零重写）、attachmentId 相同而 receiptId 更新、去重能力随 Host 重启重新广告、重传后 prompt 完整落盘一次模型请求完成。同轮修复该 e2e 的既有缺陷：profile 以裸名 insert `@deepseek-ai/dsh-api-native-remote`，在干净检出里 plugin-package-inventory 无法解析包身份导致首个模型请求 REQUEST_EXTENSION；insert 改为绝对条目后身份解析沿路径上行到工作区 manifest，e2e 双轮稳定通过。测试：Host 侧 attachment 38 + session-controller 50 + file-upload client 20（含免重传、未命中回退、格式拒绝、子代理先拒四类新用例），Android core 458（新增去重命中/未命中回退/能力未广告回退/他错致命四用例，三处既有 share 测试区分同批字节保真），e2e 真机双轮。浏览器流式载体去重与 companion 跨进程摘要记忆保持开放，完整目标未完成。

## Android 真实 Host 重启：暂存回执失效与持久身份恢复

[历史来源记录](artifacts/upstream-first/native-host-restart-source.json)验证 Host 进程 SIGKILL 重启与已配对 Android companion 的组合轴：子进程 Host（apps/cli --profile hostrestart，隔离 DSH_HOME，固定 native 端口）经 fixture 私有 IPC 签发配对、创建会话并上报 describe 事实；设备侧 SAF 上传暂存回执并 flush 后杀死 Host，同端口重启，adb reverse 摘除重建触发重连。断言固定的真实语义：暂存回执进程本地（FILE_NOT_STAGED 拒绝），显式恢复路径（丢弃 pending、移除失效附件、重选、新回执、一次发送）走通；durable 状态跨重启逐项相等（hostId、spkiFingerprint、固定端口、设备授权、attachments/v1 上传字节 sha256），重启后重新通告 native-remote.http-request-budget.v1 且重选上传在派发前重查预算；durable 会话日志恰一条用户来源消息、一个 completed 回合、一次 mock 模型请求。产品代码零改动：仅新增 fixture+e2e 与两行 tsconfig 面注册（host-restart.fixture 同模式），已安装 APK 与图片预算增量一致。

验证：e2e 三方独立运行 exit 0（子代理 r3/r4 与主会话复跑 r5，各约 30 秒）；typecheck 0、oxlint 0/0、test:docs 17/0、doc-sync 36/0、审计 19/19（specification-traceability 与 verify-audit 双文件）、Gate 0 PASS；三张截图（reconnected-session、rejected-old-receipt、final-send）与 observation.json 落盘 .artifacts/android-host-restart-ui/。如实记录：本增量截图的像素级视觉核验未验证——识图通道 key 过期（401）且本会话网关丢弃 image block，主模型降级 Read 同样无像素感知，用户级规则禁止改走其他 OCR；恢复通道（有效 zhipu key 或 reno/config.local.json）后应补做并更新本记录。

局限：验证覆盖被测模拟器、子进程 Host profile 与 TLS 路径；物理设备、iOS companion、上传或流进行中的 Host 重启、并发多设备重连、回执持久化设计仍开放；6045bfb6e4 的独立 CI 隔离运行因 workflow_dispatch 不接受 sha ref 且临时 ref 超授权而未取得（f313431302 的 run 覆盖其内容树）；封存机制新增已知约束：write-reports 的 candidateTrackedChanges 嵌上一代 evidence 自身哈希，封存完成后不得重跑生成器而不重绑回执（0bcf1ace8d 已按空集代重绑并经提交后幂等自证）。

## Android 原生图片上传预算：与文件同源的完整请求体准入

[历史来源记录](artifacts/upstream-first/native-image-upload-budget-source.json)把完整请求体预算准入扩展到 uploadImage：Native 客户端对每个显式图片上传通过同一已验证 Native 客户端读取接收监听器预算一次，校验后在构造 HTTP 调用前对最终发送的完整 UTF-8 字节做拒绝判定，超限映射 REQUEST_TOO_LARGE，不重试、不追加 receipt、不替换草稿与 pending。输入区照片操作同时要求 image-upload.stage.v1 与 native-remote.http-request-budget.v1，仅缺预算能力时提示缺少 Host 上传限制而非图片支持。support export 夹具补记 native-remote.http-request-budget.v1 能力行：该行由文件预算增量引入，其过滤单测轮（57/7）未覆盖全量 SupportExportTest，本次全量 Core 首次暴露并修复。

验证：全量 core:test 450 用例 0 失败（含 UploadBudget 9 用例：每次显式图片上传新预算、超一字节 POST 前拒绝、拒绝或能力缺失的 Host 阻断而非回退无上限请求体、prompt 不查询）；已安装图片预算场景 1/1（1280 字节 padded PNG 编码参数在 2048 内而完整签名请求体超限，本地拒绝时预算恰好读 1 次、图片 POST 0、草稿保留；删除被拒来源照片后小图显式发送成功，Host 存储与会话授权读取字节匹配，唯一持久用户消息含单个 ImageBlock；两次相同且已收束的 HTTP 计数快照与冻结 invoke 账本并发护栏）；回归 Photos（照片门控变更必需）、Files、receipt 恢复、分享采纳 4/4；typecheck、oxlint 0/0、test:docs 17、doc-sync 36、审计 19/19、Gate 0 PASS。三张计划截图经视觉通道实际查看：拒绝错误行与保留草稿、单图片附件条目含详情行、唯一消息与清空输入区均与预期一致。

局限：本地检查仍是 advisory，Host 或反向代理的更严拒绝仍为权威；图片批次、流式与断点续传、物理设备与真机、Swift runtime、第三方发送方仍在文件预算决策的既有开放边界。

## Android 原生上传预算：完整请求体本地预检

[历史来源记录](artifacts/upstream-first/native-upload-budget-source.json)为原生 fileUploads/upload 增加完整请求体预算：Gateway 公开 createDeviceConnection 工厂，使每个 Native HTTPS 监听器在自己的 Cordis 调用上下文中路由 RPC 与流；nativeRemote/httpRequestBudget 以 view 权限返回该监听器实际 buffered body 上限（capability native-remote.http-request-budget.v1）。Android 在每次显式文件上传前读取一次预算，对最终发送的同一份 UTF-8 JSON 字节做 inclusive 比较，超限在构造 HTTP 调用前本地拒绝并映射 REQUEST_TOO_LARGE，不追加 receipt、不清空草稿与 pending；Host 侧 413 与权限拒绝保持独立有效，预算查询失败不回退默认值也不跨请求缓存。

验证：真实 Host 完整边界 3/3（B−1/B 成功、B+1 被真实 bridge 以 HTTP 413 拒绝、viewer/revoked 不能上传且无存储副作用）；catalog 主入口 3 written 且兼容入口 --check 全部 up to date；Host 与 Client 双面构建；已安装 SAF 场景 1/1（1280 字节文件 args 在预算内而完整 body 超限被本地拒绝、草稿与 pending 保留，显式丢弃后 8 字节文件显式发送成功且只产生一条持久用户消息；两次相同且已收束的 HTTP 计数快照与冻结 invoke 账本防止把已发出但被 413 拒绝的请求误报为零 POST）；Files、附件 receipt 恢复、分享采纳回归 3/3；Core 57/7（含 UploadBudget 7、HttpRequestBudget 3）；typecheck、oxlint 0/0、test:docs 17、doc-sync 36、审计 19/19、Gate 0 PASS。三张计划截图经视觉通道实际查看：拒绝红幅与保留草稿、小文件就绪、唯一消息与清空输入区均与预期一致。

局限：512 KiB 源文件、1 MiB args 与每草稿 8 附件的本地限制不变，Host 更大预算不自动扩容；uploadImage 与图片批次、流式与断点续传、物理设备与真机、Swift runtime、第三方发送方仍在既有开放边界；本地预算检查是 advisory，Host 或反向代理的更严拒绝仍为权威；分享入口共用同一 endpoint，其既有原子本地采纳行为由回归覆盖而非新场景。冻结移交快照树经最窄路径前缀排除出双语配对语料，活文档双语覆盖不变。

## Android 附件 receipt 失效后的显式恢复

[历史来源记录](artifacts/upstream-first/android-attachment-receipt-recovery-source.json)限定一个小型 SAF 文件在真实 Session 释放后的 receipt 恢复。Host 进程和 durable Session id 保持，fixture 等待目标上传、prompt 与 follow 收束及持久化 flush 成功后，await 自有 AgentHandle.dispose，再通过普通 sessionController.resolveAgent 恢复同 id 的新 Agent/Session 对象。旧 receipt 属于旧 Session 实例，不能用于新实例；这不是 TTL 到期或 Host 进程重启。

真实文件拒绝使用 session/attachment-invalid，details.reason 为 FILE_NOT_STAGED。客户端只按精确 code 和已知字符串 reason 判定 receipt 指引；IMAGE_NOT_STAGED 使用同一语义，其他、缺失或类型错误的 reason 保持原 Gateway 分类和展示。提示只说明附件回执不能用于本次发送，不从错误反推出 Session disposal、过期或重启原因。指引要求显式处理 pending 后移除并重选附件，并明确丢弃仍与原 requestId 相同的草稿时会一并清除草稿，必要时可先复制所需文字。不同的新草稿作为独立意图保留。

本轮完整 Core 测试实际执行 434 项、69 个套件，失败、错误和跳过均为 0，逐份 XML 与构建日志独立绑定。NativeFileDraftTest 覆盖真实 envelope、A/B 草稿隔离、原意图重试、两种 discard 行为及移除/重选后的身份变化；PromptSubmissionFailureTest 覆盖已知原因和回退。两个源文件中的 16 项用例属于完整 Core 总量，不另计一次执行。本轮没有新的独立安装态 18 项 receipt，上一通知权限增量的结果只保留为历史。

独立 Host 生命周期场景补跑为 1 个文件、1 项通过，exitCode 为 0；运行前后的 spec/config SHA-256 一致，verification.log 保留这次记录。原 run.log 保留为观察，两次执行不累计为两个场景；console.info 未显示的原因尚未确认。这项检查不操作 Android，不替代 SAF、客户端指引或安装 APK 的端到端证据。

新 Android receipt 恢复场景为 1 个文件、1 项通过，摘要保存在 native-scroll.log，命令退出码为 0；Files、Photos 与 NotificationPermission 回归为 3 个文件、3 项通过，摘要保存在 native-regression.log，命令退出码为 0，与新场景不重叠。草稿 A 先取得 receipt r1；真实 Session disposal/resume 后，首次显式发送被拒绝并完整保留 pending A。用户把文本编辑为不同的新草稿 B 后，显式 retry 仍发送 A 的原文本、原附件和原 requestId，并再次得到同一拒绝。丢弃 pending A 保留 B；移除 B 中的旧附件得到新 id C，重新通过 SAF 选择同一文件后得到 r2 和新 id D。r2 与 r1 不同，Host 字节/hash 相同，attachmentId 可以因去重保持相同。

本场景只因明确用户操作执行 2 次 fileUploads/upload 和 3 次 session/prompt；前两次 prompt 均被真实拒绝且没有 durable 用户消息，最后一次才以 D 写入 1 条用户消息并等待 turn/end。普通查看、返回列表、Host disposal/resume、编辑、丢弃和移除不自动上传或发送。pending 与 composer 的现有语义未变，没有把新 receipt 填入旧 pending，也没有复用旧 requestId。列表、follow 和配对请求不混入这两个业务调用总量。

四张最终截图已逐张复核。invalid-receipt 的指引完整可读，pending 仅顶部可见；new-draft-and-pending 同时显示完整旧文本 A 和新草稿 B，按钮与 notice 不在截图内，由实际滚动、Displayed/Enabled 和点击断言证明。replacement-ready 显示新草稿与文件卡，receipt 身份由状态证明；sent-replacement 显示单条文件用户消息与空 composer。安装态与构建的 app/test 两份 APK 哈希由真实 driver 对齐；正常 close/stop 与 fixture finally 的收束已通过，清理失败不能记为通过。身份和调用次数由状态、请求与持久事件断言证明。

旧 Cursor 调查继续为 OPEN_UNCLASSIFIED，[既有调查记录](.artifacts/android-push-foreground-cursor-investigation.json)及其 8 份日志保持绑定。后续通过不构成首次 resumed-window 故障的原因分类或修复证明。本项没有修改 cursor 恢复。

最终 Host 类型检查、全量 lint 与生成器语法检查退出码均为 0，输出为空；快速文档检查 17/17、完整 doc-sync 36/36、规格追踪 6 项和 Gate 0 均通过。before 归档固定为 6896 个文件。本轮不覆盖图片完整恢复、混合附件、Host 重启后的失效、自动重传、持久化 provider URI、大文件、断点续传或物理设备，也没有发生时间过期或引入 TTL 机制。其余规格与 Mobile Release 继续开放；扫描器保持同机共享缓存资格，GO-2026-5932 未关闭，Session writer 保持 V3，completeRc 为 false。

## Android 通知权限与系统设置返回（§50、§64）

[历史来源记录](artifacts/upstream-first/android-notification-permission-source.json)绑定应用级通知权限请求与系统设置返回。CompanionApplication 以 lazy 属性拥有唯一 NotificationGrantController；requested 与 lastAnswer 属于当前进程，不属于 Host、Session、Activity 或 composition，也不写入持久偏好。首次未配对启动仍可请求权限，初次已 STARTED 注册与后续 ON_START 共用 refresh 后 claimRequest 的入口。准入在 launcher 调用前同步占位；重叠 consumer、重建、前台往返及启动失败不重置请求预算。

系统应用级开关是展示权限的真值。回答回调只保留 lastAnswer 并重新查询系统，不能用历史回答覆盖当前开关。应用显示本地化的关闭状态和显式通知设置入口；Intent 只指向当前 applicationId。系统 Activity 不可达或拒绝打开时保留明确错误状态。生命周期 listener 在 NonCancellable 与 Dispatchers.Main.immediate 中移除并等待清理；权限刷新不请求 Host、不重配对、不重启健康 Push。

最终安装态 receipt 通过 7 个 selector、18 项测试，日志中的实际 class/method 完成记录、唯一 OK 摘要及两份 APK 哈希均已核对。组成是 5 项实际 controller 测试、5 项生命周期测试（3 项真实系统权限路径、2 项注入 query/launcher 的 helper 路径），以及 8 项既有 Push 回归。真实 Allow、Deny 与弹窗打开时 Activity 重建均不使用预授规则；各生命周期方法在独立 instrumentation 前清理已停止的隔离测试包。HOME 后的返回通过显式 Activity Intent 完成，没有点击 launcher 或实际 Recents。精确 launcher 次数来自可控 helper，真实应用路径验证同一进程/controller、系统结果、渲染状态与未出现额外权限弹窗，两类证据不互相替代。

最终权限 Host 场景通过 1 个文件、1 项测试，driver 正常退出码为 0；pending prompt 与后续编辑的不同草稿均完整比较。另一次组合运行通过 5 个文件、6 项测试，其中默认预授模式回归为 Push、View Deep Links、Cursor Resume、Input Persistence 四个文件、5 项测试。组合中的较早权限用例与最终单例重跑分别记录原因，不累计为独立覆盖。Host 场景从真实 Deny 开始，应用按钮打开本应用通知设置，活跃 instrumentation 的唯一 UiAutomation 根据系统 package、当前应用标题及总开关容器选择控件。实际系统开关授予权限后通过真实 Back 返回，测试不调用 controller.refresh、不执行 pm grant、不重启 driver 或用 MAIN 补成设置恢复。恢复前后比较 PID、controller、Host key/id/generation、Push/Session model、当前 Session 及完整 draft/pending。

通知关闭期间真实 Host 请求 A 到达，系统无本应用通知；设置授予并返回、再旋转后仍不出现 A，随后真实 Host 请求 B 呈现最小化通知。两次请求复用审批类型，证据以阶段和接收数量区分，不声称通知载荷携带 eventId。健康 signed $events 订阅保持一次。setup 包含配对及一次被 fixture 拒绝的用户发送，建立非空 pending prompt；零 prompt、reply、cancel、upload、create、handoff 与 redeem 断言仅覆盖 callBaseline 后的恢复区间。两次 asked/decided(cancelled) 配对中的取消来自 fixture AbortSignal，不是 Android 发出的审批操作。

六张最终截图均已逐张复核：真实未配对权限弹窗；拒绝与重建后的关闭状态条和新草稿；标题明确标识隔离应用的通知设置总开关关闭、开启状态；最小化审批通知；返回后关闭条消失且新草稿可见。完整 pending 由状态断言证明，不声称截图可见；频道行可见不计为频道测试。本轮只证明受测模拟器的应用级权限与同进程设置返回，不证明频道开关、设置撤权导致的进程死亡、拒绝跨进程持久化、物理设备、FCM/APNs、精确 Host/Session 通知目标或审批动作。正常 Host 已接受回执仍可调和匹配 pending 与未编辑草稿，后续新编辑不应被旧回执清除。

本轮 Core 源码未改、Core 测试未重跑；Push 来源中的 427 项历史 Core 结果不计为本轮结果。旧 Push 的 Cursor 调查继续为 OPEN_UNCLASSIFIED，首个 resumed-window 错误的内部细节缺失，后续完整回归与限定采样未复现，均不构成原因分类或修复证明。[既有调查记录](.artifacts/android-push-foreground-cursor-investigation.json)与其 8 份日志继续独立绑定，不并入本轮通过计数。

首轮 runner 已输出 18 项测试通过，但随后观察到 Windows lease 文件的 WinError 32 清理失败；保存目录中的 receipt 与用例日志不独立证明外层退出状态，因此不作为最终 runner 成功证据。runner 改为先关闭句柄再 unlink，最终 receipt 在清理完成后写入。注释纠正后的重编改变了测试 APK 字节，重编前安装态与 Host 结果保留为历史；最终安装态 receipt、独立安装哈希记录、Host installed-apks 和当前构建均已对齐同一对 APK。

另外保留三次未通过的执行：ADB 在 sandbox 中不能创建 .android 目录；TSX 在 sandbox 中发生 uv_os_get_passwd ENOMEM；首次文档快速检查在新 Note 配对记录更新窗口出现 16 项通过、1 项 translation pairing 失败。它们作为独立观察绑定，不进入 PASS checks，也不被最终通过日志覆盖。

最终 App 构建、Host 类型检查、Lint、报告生成器语法检查、17 项文档快速检查、36 项 doc-sync、6 项规格追踪测试与 Gate 0 均通过，各自日志独立绑定。before 归档固定为 6878 个文件。§50、§64 的其余状态、整节规格、Mobile Release 与跨平台验收继续开放；扫描器保持同机共享缓存资格，GO-2026-5932 未关闭，Session writer 保持 V3，completeRc 为 false。

## Android 同进程后台 Push 与通知前台恢复（§50、§64）

[历史来源记录](artifacts/upstream-first/android-push-foreground-source.json)绑定 Android 在同一进程存活期间的后台 Push 观察与通知返回。HOME 不停止健康的 signed $events 生产流，也不解除通知收集。初次生命周期附着与后续 ON_START 共用 ensureWatching 准入；已经 STARTED 的 Activity 注册监听时补发同一次 ON_START，立即 EOF 或临时错误也不会在一次入口中重复启动。

完整结束的正常 EOF 或 canReconnectObservation 认可的临时异常允许下次前台入口恢复一次。资格根据原始异常及当前 generation 决定，OPENING、OPEN 和旧任务清理中不替换观察；权限、协议、TLS 身份错误、取消、显式 stop 与退休不自动恢复，也没有后台定时重试。StreamTransitionOwner 继续等待原任务清理并隔离迟到结果，Session、Workspace 与 Interaction 的生产流不因本项新增重启规则。

ViewModel 拥有生产流，composition 销毁只解除 consumer。takePendingNotifications 按到达顺序在同一 model 上一次性消费；旋转和健康前后台往返不重发旧通知，两次 consumer 之间到达的新通知由后继 consumer 取出。系统通知权限不足仍消费该次展示尝试；消费位置不代表持久化进程死亡投递。生命周期监听的移除在 NonCancellable 与 Dispatchers.Main.immediate 中执行并等待完成，instrumentation teardown 的取消不会在后台线程直接调用 removeObserver。

本地通知继续使用固定的最小化标题与正文、dsh-link-push channel、id 70、不可变的显式 MainActivity PendingIntent 及点击自动取消。通知点击只重新打开应用，不新增 Host/Session 精确目标、审批动作按钮、FCM/APNs 协议或授权路径。现有输入仍由原 Session 的存储拥有；正常 Host 已接受回执调和可以移除已确认 pending prompt、清空完整匹配且未编辑的草稿，后续新编辑保持不变。

Android core XML 核验为 427 项测试、68 个套件，无失败、错误和跳过。最终诊断构建的已安装 APK 通过 8 项测试：7 项 NativePushObserverLifecycleTest 与 1 项 PushNotificationTargetTest。独立安装态测试与通知栏实际点击的模拟器 E2E 分别记录；通知注册测试自身不执行点击。

最终已安装 APK 的 Push 原生 E2E 通过 1 个文件、1 项测试，并验证 driver 正常退出码为 0。第一次真实通知点击恢复已结束的观察一次；健康后台往返与 Activity 重建后仍为两次观察尝试、两次已接收通知，已消费通知没有重放。本场景通过 GrantPermissionRule 预授予 POST_NOTIFICATIONS 并检查系统通知展示开启，不验收权限弹窗。HOME 往返保留同 PID 和测试通道；返回就绪同时检查 RESUMED、窗口焦点与前台应用窗口。故障只通过独立 AbortSignal 结束第一个 signed 逻辑 $events iterator 并等待清理，不代表物理网络或 mux 中断。Session 页保持没有另一个 Interaction 事件观察，通知由真实 Host approval 请求产生。

场景准备阶段先由用户发送一次 prompt，再由 fixture 拒绝，建立真实的非空 pending prompt。零 prompt、reply、upload、create、cancel 与 redeem 调用的断言只覆盖 callBaseline 后的恢复阶段，不适用于整个场景。两次 Host approval 请求均有 asked 与 decided(cancelled) 配对，取消来自 Host fixture signal，不是 Android 发出的审批操作。身份比较同时覆盖 PID、Host key/id/generation、model 实例、当前 Session 及完整 draft/pending 状态。

[Cursor 调查记录](.artifacts/android-push-foreground-cursor-investigation.json)保留未分类的恢复故障：初次七文件 native-regression 为 1 个文件失败、6 个文件通过，1 项测试失败、8 项通过；covered cursor 在 resumed-window 收到 driver 的 type:error，原始错误内部细节未保留。补充诊断后，同一七文件回归为 7 个文件、9 项测试全部通过，限定的 5 次 covered 单例采样各为 1 项通过、1 项按筛选跳过，未复现首个故障。单例采样不累计为独立覆盖，不代替完整回归，也不证明故障修复或稳定性。原因仍未分类，不归因于环境或 IME；Cursor 调查继续开放，本次交付限于本节列明的 Push 证据。

最终四张截图均已逐张复核：两张通知图显示最小化中文标题与正文；恢复后的 Session 图保留草稿编辑和 IME，不据此认定全部 Host 控件可见；旋转后的图显示 Host、Session 与保留的草稿，fixture 的预期拒绝提示仍在。本增量不验收权限弹窗或拒绝后的恢复、进程死亡后通知投递、实际 Recents、FCM/APNs、通知中的精确 Host/Session 路由或物理设备。现有未被 Host 接受的 pending prompt 和完整草稿在只读恢复区间保持，后续已接受回执仍按正常规则调和。

完整 Host 类型检查、最终 Lint、报告生成器语法检查、17 项文档快速检查、36 项 doc-sync、6 项规格追踪测试及 Gate 0 均通过，各项日志独立绑定。before 归档固定为 6865 文件。§50 的后台与通知子项、§64 的恢复状态只获得本次限定范围内的证据，整节规格、Mobile Release 与跨平台验收继续开放。扫描器保持同机共享缓存资格，GO-2026-5932 未关闭；Session writer 保持 V3、completeRc 为 false，不更新长期记忆或生成交接包。

## Android 查看位置深链接与单次导航授权（§36、§57、§64）

[历史来源记录](artifacts/upstream-first/android-view-deep-links-source.json)绑定 Android ACTION_VIEW 的只读查看位置入口。dsh-companion://session-view/ 包装现有 dsh-session-view.v1. 载荷；原始 URI 不做 trim、大小写修正或百分号解码，query、fragment、额外路径和畸形载荷被拒绝。裸载荷上限 4096 字符，完整 URI 上限 4125 字符。生产复制按钮使用当前可见持久事件的 seq，原有裸载荷复制入口保留。

真正的新 VIEW 投递授权一次导航，不要求第二次确认。当前可信 Host id 必须完全匹配，SESSION_FOLLOW 足以允许 viewer 读取；入口不自动配对、切换 Host、上传、发送 prompt、创建 Session 或迁移运行时。冷启动可以等待本次 Runtime 恢复和能力观察；未配对、Host 不匹配、忙碌、能力失败或缺失、读取失败均终结本次尝试，就绪变化和普通前台刷新不能自动重试，用户明确重试或重新投递相同 URI 才产生新尝试。

待确认或导入中的 Share 保留原提案并拒绝链接；WAITING 或 OPENING 的链接保留当前导航并拒绝新链接和 Share。导航捕获同一 SessionModel、Host key 与 Host generation，不因自身打开 Session 改变 Session generation 而误取消。取消等待本次 anchor 导航协程结束，共享 journal page 和 HTTP 请求由模型拥有；迟到分页不能发布已取消的 anchor 或 OPENED。已经打开的 Session、follow 和 lastSessionId 不回滚，草稿、附件、待确认 prompt 与 requestId 继续归属原 Session。正常的 Host 已接受回执调和仍会执行：已确认的 pending prompt 可移除，完整匹配且未编辑的草稿可清空，后续新编辑保留。输入处于 RESTORE_FAILED 时不更新 lastSessionId。

旋转保留同一内存 owner 和 attempt。WAITING 在旧 composition 销毁取消尚未向 owner 发布时可以重新附着能力观察；已经发布的失败不能因重建复活。OPENING 保留原导航任务且不重复 follow。SavedState 只保存处置状态，不保存链接或导航票据；恢复旧 Intent 和携带 history 标志的冷、热投递均不重放。能力观察按 Host 世代及显式刷新 epoch 隔离，取消或失败不能把保留的 AVAILABLE 当作本次成功，查询结束而无可用结果直接失败。每次新尝试只清理编辑焦点并收起键盘一次。

Android core XML 核验为 417 项测试、67 个套件，无失败、错误和跳过。新增安装态测试 17 项通过，覆盖解析、单次导航 owner、实际 Activity 冷热投递与旋转、能力观察隔离。另一次安装态回归通过 18 项：Share intake 12 项、Share Activity 1 项、既有 Host observer 2 项、能力详情 3 项。两次运行覆盖不同测试类。这些受控测试与真实隐式投递的模拟器 E2E 证据分别记录。

真实 Host 深链场景通过 1 文件、1 用例：实际 VIEW/BROWSABLE 隐式投递能解析应用，viewer 在 88 轮 Session 中定位旧锚点；错误 Host 与畸形链接不发起 follow 或 page；Share 待确认时拒绝导航，关闭 Share 不自动重试；显式重试、重复新投递、分页失败后的手动恢复、OPENING 拒绝竞争 SEND 均通过。原查看位置、Share、输入恢复、Host 名册切换、诊断与操作能力另一次回归通过 6 文件、6 用例。场景未调用 prompt、upload、Session create 或旧运行时迁移，且未新增设备授权。

已人工检查 wrong-host、older-anchor、restored-without-replay 和 cold-view-anchor 四张全屏截图，目标草稿、导航结果和操作入口可见；已安装 App 与测试 APK 哈希均与最终构建一致。进程终止场景采用 force-stop 后重新 MAIN 启动，限定证明该恢复路径不重放旧导航；它不等于实际 Android Recents 或低内存 saved-task 恢复。history 标志和恢复 owner 的行为由独立受控测试覆盖。自定义 scheme 包装不代表 HTTPS App Links 验证，也不授予任意浏览器分发、物理设备或其他平台外壳资格。

Host typecheck、完整 lint、17 项文档快速检查、36 项 doc-sync、6 项规格追踪检查与 Gate 0 的逐项结果由来源记录绑定。before 归档固定为 6855 文件。本项覆盖 §36 查看位置复用、§57 的 Android deep link 子项与 §64 状态投影，不授予 Mobile Release 全验收。Swift 附件采用、跨平台分享与深链接、前台和 push 恢复、更大流式上传、回执过期与 Host 限额协商继续开放；扫描器保持同机共享缓存资格，GO-2026-5932 未关闭。Session writer 保持 V3，completeRc 为 false，§36/§57/§64 仍未整节验收。

## Android Share 显式确认与原子草稿采用（§36、§64）

[历史来源记录](artifacts/upstream-first/android-share-intake-source.json)绑定 Android ACTION_SEND 与 ACTION_SEND_MULTIPLE 的文本、文件和图片接收。接收阶段只保留内存中的待确认载荷；读取提供方名称、MIME 和字节，以及 Host 上传，都在用户确认当前 Host 与普通 Session 后执行。纯文本和 URL 保持字面内容，不触发导航或自动发送。EXTRA_STREAM 优先于 ClipData；输入顺序及重复项保留，畸形或非 content URI、嵌套 Intent 和应用私有相机来源被拒绝。

Activity 使用 singleTask 接收冷启动与 onNewIntent，已占用的入口明确拒绝新到分享，不替换当前提案。旋转保留同一个 intake owner；SavedState 只保存处置状态，进程恢复和历史启动不恢复 URI 授权或重放原始 Intent。新分享进入确认阶段时清除旧编辑焦点并收起键盘，使目标 Host、Session 和确认按钮可见；后续重组及上传不反复抢占焦点，允许用户继续编辑草稿。

整个批次共用现有附件提交准入，依序暂存所有附件，在每个回执验证后一次性追加到最新草稿，并保持准入至本地检查点尝试结束。暂存过程中不产生部分草稿，模型层发送和重试被拒绝；最终采用保留期间的文本编辑、原有附件和待确认 prompt，且只更新一次请求身份。采用前失败不改变原草稿，Host 已保存的未引用对象可能保留。采用后保存失败只允许重试本地保存，不重新上传或追加；保存提示跟随同一输入存储实例。

分享确认继续受当前角色、能力、Host 与 Session 世代、输入恢复状态和选择器占用约束。Files、Photos 与 Camera 回调所有权独立；选择或导入进行中不排队自动导入。每次接收最多 8 项、文本 UTF-8 最多 64 KiB，每原件 512 KiB，组合草稿 8 项，上传参数 JSON 1 MiB；参数预算不含签名 envelope，Host 独立限制完整请求。不申请持久 URI 权限，不删除提供方源文件，也不新增 Host 协议或输入存储版本。

完整 Android core XML 核验为 406 项测试、66 个套件，无失败、错误和跳过。最终应用与 instrumentation APK 构建并安装成功，31 项安装态测试通过：Files/Photos 9 项、Camera 9 项、Share 入口 12 项、Activity 实际投递与旋转 1 项。测试驱动按 Activity 类跟踪重建，避免 ActivityScenario 用启动 Intent 过滤真实 setIntent 后的生命周期；冷启动 Intent 与后续投递分离，后者不携带清任务标志。

真实 Android 34 x86_64 模拟器经系统 Files 与 Sharesheet 向隔离应用分享，两个安装包哈希匹配最终构建产物。查看或关闭提案不上传、不发送并保留草稿；纯文本显式采用不调用 Host。第二次上传的可控等待证明无部分草稿及模型层发送互斥，完成后保留上传期间的编辑与来源顺序。Host 图片及文件独立存储哈希匹配已知 PNG 和二进制源；场景核对源哈希后只删除测试自有文件。

另一次分享待确认时实际终止进程，恢复已完成加密草稿、附件回执及相同 requestId，不重放接收、不上传、不发送。显式提交生成唯一原身份用户消息，图片与文件内容顺序准确。相关回归一次执行九文件十二项通过；随后局部键盘修复后的 Share 可见性场景与此前受 Windows ADB 套接字错误影响的下载采用场景两文件两项通过，各次结果分别记录，不累计重复用例。五张最终整屏截图已检查，确认目标信息完整可见、编辑仍可使用键盘，以及恢复和发送后的附件展示。模型输出使用 keyless 录制，不代表真实模型附件理解或物理设备资格。

Host 类型检查、全量 lint、17 项快速文档检查、36 项 doc-sync、六项逐节追溯及 Gate 0 的终态日志分别绑定来源记录。before 归档保留 6838 项文件。Swift 附件采用、跨平台分享、深链接与前台恢复、过期回执、更大流式上传及 Host 限额协商继续开放；第三方发送方和提供方、物理设备和平台矩阵仍需独立证据。扫描器保持同机共享缓存资格，GO-2026-5932 未关闭。Session writer 保持 V3、completeRc 为 false，§36/§64 不授予整节完成。

## Android Camera 完整图片与临时输出生命周期（§36、§64）

[历史来源记录](artifacts/upstream-first/android-camera-attachments-source.json)绑定 Android 系统相机完整 JPEG 输入、应用自有输出清理和图片草稿恢复。显式 + → 相机使用 AndroidX TakePicture，通过未导出的 FileProvider 仅授予单个私有临时输出的读写权限；不申请 CAMERA、广泛媒体权限或持久 URI 授权，也不使用返回缩略图作为附件。Camera 继续复用 core IMAGE、image-upload.stage.v1 与加密输入 v3，Host 协议及 Session 事件没有新增。

相机、照片和文件回调分别匹配原始来源；相机输出按 UUID 关联原 Host 模型和 Session 世代。旋转保留原票据，已启动相机取消后保留丢弃回调至系统结果实际消费，防止旧结果误投下一次选择或积累到 SavedState。恢复元数据只允许清理及丢弃旧结果，既不重开相机也不恢复上传权；结果先到与清理先完成两种顺序均有安装态 Registry 测试。

应用只清理专属规范化缓存路径中的 UUID 文件，拒绝中间目录或输出文件的符号链接逃逸，保留目录外哨兵与无关名称。清理撤销精确 URI 权限后删除输出；外部进程已打开的文件描述符不受强制关闭保证。读取、上传及清理共用提交准入，清理结束前模型层发送和重试均被拒绝；清理失败明确显示，取消及 Host 退役等到所拥有工作结束。SAF 和 Photos 源文件不被删除，Host 已保存的不可变未引用图片也不承诺回滚。

本地仍限制每原件 512 KiB、每草稿 8 项以及 UTF-8 上传参数 JSON 1 MiB；参数预算不含签名 envelope，Host 独立限制完整请求。过大拍照直接拒绝，不静默压缩或改用缩略图；原生流式上传和 Host 限额协商仍未提供。

完整 Android core XML 核验为 390 项测试、64 个套件，失败、错误和跳过均为零；两个 APK 构建及安装成功。18 项安装态测试通过，其中 Files/Photos 9 项、Camera 9 项。真实 Android 34 x86_64 系统相机场景在核对两个安装包哈希后通过：1392×1856 完整 JPEG 的临时文件独立哈希匹配上传字节，Host 规范化图片通过独立存储哈希和 Android 解码核对；取消保留草稿且无 Host 调用，上传等待期间模型层拒绝发送。

另一次相机选择尚未返回时实际终止 Android 进程，恢复同一 grant、已完成图片收据与 requestId，清理孤儿输出且不自动上传或发送。显式提交形成唯一原身份用户消息，ImageBlock 与原意图一致；Session 授权图片回读和 Android 名称展示通过。最终回归分两次执行：Camera、Photos、Files、输入恢复、两种发送确认恢复、原生诊断和查看位置共七文件八项通过；持久下载采用另一个文件一项通过。四张 Camera 截图已检查。模型回复是 keyless 录制，不代表真实视觉理解或物理相机验收。

Host 类型检查、全量 lint、17 项快速文档检查、36 项 doc-sync、六项逐节追溯测试及 Gate 0 通过。新增 before 归档包含 6827 项文件。share intent、Apple 附件采用、过期收据恢复、第三方相机与提供方、更大流式上传、真实设备和跨平台矩阵继续开放；扫描器仍是同机共享缓存资格，GO-2026-5932 未关闭。Session writer 保持 V3、completeRc 为 false，§36/§64 不授予整节完成。

## Android Photos 与有序混合附件意图（§36、§64）

[历史来源记录](artifacts/upstream-first/android-photo-attachments-source.json)绑定 Host 图片暂存准入、Android 系统照片选择器及有序混合附件草稿。Photos 通过系统 ImageOnly 单选入口选图，Files 继续使用 SAF；两者共用选择票据、读取上传、取消和提交准入。Host 签发独立图片收据，提交时按整批图片数量及规范化前字节总量检查 inline 与 staged-image，最终保持普通 ImageBlock 语义和视觉模型检查。

加密输入 v3 保存文本和单一有序文件/图片列表，草稿与待确认意图均保留原 Session、收据、元数据和 requestId。旧 v1/v2 文档严格拒绝且保留原字节，显式恢复保留备份；恢复不自动上传或发送。附件变化建立新意图，显式重试保留原意图，确切确认不清除较新编辑。选择和上传在模型入口持有发送准入许可，避免只靠界面禁用造成并发提交。

本地每附件最多 512 KiB、每草稿最多 8 项，编码 RPC 参数 JSON 最多 1 MiB；参数预算不含签名 envelope，Host 独立限制完整请求。仅接收 PNG/JPEG/WebP/GIF，HEIC 和未知媒体类型明确拒绝；不新增广泛媒体权限、持久 URI 授权、原生流式上传或限额协商。图片可能被 Host 规范化，收据和最终图片引用不承诺保留原件字节。

Host 9 个文件的 170 项定向测试通过；Android core 为 385 项、63 个套件，无失败、错误或跳过。9 项安装态选择器回调测试与真实系统选择器证据分别记录。真实 Android 34 x86_64 模拟器场景在两个已安装 APK 与本轮构建哈希一致后，通过系统 Photos/SAF 选择图片、文件、图片；独立读取 Host 存储，核对已知无元数据 PNG 和文件字节的 SHA-256。删除测试专属源照片并终止进程后，恢复同一 grant、有序收据和请求身份，无自动上传或 prompt；显式发送产生唯一原身份用户消息，ImageBlock/FileBlock/ImageBlock 顺序与完整意图一致。系统上下文消息单独核对，Session 授权图片回读和 Android 名称展示通过。

最终安装态组合回归为 7 个文件、8 项测试通过，涵盖 Photos、Files、输入恢复、两种发送确认恢复、持久下载、原生诊断和查看位置。下载通过有界进度观测等待完成，继续核验原有完成状态、偏移及导出哈希。四张截图经检查。模型响应使用无密钥录制回放，不代表真实模型视觉理解通过。Camera、分享入口、Apple 接入、Host 重启后收据恢复、第三方提供方、更大流式上传、物理及跨平台矩阵仍开放。Session writer 保持 V3，completeRc 为 false，不授予全节或整项目完成。

## Android Files 选择器附件与完整草稿意图（§36、§64）

[历史来源记录](artifacts/upstream-first/android-file-attachments-source.json)绑定 Android Composer 的显式 Files 入口、系统文档选择器与 Host 文件暂存上传。选择票据只消费一次，并绑定原 Host 模型、Session id 与打开世代；离开后重新打开同一 Session 不能恢复旧票据的权限。取消与退役等待内容流关闭和 RPC 清理，迟到回调不能把文件附到另一个目标。已经被 Host 接受的上传可能留下未引用文件，不承诺撤回 Host 存储。

加密输入文档升级为 v2，草稿和待确认发送均保存文本、文件收据、显示元数据及完整 requestId。文本或附件改变时建立新意图；显式重试保留原 Session、收据集合和请求身份，确切确认只清理已提交版本，保留较新编辑。旧 v1 文档严格拒绝且原始字节保留，只能通过显式恢复保留备份并开始空状态；没有自动迁移。上传本身不提交提示词，后续由用户明确发送，持久化恢复也不自动重传。

本地读取最多 512 KiB 文件，草稿最多 8 个文件，编码后的 RPC 参数 JSON 最多 1 MiB。参数预算不包含外层 RPC envelope，Host 独立实施准入和请求大小限制，当前没有 Host 上传限额协商。文件通过有界内存读取与 base64 参数上传，不提供更大文件的流式上传、断点续传或上传幂等保证。

373 项 core 测试、62 个套件无失败、错误或跳过，覆盖文件意图的持久化、请求身份、确切确认、原意图重试、Session 世代失效、取消收尾及输入保存失败。6 项安装态附件选择器测试通过，使用受控来源核对单选、一次消费、取消占位、Session 往返、Host 退役及数量拒绝；这些回调证据与真实 SAF 选择场景分别记录。

最终组合回归为 4 个文件、5 项测试通过，涵盖真实 SAF 附件、输入持久化、两种丢确认重试与持久下载回归。应用和 instrumentation 安装包均与本轮构建的 SHA-256 匹配。中文名二进制及空文件经系统选择器上传，Host 存储的独立 SHA-256 与所选字节一致；超限文件在上传前拒绝。真实进程终止后保持同一设备授权、文本、附件收据及请求身份，恢复不自动上传或发送。显式发送只有一条匹配原请求身份的用户来源消息，完整文本与有序 FileBlock 精确核对；系统上下文快照另按既有回放的来源元数据验证，Android 展示发送文件名。

Photos、Camera、分享入口、更大文件流式传输与 Host 限额协商仍开放。物理及 16-KiB 设备、第三方文档提供方、Host 重启后暂存收据失效的交互恢复与其他平台附件接入仍需对应证据。Session writer 保持 V3，completeRc 为 false；不授予 §36、§64 或整项目完成。

## Android 持久下载应用接入与系统文档导出（§35、§64）

[历史来源记录](artifacts/upstream-first/android-download-adoption-source.json)绑定 Host 主体所属的 Android 下载模型、Keystore 加密存储和资源下载控件。选择资源只恢复本地检查点；用户显式开始或续传才读取 Host。资源替换与 Host 退役等待旧传输和导出清理后释放文件锁；显式移除只删除本地主体所属内容。聚合字节与条目配额限制应用私有下载存储，完整文件逐段解密写入系统选择器新建的文档，失败或取消清理该目标。

351 项 core 测试、59 个套件无失败、错误或跳过，包含界面协程取消后的状态恢复、文件锁释放、已确认移除、损坏拒绝、配额拒绝及有界导出清理。单 Host 安装态场景已验证下载中断、Android 进程重启后的 PAUSED 恢复、显式续传、完整文件经系统选择器保存及独立目标字节核对；这些证据不授予断电恢复或第三方文档提供方资格。

本轮验收前显式安装应用与 instrumentation APK，driver 核对实际安装包与本轮构建产物的 SHA-256；不匹配的安装包拒绝进入验收。前轮 checkpoint 的预览回归曾运行旧安装应用，不能据此归因到当轮重建 APK。本轮已显式安装 checkpoint 对应 APK 重跑原场景，[勘误观测](.artifacts/android-download-adoption-prior-apk-correction.json)与[重跑日志](.artifacts/android-download-adoption-prior-apk-regression.log)独立保留原始来源记录的事实边界。

最终组合回归为 4 个文件、5 项测试通过，包含 3 个原生场景与 2 项 APK 准入测试；系统选择器安装态另有 3 项测试通过。双 Host 场景在相同 Session id 和资源路径下核对各自预览前缀与全部 workspaceFiles/readBytes 读取范围：A 中断后 B 从零开始，切回 A 恢复 128 KiB 的 PAUSED 检查点，显式续传只读取缺失范围，未增加另一 Host 的字节读取。该隔离场景不独立核对完整导出文件；完整 SAF 目标的 SHA-256 由单 Host 场景独立验证。

保存中的 Host 切换、第三方文档提供方、物理及 16-KiB 设备、后台调度、磁盘自动淘汰和断电或回滚防护仍需对应证据。Camera/Photos/Files 附件、前台与推送恢复、深链接及 Swift 接入继续开放。Session writer 保持 V3，completeRc 为 false；不授予全节或整项目完成。

## Android 加密下载检查点与显式续传 core 设施（§35、§64）

勘误：本节原有“重建 APK 的真实 Host 资源预览回归通过”误将旧安装应用的结果归因到重建 APK；请以[本轮安装核验与纠正观测](.artifacts/android-download-adoption-prior-apk-correction.json)及[显式安装后的重跑日志](.artifacts/android-download-adoption-prior-apk-regression.log)为准，历史来源记录保持原样。

[历史来源记录](artifacts/upstream-first/android-download-checkpoint-source.json)绑定单一主体、Session 与资源的加密磁盘传输设施。独占锁限制同一传输的写入者；先同步分段、再原子替换加密检查点。恢复校验已提交前缀并忽略未提交尾部；显式续传重新核对描述，使用与预览共用的字节校验器。退役等待网络和磁盘完成后释放锁。

341 项 core 测试、58 个套件无失败或跳过，其中 15 项下载测试覆盖加密文件、主体和 Session 隔离、损坏拒绝、版本变化、同版本重试、暂停、有界复制及等待退役。独立 JVM 在分段同步后、检查点替换前突然退出，重新打开能恢复旧前缀并替换未提交尾部。重建 APK 的真实 Host 资源预览回归通过；Host 类型、lint、17 项快速文档、36 项 doc-sync、6 项追踪和 Gate 0 通过。

应用尚未构造下载控制器，Keystore 存储、下载 UI、磁盘到系统文档保存、清理与聚合配额继续开放。JVM 中断证据不代替 Android 进程死亡或断电资格；不授予完整下载、全节或整项目完成。Session writer 保持 V3，completeRc 为 false。

## Android 完整资源经系统选择器保存（§35、§64）

[历史来源记录](artifacts/upstream-first/android-resource-save-source.json)绑定完整 READY 资源的用户选择目标保存。打开系统选择器前复制已接受字节并保留原 Host 保存器；仅向 ACTION_CREATE_DOCUMENT 提供文件名与检测 MIME，保存不增加 Host 读取或业务写请求。部分预览不提供完整文件保存。资源关闭、替换及 Host 退役使待处理选择失效，写入取消等待 I/O 与新目标清理；清理失败单独提示。

326 项 core 测试、57 个套件无失败或跳过；三项安装态 Intent/回调所有权测试通过。真实 Host 场景实际驱动 Android 系统选择器，保存中文文本、空文件和二进制后独立读取目标字节，验证取消、失效目标清理与大文件前缀入口隐藏。资源读取、能力准入、子时间线三项相邻真实 Host 回归通过。五张终态截图确认系统选择器、保存、取消、失效及无旧提示的部分预览。

Host 类型检查、lint、17 项快速文档、36 项 doc-sync、6 项逐节追踪及 Gate 0 通过。持久大文件下载、崩溃中传输恢复、选择器内杀进程、保存中双 Host 切换、第三方文档提供方与物理设备继续开放。应用与 APK 独立绑定、扫描器复用既有核验产物；Session writer 保持 V3，completeRc 为 false。

## Android 所选父会话的只读子时间线（§6、§25、§64）

[历史来源记录](artifacts/upstream-first/android-subagent-timeline-source.json)绑定所选父会话目录、有界只读子时间线及观察退役。目录不再从列表首行推导父会话；父会话、读取状态和行原子发布，迟到及被替换的请求不能覆盖新目录。子视图仅暴露重连与较早分页，复用携带父会话/子会话/mode 地址的固定截点日志；替换和关闭等待旧跟随及分页清理。

315 项 core 测试、56 个套件无失败或跳过，覆盖冷父可用性、目录错误、代次取消和等待中的子视图替换。已安装真实 Host 场景验证非首行父选择、冷子历史、分页拒绝与恢复、目录失败保留及父切换；三项相邻真实 Host 回归通过。五张截图确认只读内容和错误恢复控件。普通父 Session 跟随仍可按既有策略后台激活；直接子会话保持冷读取，不激活子 Agent、不发业务写请求。

Host 类型检查、lint、17 项快速文档、36 项 doc-sync、6 项逐节追踪及 Gate 0 通过。源码与 APK 独立绑定，扫描器复用既有核验产物，不扩张同源码或发布资格。嵌套浏览、子会话续写、Swift 与物理设备仍开放；Session writer 为 V3，completeRc 为 false。

## Android 业务操作按协商能力呈现与发送（§13）

[历史来源记录](artifacts/upstream-first/android-operation-capabilities-source.json)绑定会话列表/跟随/控制、文件列表/文本/资源及子代理入口的独立能力检查。界面不呈现已知不受支持的操作，也不启动对应自动查询；Native Gateway 对已知操作在 HTTP 发送和 mux 创建前再次核对最近成功协商，覆盖迟到回调及直接调用。内建事件传输不虚构能力标识，授权仍由 Host 逐请求判定。

本地草稿、待确认身份与保存选择不会因能力变化删除，恢复支持只重新打开观察。子代理取消读取保留行并回到 idle，停止请求被拒绝显示未确认提示。支持导出加入固定 Subagent catalog 标识，不允许任意远端字符串。306 项 core 测试、55 个套件无失败和跳过；五项已安装测试及七项真实 Host 回归通过，实际截图确认操作隐藏/恢复及草稿保留。服务端方法保持挂载而声明变化，调用记录独立证明请求抑制。

Host 类型检查已收录新场景，tsc、lint、17 项快速文档、36 项 doc-sync、6 项逐节追踪及 Gate 0 通过。应用源码与 APK 哈希单独绑定，没有沿用旧应用 source/tree 戳；扫描器仍来自已核验的 8ca9f6ebf33de3912292416b85f5b510c88de9a3，不声称新获同源码扫描器/应用资格。跨版本、多语言、物理设备和其他原生功能继续开放，completeRc 为 false。

## Android 当前 Host 能力观察详情（§12、§13）

[历史来源记录](artifacts/upstream-first/android-capability-presentation-source.json)绑定连接能力详情、按 Host 代次隔离的前台观察器以及最终安装 APK。详情显示固定识别集合的最近成功声明、配对时角色和独立 API/Session 版本；没有观察不等于不支持，声明支持不等于当前授权或健康。打开和关闭详情不发请求，显式刷新和进入前台共用查询路径，切换 Host 关闭旧详情并隔离迟到完成。

五项已安装 Compose 测试通过；真实 Host 能力拒绝/恢复与原生扫描诊断两个场景通过，最终严格类型化的能力场景另行通过。系统截图已核对成功、失败保留事实及可滚动内容；最初错误采到 Activity 的截图被排除。Host 类型检查已显式收录新场景，tsc、lint、17 项快速文档、36 项 doc-sync、6 项逐节追踪及 Gate 0 通过。

本轮应用从当前工作树构建，不使用旧提交的应用 source/tree 戳；APK 字节与源码哈希分别绑定，扫描器 AAR 仍来自已核验的 8ca9f6ebf33de3912292416b85f5b510c88de9a3，不声称重新取得同源码应用/扫描器资格。完整能力驱动操作呈现、当前权限、物理设备、横屏及大字体仍开放，completeRc 为 false。

## 原生扫描器同候选构建与安装验收（§43、§56）

[历史来源记录](artifacts/upstream-first/native-scanner-candidate-source.json)将扫描器和隔离 Android 应用绑定到同一个正式提交 8ca9f6ebf33de3912292416b85f5b510c88de9a3 及其源树。两次独立工作/输出目录构建得到相同 AAR 与回执字节，使用共享依赖缓存；AAR 为 8132998 字节，SHA256 为 7590f185193b9dd810b63d3309b68942b6fe6f6b5b95886142e8683a34fa0605。校验数据库保持启用，未使用历史环境改写器。

独立检查对照提交源码、四个构建器、双 ABI、62 个模块和 72 份许可证，并拒绝被改动的产物与错误源码身份。设备 APK/JNI 哈希、规则摘要和 application source/tree 匹配；两项安装原生测试及一项真实 Host 诊断导出场景通过。静态构建回执不改写设备执行字段，安装证据单独记录。

两个精确 JNI 二进制的 govulncheck v1.8.0 符号扫描无包级或符号级发现，各保留一项 GO-2026-5932 废弃 OpenPGP 模块提示；未隐藏提示，也不声称无漏洞。17 项快速文档、36 项 doc-sync、6 项逐节追踪及 Gate 0 通过。本轮无产品源码修改，不重复运行既有单测或宽泛 lint。干净缓存/跨机器重现、race、CodeQL、真机、16 KiB 设备、Apple 和发布签名仍开放，completeRc 为 false。

## 原生扫描器源码与 Android 构建出处（§43、§56）

[历史来源记录](artifacts/upstream-first/native-scanner-adoption-source.json)将共享 Go 支持扫描器、Android 构建器依赖闭包和三组 Python 测试纳入当前检出。扫描器运行行为保持固定 Gitleaks 规则、真实 canary、不可变字节及等待取消；应用仍拥有字段选择与交付，不引入另一套 Host 支持包服务。

仓库入口 test:support-scanner 通过五项拒绝控制、二十项 Python 测试（Windows 目录符号链接一项跳过）、八项 Go 主测试及五个秘密输入子案例、模块完整性和 vet。门禁要求固定编译器、非空实际测试与校验数据库。构建器新增显式无凭据 HTTPS 模块代理；私有源码仍对照 Git，外部模块仍校验。JS 语法、lint、17 项快速文档、36 项 doc-sync、6 项逐节追踪及 Gate 0 通过。

现有外部 AAR 未被替换。构建器要求源码与自身文件已提交且字节一致，因此当前提交产物重建与匹配安装验收是后续步骤。race 在启用 cgo 后因缺少 gcc 未执行成功；漏洞、真机、16 KiB 设备、Apple 和发布资格仍开放。Session writer 保持 V3，completeRc 为 false。

## Android Native Gateway 支持诊断（§42、§43、§67）

[历史来源记录](artifacts/upstream-first/android-native-diagnostics-source.json)将支持导出接到当前 Native Gateway。密封变体区分原生与历史 Link；原生快照不做 I/O，按客户端代次记录 HTTP 回调与 mux 订阅所有权，模型重连次数保持独立。固定角色、能力白名单和失败分类排除身份、地址、凭据及任意远端字符串。刷新失败保留最近成功事实，关闭后的迟到完成不能恢复可用状态。

核心 304 项测试、55 个套件通过。四项最终真实 Host 与已安装模拟器场景覆盖原生扫描导出、两种游标恢复和资源读取；诊断场景核验只读协商拒绝及恢复、逻辑 follow 重连计数与私有字段缺失，不发业务变更。类型、lint、17 项快速文档检查、36 项 doc-sync、6 项逐节追踪和 Gate 0 通过。源码与日志经过来源绑定，Session writer 保持 V3，completeRc 为 false。

当前扫描器 AAR 来自固定历史提交，其源码及构建器不在当前检出；字节扫描通过不构成同候选源码可复现构建。物理设备、崩溃采集、四平台支持包、完整能力呈现和发布资格仍开放。

## Android 当前 File/Artifact 资源读取（§35、§67）

[历史来源记录](artifacts/upstream-first/android-resource-adoption-source.json)将原生文件页与工件页接到同一个 Session 作用域资源读取器。工件引用来自当前 deliverables/presented 持久声明；已移除应用的退役 session/artifact 调用及按旧工件 id 缓存完整字节。路径与模型描述不授予权限。

读取先 stat，再串行请求 64 KiB 字节窗口，默认内容保留预算 8 MiB，已知大文件只读取 256 字节前缀。响应验证偏移、版本、大小、规范 base64 和 EOF 进度；失败显式续传，版本变化丢弃前缀并要求重新读取。切换 Session 清空旧资源，模型退出等待取消清理。图片限制为四百万像素，文本显示限制为 65536 字符，其他内容为惰性字节预览。

核心 299 项测试、54 个套件通过。八项最终真实 Host 场景覆盖资源、两种游标恢复、查看位置、输入进程恢复、多 Host 与两种丢确认重试；资源场景核验空文件、中文路径、图片解码完成态、文本上限、大文件前缀和中断/版本重启。Host 类型检查、lint、17 项快速文档门禁、36 项 doc-sync、6 项逐节追踪与 Gate 0 通过。生成文件和预置事件不代表真实模型、物理设备、持久下载、SAF 导出或全平台描述符验收，completeRc 为 false。

## Android 内存游标续传与窗口恢复（§25、§67）

[历史来源记录](artifacts/upstream-first/android-cursor-resume-source.json)使 Android 同一内存日志所有者携带最后保留序号重开 follow。快照头必须匹配所选 Session；连续增量保留较早页面与历史可用状态，完整窗口的重叠记录必须一致。游标失去覆盖时采用服务端最新窗口，不拼接缺失区间。新模型或进程不复用只有游标而没有记录的状态。

每次有效快照更新分页截止点并取消旧读取；迟到响应不能发布。矛盾记录、游标倒退和字节超限保留原窗口并停止自动重连；只有首帧通过验证才报告 OPEN。核心 288 项测试、53 个套件通过，包含 9 项新增游标与观察用例。

真实 Host 的两个逻辑流中断场景验证 3 条增量和 60 条新增后回退 50 条消息窗口，保留未发送文本与单设备授权且不重放业务修改。查看位置、输入进程恢复、多 Host 和两条丢确认路径的五项回归通过。Host 类型检查、lint、17 项文档快速门禁、36 项 doc-sync、6 项逐节追踪及 Gate 0 通过。物理断网、前台与推送恢复、持久窗口、Swift、工件读取及发布资格仍开放，completeRc 为 false。

## Android 查看位置 Handoff 与历史分页（§25、§26、§67）

[历史来源记录](artifacts/upstream-first/android-view-location-source.json)接入 Web v1 查看位置格式：载荷只标识 Host、Session 和持久锚点，导入先匹配当前可信 Host，不从载荷选择身份。Session 页可复制第一条可见持久记录，并显式导入位置；不会新建 Session、提交 prompt 或调用旧运行时迁移接口。

原生历史窗口在固定快照截止点向前分页，并保留同时到达的实时事件。默认每次 50 条消息、保留序列化记录字节上限 8 MiB；不自动下载全部历史。代际检查拒绝旧页面，取消读取在清理完毕前仍受持有，模型退出等待其结束。读取或上限失败保留当前窗口并显示重试；重复打开相同锚点使用新的导航代际。

真实 Host 的 88 轮预置历史验证了错误 Host 不开流、失败页面显式重试、初始窗口外的锚点显示及 Android 复制结果由 Web 解码。输入恢复、多 Host 和两种丢确认重试另有回归；这些证据不代表真实模型或物理设备验收。Android 重连仍完整开窗，深链接、平台分享、Swift、原生诊断、工件读取与发布资格仍开放，completeRc 为 false。

## Android 已保存 Host 目录与安全切换（§17、§18、§28、§29、§67）

[历史来源记录](artifacts/upstream-first/android-host-roster-source.json)补齐 Android 的多 Host 加密目录。Host id 与 TLS 指纹确定稳定条目，设备授权可替换；凭据与当前选择在同一文档原子提交。切换先隐藏业务操作并退出模型，再保存输入、准备目标并不可取消地提交与采纳。提交前失败保留旧选择；提交后旧资源退出失败则显示已提交身份但禁用操作，要求重启。

双真实 Host 使用相同 Session id，A→B→A 恢复各自草稿，进程重启恢复所选 Host 而不自动发送。显式发送只到当前 Host，原 Host 保留自己的输入且两端各复用一份授权。core 覆盖 Question、待确认请求和草稿的主体隔离，以及取消、保存失败、加密与原子替换拒绝。旧原生凭据需显式导入并保留原文件；损坏目录不回退旧身份，需先备份重建。

本轮保留物理设备、硬件密钥永久失效、突然断电、Swift、Session 其他位置元数据、后台/推送、原生诊断、工件/Handoff 和发布资格的未验收状态。TLS 与输入保存决策继续拥有独立职责；目录决策记录部分替代。类型、lint、文档与逐节追踪有独立证据；Session writer 为 V3，completeRc 为 false。

## Android 丢确认重试与 HTTP 断开清理（§13、§17、§18、§67）

[历史来源记录](artifacts/upstream-first/android-prompt-retry-source.json)补齐真实 Host 已准入、Android 未收到确认便退出的验证。显式重试沿用已保存 requestId，只产生一次 inbox 插入、用户消息和模型回复；已有日志回执时则恢复观察并清理待确认项，不再发送 prompt RPC。两条路径都保留新草稿，第三个进程再次验证清理结果已保存，且无需新增设备授权。

本轮复现并修复共享 HTTP 桥接的退出挂起：客户端先关闭，处理函数迟到返回时向已关闭响应写入，会等待已经错过的 drain/close。桥接现在取消迟到响应体，在响应块和背压等待处检查断开状态并清理剩余内容。确定性回归在旧实现上观察到关闭后写入；25 项定向测试通过。最终两个原生场景经实际 Loader 产物通过，另一次三场景回放包含此前的加密输入恢复；两张截图已核对。

Connection 的 Node 入口由包的 Client 构建配置生成，源码侧单测不替代重建产物；本轮已定向编译和打包。原覆盖率配置排除了 HTTP 桥接，尝试报告为 0/0，不算覆盖率达标。Kotlin 产品 core 和 contract 未改动，本轮未重跑。类型、lint、文档 17/17 与 36/36、逐节追踪通过；跨 Host、突然断电、备份策略、原生诊断、工件/Handoff、推送、Swift、物理设备与发布资格仍开放，completeRc 为 false。

## Android 输入加密持久化与进程恢复（§13、§17、§18、§67）

[历史来源记录](artifacts/upstream-first/android-input-persistence-source.json)将 Session 草稿、原待确认请求、Question 答案与最后会话位置按 Host id、固定指纹及设备授权独立加密保存。显式提交先等待保存，写入失败阻止 RPC；新的编辑与原发送意图分别保留，明确确认或对应 Host 回执只清理已接受版本。只读恢复不自动提交输入。

251 项 core 测试与 4 项真实 Host 回放场景通过。模拟器在保存后强制停止应用，不同进程恢复 Question 选择与自定义答案、last Session、原请求 id 和新草稿，未增加 Host 修改或设备授权。密文损坏和输入密钥缺失保留原文件，读取不新建密钥；用户显式恢复会先保留字节一致副本再提交空输入。截图已核对，类型、lint、文档 17/17 与 36/36、逐节追踪通过。

存储使用版本 1、1 MiB 上限和强制同目录原子替换。真实 Host 的跨进程丢确认重试尚未单独验收，身份复用及回执清理由 core 测试覆盖；突然断电、备份保留策略、跨 Host 体验和硬件密钥永久失效仍开放。原传输与提交生命周期说明保留，新决策单独拥有本地格式和恢复。契约单元套件本轮未重跑；工件/Handoff、推送、诊断、Swift、物理设备与发布资格仍开放，completeRc 为 false。

## Android 输入保留与显式提交生命周期（§13、§17、§18、§67）

[历史来源记录](artifacts/upstream-first/android-input-retention-source.json)将 Session 草稿与 Question 输入交给连接模型持有。未改动 prompt 的显式重试沿用 requestId，只有明确成功确认才清除提交版本；迟到确认不会覆盖请求期间的新编辑。交互标识和修订号隔离答案，取消、关闭快照或新修订移除过期输入；重新配对不会采纳另一身份的输入。

234 项 core 测试通过。真实 Android 用例复现了清除失败提示导致回复协程被界面作用域取消；显式提交改由模型作用域持有，卡片使用稳定键，连接模型退役仍会取消并等待请求退出。修复后的真实 Host 用例验证切页、Activity 重建、失败回复和显式重试，只结算一次 Question；失败发送保留输入并显示未确认提示，恢复传输没有自动发送。另两项 JVM/Android 回归验证文件分页、重新配对、凭据跨进程恢复和撤销。截图已目视核对，Host 类型、lint、文档 17/17 与 36/36、逐节追踪通过。

本轮输入仍只由模型持有，跨进程输入持久化、未确认请求身份恢复及 last Session 恢复尚未完成。契约单元套件未重新执行；凭据进程重启回归不能当作草稿重启恢复证据。跨 Host、工件/Handoff、推送、原生诊断、Swift、物理设备与发布资格仍开放，completeRc 为 false。

## Android Session 列表恢复与持久化乱序准入（§13、§21、§70、§71）

[历史来源记录](artifacts/upstream-first/android-session-list-source.json)将 Android Session 列表读取建模为封闭状态。显式读取串行执行，取消返回空闲并传播取消；失败保留已有列表、固定诊断分类及完整 Gateway 拒绝。页面显示加载、空列表和失败提示，提供显式刷新/重试；未打开 Session 时禁用发送与停止。

225 项 core 测试、9 项 contract 测试及 547 项设备准入/Gateway/协议测试通过，涵盖取消清理、排队顺序、拒绝保留、不自动重试和持久化防重放。七项真实 Host 回放通过；新增场景移除自己的 Host 端口转发，验证可见传输失败，恢复连接并手动重试后列表恢复，再验证真实设备撤销拒绝。两种失败截图已经目视核对。Host 类型、lint、文档 17/17 与 36/36、逐节追踪通过。

诊断 APK 在旧 Host 产物上直接观测到 timestamp-regressed。确定性测试复现全新证明乱序误拒绝与同一时间戳早期证明在重启后的漏拦。Host 改为持久化窗口内完整 nonce 哈希记录，允许全新证明乱序到达；单调淘汰下界防止旧证明复活，容量满显式拒绝且不驱逐有效记录。device_trust 域版本 2 拒绝旧格式，未迁移用户数据。新 Host 七项回放通过，但不据此解释全部历史瞬时故障。中断后的模拟器和检查已按实况恢复，未完成的检查重新执行。跨 Host、草稿/答案保留、工件/Handoff、推送、原生诊断、Swift、物理设备和发布资格仍开放，completeRc 为 false。

## Android 凭据损坏与缺失密钥恢复（§13、§14、§21、§70、§71）

[历史来源记录](artifacts/upstream-first/android-credential-recovery-source.json)约束 Android 凭据解密只读取已有 Keystore 密钥。缺失密钥不会在启动读取时被重新生成；只有显式且通过验证的配对在保存替代身份时允许初始化密钥。凭据 JSON 损坏、密文篡改与密钥缺失均保留原文件，显示可见恢复提示，不自动兑换新授权。

真实 Android 34 的修复前案例证明读取会静默创建密钥；修复后六项真实 Host 回放通过，包括三种损坏各自的重新配对与再次进程重启、签名 Session list，以及既有 Question、文件分页、身份替换和撤销回归。Host 类型、lint、文档 17/17 与 36/36、逐节追踪通过。本轮没有重新执行未改动的 core/contract 单元套件。首次组合回放曾有三项 Session 列表就绪等待失败；补充固定诊断阶段后，单独回放及相同并行文档负载下六项回放均通过，但首次原因尚未确认，保留为待查项。

隔离应用删除密钥的故障注入不等于硬件密钥永久失效验收；跨 Host、推送、工件/Handoff、原生诊断、Swift、物理设备和发布资格仍开放。Phase 10 继续进行中，completeRc 为 false，仅本地封存。

## Android 重新配对与身份原子替换（§13、§14、§21、§28、§35、§70、§71）

[历史来源记录](artifacts/upstream-first/android-repairing-source.json)提供显式重新配对入口。旧模型先停止请求及观察，进程传输与已保存身份继续保留；替代身份在内存中验证，只有成功后才原子替换 Keystore 加密文件并采纳新连接。提交开始后的采纳不可取消，Activity 重建对齐已提交代际；取消可通过新的空缓存模型恢复原身份，不取消 Host 任务或自动撤销旧授权。

221 项 core 测试实际执行通过，涵盖模型请求/流清理屏障、凭据原子替换与失败保留。真实 Host 的三项只读回放通过；安装的 Android 34 应用验证错误指纹不改旧凭据、取消后重新读取、成功替换后 Activity 重建及进程重启，授权数保持为两份且可读取既有 DONE 会话。恢复按钮与拒绝提示已由 Compose 同步截图核对。类型、lint、文档 17/17 与 36/36、逐节追踪通过。

本轮验证同 Host 更换设备身份，不授予跨 Host 名册、凭据损坏/Keystore 失效、推送、工件/Handoff、原生诊断、Swift 或物理设备资格。Phase 10 继续进行中，completeRc 为 false，仅本地封存。

## Android 观察流恢复与跨进程身份（§13、§14、§21、§28、§35、§70、§71）

[历史来源记录](artifacts/upstream-first/android-native-lifecycle-source.json)把 Session、Workspace 和交互观察收敛到共享失败分类：仅传输及暂时性 Host 故障自动重连；永久、未知、内部、未配对、无效响应和证书失败停止自动恢复。业务修改不自动重放，回答失败保留卡片供显式重试；审批页显示拒绝并在事件客户端未就绪时禁用回答。

216 项 core 测试实际执行通过，修复前永久撤销在五秒内触发六次尝试的回归已由虚拟时间证明。真实 Host 的三项只读回放覆盖撤销后的模型终止，以及 Android 34 应用停止后在不同进程中恢复 Keystore 身份：没有新增授权，恢复后完成 Question、DONE 会话和两页文件校验。撤销后的分类提示与重连按钮通过实际可见性断言和 Compose 同步截图核对。类型、lint、文档 17/17 与 36/36、逐节追踪通过。

Phase 10 总表校正为进行中。重新连接不会恢复已撤销授权；完整重新配对、凭据损坏、推送/前后台恢复、原生诊断、工件/Handoff、Swift 与物理设备及发布资格仍开放。completeRc 为 false，仅本地封存。

## Android 原生伴随端交互与文件分页（§13、§14、§21、§28、§35、§70、§71）

[历史来源记录](artifacts/upstream-first/android-native-companion-source.json)验证 Android 外壳选择 NativeGatewayClient，使用独立 Keystore 加密凭据文件，保留旧 Link 文件。Question 回复携带交互修订号、正确 Session 归属及结构化选项/自定义答案；文件使用 Session 范围，根目录路径为点号，并按行分页及核验版本。单次 HTTP 调用不复用空闲连接、不自动重放已签名修改，共享 mux 继续持有长连接。

210 项 core 测试实际执行通过；真实 Host 的三项场景覆盖 Kotlin 传输、JVM 模型和隔离安装的 Android 34 Compose 应用。模拟器完成配对、Question 回答、DONE 会话投影和文件翻页：Host 每页上限 1000 行，点击加载更多后界面 1001 行文本哈希匹配。类型、lint、17 项文档快检、36 项文档门禁及逐节追踪通过。共享 Session 录制输入保持原样；验收信息通过临时 socket 传递，不进入命令参数或日志。

工件和 Handoff 仍有退役调用，原生诊断、跨进程恢复、持久保留答案、Swift、Relay/发现及物理设备和发布资格仍开放，completeRc 为 false。远端发布与 CI dispatch 继续受自动批准拒绝限制，本增量仅本地封存。

## Android Kotlin Gateway 传输接入（§13、§14、§21、§28、§70、§71）

[历史来源记录](artifacts/upstream-first/android-gateway-source.json)验证 Kotlin core 直接使用现有 Native Remote 入口：解析版本 1 操作员配对载荷，在发送 HTTP 前固定 Host SPKI，通过当前一次性兑换注册 Ed25519 设备身份，再核验角色、公钥指纹和 Host 身份。API 2 Connection RPC 与共享 mux 均发送新设备证明；Session writer 版本不冒充客户端协议版本。凭据带独立格式标记，旧 Link 身份不会被当作新授权，拒绝核验保留先前本地身份。

200 项 core JVM 测试实际执行通过；未改动 contract 的 9 项为 Gradle up-to-date，未声称重跑。独立 JVM 驱动对真实 Host profile 验证错误 pin、重复兑换、角色和 Host 确认失败、权限拒绝、事件/业务并行流、取消、吊销、恢复以及关闭后进程退出。类型、lint、36 项文档门禁及逐节追踪通过。Android 外壳仍选择旧 LinkClient，业务模型、原生诊断、Swift、真机和平台发布验收仍开放，completeRc 保持 false。

## 操作员配对展示与手机设置可达性（§7、§20、§21、§28、§70、§71）

[历史来源记录](artifacts/upstream-first/native-pairing-presentation-source.json)把操作员配对接入设备设置页：按 TLS 元数据和配对签发能力显示入口；原生元数据 Remote 要求 device.admin。操作者输入使用实际监听端口的 HTTPS origin 并选择角色，默认 viewer；地址通过校验后才调用现有 Device Trust 签发器。二维码与可复制 JSON 携带 dsh-native-pairing 版本 1、Host 身份及名称、SPKI 指纹、一次性码、角色与到期时间。组件仅在内存保留载荷，过期、关闭、编辑或切换 Host 清除展示；关闭或重新生成不会提前撤销尚未过期的码。

真实 Host/Chrome 经设置页签发、固定指纹 TLS 兑换并完成录制 Question；桌面与 390px 布局验证复制按钮在弹层内可达、页面无横向溢出。手机回归在修复前确认设置弹层继承侧栏的隐藏状态；弹层改用 document-body portal，手机导航改为横向滚动行。245 项定向测试通过；独立 185 项覆盖运行对 Native Remote 和新增配对面板/地址模块达到四类 100%，不泛指所有改动模块。最终类型、构建、lint、36 项文档门禁和 16 项 hygiene 通过。设置外壳旧夹具的无版本信封断言及遗漏 Devices/Hosts 的快照已按真实协议 2 修正，并经刷新和只读回放核验。Android/Swift 实际采用、真机扫码、发现/Relay、签名及跨平台发布验收仍开放，completeRc 保持 false。

## 原生 Remote TLS 入口与设备准入（§21、§28、§70、§71）

[历史来源记录](artifacts/upstream-first/native-remote-tls-source.json)记录独立、显式启用的 TLS Connection Source。凭据提供者持久化 P-256 身份，启动续期保持 SPKI；客户端须在发送 HTTP 字节前核对配对指纹。入口拒绝 Origin 和 Fetch Metadata，Cookie 不授予权限。RPC 编解码和 mux 复用 Connection/Gateway，除一次性配对兑换外，每次调用及逻辑流均需设备签名，角色权限、回复归属和撤销仍由 Gateway 执行。默认配置不开放监听器。

Native Remote、Gateway、Device Trust 与 Connection 在补测前通过 752 项；最终 Gateway 与 Native Remote 定向覆盖通过 503 项，Gateway 主模块、mux 及两个新原生实现文件的四类覆盖均为 100%。真实 Host/Chrome 刷新和两项只读回放通过：测试原生客户端经固定 SPKI 的 TLS 执行配对、事件流和 Question 回复，本地 Web 场景也通过；浏览器普通控制 RPC 仍走本地入口。类型、构建、lint、36 项文档门禁与 16 项 hygiene 通过。ESM-only 源启动探针使用内存凭据，不充当持久化验收。操作员配对展示、Android/Swift 协议采用、持续运行中的证书续期、发现/Relay、真机及跨平台发布验收仍开放，completeRc 保持 false。

## 配对码并发兑换与持久化失败重试（§21、§70）

[历史来源记录](artifacts/upstream-first/native-pairing-source.json)记录原生 Remote 接入前的一次性配对前提：配对码在等待授权写盘前独占，重叠兑换立即拒绝；写盘成功后保持消费状态，写盘失败后允许在原有效期内重试。修复前两个回归用例均允许重复兑换，修复后存储重开只读到唯一授权。

Gateway 与 Device Trust 498 项测试通过；lint 调整后的 Device Trust 29 项复验通过。真实 Host/Chrome 经 Gateway HTTP RPC 两次提交每个配对码，只获得一份授权，再以该授权签名事件流和回复，完成已有 Question 录制回放。并发写入与介质失败的确定性证据来自单元屏障，不把 HTTP 调度当作竞态证明。类型、构建、lint 和 36 项文档门禁通过。TLS 原生入口、强制设备准入载体、原生调用格式采用及真机验收仍开放。

## 设备准入、撤销与回复归属（§15、§21、§22）

[历史来源记录](artifacts/upstream-first/device-admission-lifecycle-source.json)记录设备准入与撤销的完整等待期：存储提交重新检查撤销，单个或全部撤销先入队时后续准入拒绝；Gateway 在等待设备准入之前订阅撤销，防止已撤销身份迟到注册，并停止投递排队帧。设备流的每条交互回复必须重新签名且身份与流一致；无证明、其他设备及向匿名流附加设备身份均拒绝，错误签名不消费投递，校验期间取消或撤销不结算交互。

修复前分别保存 2 个存储竞态、4 个回复身份和 1 个流注册窗口失败；修复后 Gateway/Device Trust 496 项测试通过，lint 调整后 2 个取消/撤销用例再次通过。真实隔离 Host/Chrome 通过已有 Question 录制夹具完成刷新与只读回放：三种无效回复保持待答，原设备签名只产生一次工具结果并正常结束回合。类型、构建、lint、36 项文档门禁及最终 JSDoc/目录检查通过。JSON Schema 的设备身份拒绝 details 有标准校验器正反例；重新投影分类夹具发现并补齐 Kotlin/Swift 缺少的三个设备分类，Kotlin 9 项契约测试通过，Swift 仅验证源码/夹具一致而未运行。原生加密 Remote 入口、平台采用及物理设备验收仍开放。

## Web 主机书签与同源访问（§28、§71）

[历史来源记录](artifacts/upstream-first/browser-host-origin-source.json)记录 Web 书签动作遵守本地载体的 Origin 防线：跨源行只提供独立主机页面，不提供无法完成的页内切换；普通 Web 的 Connection 服务拒绝跨源书签选择，不改变当前连接与存储。启动时清除无法使用的持久化选择，仍保留书签，并正常恢复页面 Host。同源选择、底层 retarget 及显式 fixture/注入式载体的归属保持明确。

本轮 Connection/Hosts 239 项定向测试、类型、完整构建、lint、36 项文档门禁、需求追踪和 Gate 0 通过。真实双 Host 与 Chrome 分别授权后，目标 RPC 直接调用为 200 且结果成功，而浏览器跨源请求即使带 credentials include，CDP 观察到的预检仍为 403。正式浏览器两项场景完成快照刷新与只读回放，覆盖隐藏跨源切换、保留页面链接及无效启动选择恢复。未更改 Cookie、CORS 或 localhost 防线；§71 原生加密 Remote Connection Source、强制设备身份、配对及物理平台采用仍开放。临时探针的包解析/预检观察以及正式场景的共享浏览器上下文均在封存前修正并复验。

## Diff 高亮、虚拟化与文件导航（§34）

[历史来源记录](artifacts/upstream-first/diff-rich-viewer-source.json)记录按 hunk 分离旧/新文本的共享 Shiki 高亮、懒加载语法观察与渲染器滚动区内的行虚拟化。文件头解码复用 diff 库；打开文件绑定补丁原属 Session，并拒绝 Host 替换或插件销毁后的导航。二进制与未知扩展名跳转复用文件预览的 MIME 推断及事实卡。虚拟化限制挂载 DOM，不宣称限制已加载文本或 token 内存；split diff 仍为可选未实现项。

§28 同轮修正 Hosts 的服务归属：书签选择、返回本页与忘记书签的持久化归 Connection 公共服务，Settings 只消费注入服务，移除违规 runtime external。文档预览 372 项定向测试及 Connection/Hosts 236 项测试通过；元数据后续边界修正 8 项通过。类型、完整构建、lint、36 项文档门禁、包依赖与 NodeNext 检查通过。最新构建上的 Diff 和 Hosts 两项真实隔离 Host/Chrome 回放通过，覆盖桌面和 375px 视口、TS/懒加载 Python 高亮、键盘导航、ZIP 未知后缀事实卡、复制原文与 64→101 行加载。真实跨源认证、真机平台、硬件及签名验收仍开放；既有 Windows pdf-license-bundle 子进程用例按文件排除。

## Diff 行语义与补丁复制（§34）

[历史来源记录](artifacts/upstream-first/diff-readable-copy-source.json)记录 unified Diff 的 hunk 行数约束、跨文件头区分、零长度侧和安全数值校验；增删行样式接入主题色并带符号，hunk 背景与行号正确显示。复制直接使用累计补丁原文，未完整加载时明确标为复制已加载内容；剪贴板权限失败显示失败，文件替换与销毁抑制迟到反馈。

本轮文档预览包 360 项测试通过（显式排除既有 Windows pdf-license-bundle 子进程用例），测试 lint 修正后又完成复制组件定向复验；Host/Client 类型检查、完整构建、lint、36 项文档门禁、需求追踪和 Gate 0 通过。真实隔离 Host 与已安装 Chrome 在桌面及 375px 视口完成快照刷新和只读回放，验证文件头、增删行、剪贴板原文及 64→101 行滚动加载；视口模拟不等于手机真机验收。语法高亮、虚拟化、打开变更文件与可选 split diff 仍开放。中断的修改前归档已逐项校验并补齐，批量 Git blob 读取复用 1197 项、写入 4610 项，共 5807 项。

## 主机选择观察与书签归属（§28）

[历史来源记录](artifacts/upstream-first/host-selection-observer-source.json)记录 Connection 独立于获准世代发布所选 origin，Settings 经框架钩子同步观察选择与名册；切换先退出旧世代，再通知新选择，已建立浏览器世代记录实际目标 origin。浏览器存储受限或配额不足不妨碍内存选择，恢复的名册校验 origin 并遵守数量上限。忘记当前书签清除持久化选择但不断连，回本页 Host 是独立动作；跨源行提示用目标 Host 当前启动链接授权，并提供不携带凭据的页面链接。已选择不等于已连接。

本轮 237 项定向测试、Host/Client 类型检查、完整构建、lint、36 项文档门禁、6 项追踪检查和 Gate 0 通过；真实隔离 Host 与已安装 Chrome 完成同源选择、回本页、忘记书签、跨源提示的快照刷新及只读回放。跨源示例书签未被连接；不宣称跨源配对、CORS、在线模型或四平台同候选验收通过。名册编辑与排序、真实跨源集成及物理平台验收保持开放，完整目标未完成。

## 未知扩展名 MIME 内容推断（§35）

[历史来源记录](artifacts/upstream-first/mime-inference-source.json)记录未知扩展名的有界文件头读取：Host 声明 read-bytes 能力时读取前 64 字节，PNG/JPEG/GIF/WebP/BMP/ICO 选择图片查看器，ZIP 选择二进制事实卡；文件名匹配及显式查看器选择优先，失败、无匹配和不完整签名落定后回退纯文本，不推断 HTML/SVG。读取世代与 tab/Host 生命周期丢弃迟到响应，重新加载重新推断，完整字节再次确认签名，并将图片 MIME 类型传给 Blob。修复了已有 Host 名册对 Connection 运行时导入缺少客户端模块声明的问题。

本轮证据为 348 项定向测试、Host/Client 类型检查、lint、36 项文档门禁、6 项需求追踪检查和 Gate 0；真实隔离 Host 与已安装 Chrome 的文档预览场景完成预期刷新及只读回放，未知扩展名 PNG 的解码宽度为 1 像素。广域 GUI 为 5876 通过、5 失败、1 跳过：其中 Settings 名册预期和 Diff hunk 滚动条变量随后已修复，对应 28 项定向测试通过；宿主定向复测为 50 通过、1 失败、1 跳过，唯一失败为创建 symlink 的 EPERM；未重跑整个 GUI 套件。该证据不代表真实模型或四平台同候选验收，完整目标仍未完成。

## 完整字节中断传输恢复矩阵（§35）

[历史来源记录](artifacts/upstream-first/interrupted-transfer-source.json)落地第 35 节客户端恢复矩阵：Host 声明 workspace-files.read-bytes.v1 时，Preview 完整字节读取从单次 readAll 改为固定 1 MiB readBytes 窗口序列——bytes/transfer.ts 提供纯函数件（base64 窗口解码、按到达序拼装、窗口常量≤Host 默认 2 MiB 上限），face 以读取世代驱动循环；每个落定窗口经 store 的 transferProgress 更新已接收字节进度行。矩阵语义：已接收字节后的失败保留前缀（TabReads.interrupted 持有窗口块/字节数/基版本），正文呈现「传输在 N 字节处中断」+「从断点继续」（resumeAll 从第一个缺失字节续传不重读）；未收到字节的失败只有从头重试；传输期间 Host 版本变化从零重启（禁止拼接两个版本）；窗口契约破坏（offset 不符、空窗口非 eof）大声 gateway/internal；tab 退役或世代/模式替换后 settlement 不写。UI 进度行与中断横幅走 sidebarDocumentPreview 双语词典（transfer.progress/interrupted/resume）。无 read-bytes 能力的 Host 保持单次 readAll 路径。测试 313（新 17：纯函数 6+face 矩阵 8+UI 2+rpc 绑定 1）。真机同候选验证与 MIME 内容推断仍开放。

## 名册 UI 呈现与选中持久化（§28）

[历史来源记录](artifacts/upstream-first/roster-ui-source.json)补齐第 28 节名册的用户面：新包 dsh-client-ui-settings-hosts 在 Web Settings 注册 hosts 区（order 15，settings.hosts 双语词典）——行呈现 SavedHost 身份（displayName 缺省 hostId、selected/platform/in-process Tag、origin 等宽、lastConnectedAt 本地化），未选中且非 in-process 行暴露切换按钮（经 switchToSavedHost，成功提示 switchedTo），选中态旁有回本页 Host 按钮（retarget(undefined)），忘记走 savedHosts.remove；section 全部经活读取器（rows/selectedOrigin/subscribe）呈现，名册通知或刷新即重读。跨会话选中持久化落在 dsh-client-connection：SelectedHostPersistence 接口 + browserSelectedHostPersistence（key dsh-selected-host.v1，守卫 localStorage、非空串校验），apply() 在任何载体建立前把持久化选中应用为初始 selectedOrigin（行缺失或 in-process 保持页面 Host；此时无循环运行，纯赋值不重连），UI 切换成功即 write、回本页即 clear。测试 ui-settings-hosts 12（组件 7：行呈现/切换通知/回本页/空态；插件 5：host 入口 inert、face 持久化断言、miss 不触碰）+ connection retarget 8（新 2：启动正例定向持久化 origin、缺行/in-process 不动）。开放：选择读取器是轮询非观察、跨源 Host 仍需自身配对、无排序编辑。

## 名册切换动作与流载体采纳（§28 组合）

[历史来源记录](artifacts/upstream-first/roster-switch-source.json)把第 28 节切换从接缝补成动作：connection 侧 switchToSavedHost(connection, hostId) 组合切换——名册行 origin 流入 retarget、返回该行供呈现，未知 hostId 或 in-process 行（无 origin 可定向）不动连接；Gateway 流载体采纳同源选择——RemoteStreamMuxClient 构造接受 resolveBaseUrl，每次物理 WebSocket 尝试以 connection.targetOrigin() 构建 URL（逐次连接重读、https→wss、未选回退页面 origin，remoteStreamUrl 导出为纯函数），ClientRemoteService 实例化时接线，Host 切换自此同时重定向单次 HTTP 调用与流载体。测试 connection 209（新 2：切换命中返回行+retarget 恰一次、未知/in-process 不动）+ gateway 461（新 3：页面 origin wss、选中 base 覆盖、无页面回退内部 base）。名册 UI 呈现（settings/连接页列表）与跨会话选中持久化保持开放。

## 可重定向连接端点（§28 切换接缝）

[历史来源记录](artifacts/upstream-first/retargetable-endpoint-source.json)落地第 28 节名册切换的前置接缝：dsh-client-connection 的 createWebConnectionRpc 增第 4 参 resolveBaseUrl——显式选择基址，缺省回退页面 origin（一次调用内即时重读，切换后无需重建 rpc）；ConnectionHandle 增 targetOrigin()（读当前选择）与 retarget(origin)（绝对 http(s) URL 经 new URL 校验并归约为 origin，非绝对或非 http(s) 值大声 TypeError；设置后替换当前连接尝试，undefined 回到页面 origin）。注入式传输（__DSH_TRANSPORT__）与 fixture 台持有自己载体，该选择只重定向浏览器 HTTP 路径——worker 流载体与名册 UI 的装配（选中 Host 进 retarget）保持开放。ConnectionHandle 声明随 inspect-catalog 再生。测试 207 项（新 4：选中 origin 定向、未选回退页面 origin、无解析器保持原状、handle 校验/存取/清除）。

## 二进制事实卡（§35 呈现矩阵）

[历史来源记录](artifacts/upstream-first/binary-fact-card-source.json)落地第 35 节客户端呈现矩阵的 binary/zero-byte 项：ui-sidebar-documentpreview 新增 builtin 二进制渲染器（32 个已知二进制后缀：压缩包/可执行/库/字体/数据库，bytes-complete 模式）——bytes.ts 纯格式化（hexRowsOf 以 16 字节/行、256 字节展示上限切首块，formatByteCount 千分位无小数），BinaryBody 事实卡在"不以文本预览"提示旁给出字节数、超上限附未展示余量、带文件偏移的十六进制行，0 字节文件呈现显式空态；不做内容嗅探——未知扩展名仍走纯文本路径，由 Host 的 workspace-file/not-text 拒绝权威判定，maxFileBytes 上限对超大文件的拒绝照常生效（拒绝而非截断）。image 渲染器既有；MIME 内容推断与部分下载/中断传输恢复矩阵仍开放。测试 296 项（包内新 10：格式化 5 + 渲染 3 + 注册 2；pnpm-pack license 门在 Windows 本机排除、CI 持有）。

## 共享 Unified Diff 预览（§34 第一切片）

[历史来源记录](artifacts/upstream-first/unified-diff-preview-source.json)落地第 34 节共享 Diff viewer 第一切片：ui-sidebar-documentpreview 新增 builtin diff 渲染器（.diff/.patch、text-pages 模式、不声明换行）——parseUnifiedDiff 纯解析器把累计文本解析为闭集行类型（preamble/hunk/context/add/del/note；hunk 头正则携带两侧起始行号，缺省计数按 1 行，缺 hunk 前缀的正文行作前导行可见而不编号，反斜杠注记行不带行号），DiffBody 以两列行号槽（旧/新各一，缺位留空）渲染 hunk 头、上下文与增删行着色，空文件呈现 locale 空态；注册经 DocumentPreviewRegistry（builtin 带宽，长后缀优先），apply 序列接入主注册表，client slot-catalog 随 keyed 席位再生。手机端默认 unified 即此共享渲染器；split diff、语法高亮、大文件虚拟化、copy/open file 动作保持开放。测试 286 项（包内新 14：解析 8 + 渲染 4 + 注册 2；pnpm-pack license 门在 Windows 本机排除、CI 持有）。§35 的 binary/unknown-MIME 呈现卡仍开放。

## 持久化确认与跨端恢复（§15/§16/§38 余项）

[历史来源记录](artifacts/upstream-first/durable-retained-answers-source.json)落地交互可靠性余项的持久化确认：dsh-api-gateway 客户端新增 client/retained-answers.ts——RetainedAnswersStore 经 browserRetainedAnswersPersistence（守卫 localStorage，缺省回退进程内）把保留的回答持久化在 dsh-retained-answers.v1（上限最近 32 条，插入序最旧先出），durable 边界逐行结构校验（scope/revision/outcome 线形词汇精确复刻，损坏行与损坏整档丢弃不崩启动）；ClientRemoteEvents 构造时以落盘种子 unanswered，retain/remove 五个镜像点（开帧清扫、取消帧、保留不匹配、retain、确认）与内存同步。页面刷新/应用重启后，Host 待处理快照仍以相同 scope+id+revision 列出该交互时自动重放已确认的回答、不重新询问用户（防重复询问与确认丢失）；卸载不清落盘，交给下一次开帧清扫在 scope 不符/快照缺 id 时修剪。跨端恢复由网关既有接入重投递（新流获得全部未决交互）承接，首答胜出 interaction-closed 不变。测试 139 项（新 5：跨重启回放不重开监听器+确认清落盘、损坏整档/坏行/非行三种丢弃重问、scope 变化清扫落盘+重新作答）。真实多设备四平台实机矩阵仍开放。

## 运行位置权限档（§10 第三行）

[历史来源记录](artifacts/upstream-first/permission-tier-chip-source.json)落地 §10 运行位置的第三行：strict Session header 的运行位置 chip 在 Host 计算的 permissions 投影有值时追加本地化权限档——permissionTierLabel（PermissionSelect 导出）内建三档（read-only/workspace-write/danger-full-access）走 access.preset.* 双语键，Host 自定义档位回退人性化名称（kebab→Title Case）；header 经 ui-session 合并的 useProjection('permissions') 读取（会话作用域标准 kit，无契约变更），投影对象以 currentValue 携带档位，无投影的 Host 或草稿态 chip 保持仅 Host 事实。手机端不会误以为命令在手机执行的防线齐备：运行位置 chip（名字+平台+档位）、§28 连接门禁、单世代绑定。测试 453 项（新 1 例三断言：内建档位本地化、自定义档位人性化、无投影不追加）。溢出菜单（⋮）条目仍需工具栏集合，开放。

## 降级探测（§41 接缝闭合）

[历史来源记录](artifacts/upstream-first/degraded-probes-source.json)把 §41 health 从纯存在性升级为降级探测：health() 转 async 并接受 signal——已组合的 loader 深读 pluginInventory，失败 fiber 计数 >0 时 pluginState 降级（detail 指名数量，ready 保持——部分能力损失不等于不可服务）；llm 组合后 listProviders() 为空时 modelProvider 降级并拉低 ready（无提供方即无法接受 Agent 请求，detail 'no model provider is registered'）；inventory 读取抛错以错误类别降级（只取 error.name，不泄配置）。ready 判定改为 sessionStore up && pluginState 非 down && modelProvider up；sessionStore/connection 无部分故障信号，保持存在性。本地结构类型 ModelProviderOwner（listProviders）+ InventoryOwner fiberPhase 扩为 string|null 对齐真实投影（null 投影为 'disposed' 行）。测试 29 项（新 4：无提供方降级+ready 拉低、失败 fiber 降级+ready 保持、无 inventory 不变/抛错降级、describe 携带探测结果）。

## Saved-Hosts 名册基础（§28）

[历史来源记录](artifacts/upstream-first/saved-hosts-source.json)落地 §28 名册基础：dsh-client-connection 新增 client/saved-hosts.ts——SavedHostsStore（hostId 键 upsert、lastConnectedAt 降序、上限 MAX_SAVED_HOSTS=8、subscribe 通知）经 SavedHostsPersistence 持久化（browserSavedHostsPersistence 守卫 localStorage，缺省回退进程内），durable 边界 parseRow 逐行结构校验、损坏行丢弃不崩启动；apply() 在每次已建立世代发布时经本地 ConnectionHostInfo descriptor 声明合并（与 remotes host-preparation 同型，HostDescriptor 类型一致）记录身份事实（origin 取页面 origin、缺省 'in-process'），无描述符世代不记录；ConnectionHandle 暴露 savedHosts。active Host 展示沿用运行位置 chip。测试 203 项（新 7：upsert 排序、上限、跨存储生命周期、损坏行丢弃、remove/订阅、适配器、世代记录集成）。名册 UI 与切换动作仍需可重定向连接端点接缝，开放。

## SessionTelemetry 出口接线（§44 默认关闭生效）

[历史来源记录](artifacts/upstream-first/telemetry-gate-source.json)把 §44 的默认关闭落到唯一现存出口：OpenTelemetry 后端构造时以 telemetryKindAllowed(consent, 'sessionTelemetry') 门控 SDK 管线——关闭（缺省即关）走与 DISABLED 同构的 withheld 路径（不构建 provider、不读任何 transport 配置、反馈留在本地并以指名类别的告警提示），sharing 仍由 mode 命名（部署选择的共享策略）而 consent 决定该类别是否离开。base bundle 增 DSH_TELEMETRY_CONSENT=1 显式开启（env 缺省=关）；wire/route/egress/fail-loud 测试台全部显式 opt-in（transport 误配只在 opt-in 后可达，与 DISABLED 不读 transport 同构）。测试 51 项（otel 2 新：withheld 路径零外发+告警指名类别、withheld 不读 transport 配置）+ base 2。README 四处双语同步（otel consent 行改为强制语义、seam 记录后端执行情况）。provider/relay/deviceTrust/crash 的遥测出口随各自生产者落地。

## Settings-Export Bundle 条目（§43 G2-SUPPORT 第二项）

[历史来源记录](artifacts/upstream-first/settings-entry-source.json)落地 §43 内容条目第二项：supportBundle() 在 settings 接缝已组合且注册至少一个命名空间时附加 settings-export.json 条目——service 经本地 SettingsOwner 结构类型调用 describe({ redactSecrets: true })（wire 表面强制传入，测试台断言漏传即抛），settingsExportBundleEntry 按 ns 排序映射 SettingsExportRow（ns/revision/applies/value/redacted），闭集 ENTRY_KINDS 增 'settings-export'。双重防线：接缝先行剥离 role('secret') 字段（值不进入行），脱敏器递归秘密形状键扫描再兜底——脱敏后仍残留秘密形状键的行使整条目大声失败（防御测试固化）；被剥离字段名只能枚举在 redacted 键下（脱敏器拒绝任何含 secret 的键名，枚举不能挂在秘密形状键下）。exactOptionalPropertyTypes 行构造照例仅展开已定义成员；secrets 数组缺省回退空数组。测试 25 项（新增 4：ns 排序+redacted 枚举、无接缝仅诊断、脱敏残留防御、注册顺序不外泄）。README/subsystem 双语、cordis-surface/api-catalog 再生，doc-sync 36。四平台真机同候选实测保持开放。

## Session-Headers Bundle 条目（§43 G2-SUPPORT 第一项）

[历史来源记录](artifacts/upstream-first/session-headers-entry-source.json)落地 §43 内容条目第一项：supportBundle() 在会话存储（sessionPersistence）已组合且持有至少一个会话时附加 session-headers.json 条目——sessionHeadersBundleEntry 以 id 排序映射 SessionHeaderRow（id/createdAt/cwd?/parentSession?/isSeeded/eventCount?/sizeBytes?/revision，仅头部事实与存储计数，绝不携带事件内容），列表顺序绝不外泄；service 经本地 SessionStoreOwner 结构类型读取 list(signal)（InventoryOwner 先例，可选组合——无存储或空存储时 bundle 保持仅诊断条目）。闭集 ENTRY_KINDS 早已预留 'session-headers'，脱敏器递归秘密形状扫描与 canonical 序列化照常覆盖新条目（键集全部通过，含事实快照的 bundle 仍过 collector 校验，测试固化）。exactOptionalPropertyTypes 下行构造仅展开已定义成员（显式 undefined 不可赋入可选属性）。测试 21 项（新增 3：有条目+排序+脱敏、无存储/空存储仅诊断、列表顺序不外泄确定性）。README/subsystem 双语 Support Bundle 段、cordis-surface/api-catalog 再生，doc-sync 36。设置导出条目与四平台真机同候选实测保持开放。

## Crash/Last-Error 记录器（§41/§42 接缝闭合）

[历史来源记录](artifacts/upstream-first/diagnostics-recorder-source.json)闭合第 42 节 crash/lastErrors 记录接缝：host-diagnostics 新增 recorder.ts——DiagnosticsRecorder 由服务构造常开，$DSH_HOME 下 pid 安全的启动标记（diagnostics-crash.marker）在启动时识别上一次未干净关闭（pid 仍存活属并发运行而非 crash；不可解析标记仍计为未清理，mtime 兜底），事实进入持久且有上限的 diagnostics-crash-log.json（8 条，跨启动保留）；agent 错误 relay（agent/error 事件）填充进程本地有上限（10 条）的规范化事实环（time/name/message/agentId/turn/step，非 Error 值归一为 Error/String）。describe() 的 crash/lastErrors 由 string[] 升为结构化事实（DiagnosticsCrashFact/DiagnosticsErrorFact，types.ts 出口），构造即脱敏不变——事实只携带身份与文本；cordis ctx.effect 语义固化（effect 体立即执行、返回值才是清理函数）。host-diagnostics 测试台逐 bench 隔离 DSH_HOME（temp home + 构造窗口设 env），18 项全绿（记录、上限、崩溃识别、并发运行、不可解析标记、干净 dispose 摘除标记、跨启动持久、bundle 含事实仍过校验）。api-catalog/doc graphs/event-producer-consumer（host-diagnostics 成为 agent/error 消费者）双语再生，doc-sync 36。per-kind telemetry 出口接线（provider/relay/device-trust/crash 调用 telemetryKindAllowed）仍开放。

## 分类型 Telemetry 同意（§44）

[历史来源记录](artifacts/upstream-first/telemetry-consent-source.json)落地第 44 节可落地部分：dsh-session-telemetry 新增分类型同意词汇——TelemetryDataKind 五类（sessionTelemetry/providerMetadata/relayMetadata/deviceTrustMetadata/crashDiagnostics）、TelemetryConsent 逐类布尔记录、TELEMETRY_CONSENT_OFF 冻结全关默认、telemetryKindAllowed 生产者判断与 resolveTelemetryConsent 解析（缺省与任何非 true 值一律关）；SessionTelemetryBackend 新增 abstract consent 与既有 sharing 并列。dsh-session-telemetry-otel 的 Config 增 consent（schemastery 逐字段布尔校验、缺省全关、非布尔值加载即拒），两种模式下均在构造时解析并经 ctx.sessionTelemetry.consent 暴露，mode/sharing 仍是上传策略。各数据类别生产者接线（provider/relay/deviceTrust/crash 出口调用 gate）与崩溃记录器保持开放。测试 87 项（seam 32 含词汇 4 例、otel 45 含解析 5 例）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。

## Support Bundle（§43）

[历史来源记录](artifacts/upstream-first/support-bundle-source.json)落地第 43 节五要素：producer（service.supportBundle() 以刚组合的 §42 诊断条目为种子并自校验后返回）；sanitizer（闭合条目词汇 + 任意深度递归拒绝 api-key/bearer/secret/password/credential 形状键 + JSON 安全确认，词表外内容绝不入 bundle）；manifest（逐条目稳定路径 + 规范化键序序列化的 SHA-256）；checksum（对有序 manifest 行的链式 SHA-256）；collector validation（重算全部摘要，计数不符/条目缺失/篡改/乱序/链断均大声失败）。输入顺序绝不外泄——条目与 manifest 按路径排序，四平台运行同一候选产出字节一致 bundle（确定性测试固化）。wire 类型位于 ./types 出口、内容为 JsonValue（typert 拒绝 Remote 边界上的无约束 unknown）。测试 140 项（含确定性、脱敏深度、篡改、producer 四类新用例）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。§44 分类型 telemetry 开关以此接缝为基础；G2-SUPPORT 会话日志/设置导出内容条目与四平台真机同候选实测保持开放。

## Host 诊断（§41/§42）

[历史来源记录](artifacts/upstream-first/host-diagnostics-source.json)落地第 41/42 节：新包 @deepseek-ai/dsh-api-host-diagnostics 组合唯一 Typert Remote owner（ctx.hostDiagnostics，能力 host.diagnostics.v1=view，web-app profile 挂载）。health() 回答第 41 节存活/就绪区分——六组件（process/runtime/sessionStore/pluginState/connection/modelProvider）各携带状态与指名被探测服务的 detail，ready 派生自核心组件且排除 connection（CLI/desktop-pipe 无载体 profile 仍是 Host）；探测基于存在性，down 指名缺失的 owner 而非猜测原因。describe() 组合第 42 节载荷——描述符事实（版本/协议/session 格式/hostId/platform/arch/runtimeMode/transports/capabilities）、plugin-inventory 行、按 name/版本对列出的已发布 session-format 迁移链、如实的空 crash/lastErrors（记录接缝未落地）与 health 快照——构造即脱敏：字段集为非秘密事实枚举，键集断言测试固化，无任何 API key/bearer/配对秘密/原始凭据通道。host-preparation 词汇 pin 纳入新能力来源；cordis/doc/config 目录与 capability 图双语文再生；hygiene 16/16（新包 files 清单、knip 依赖边、publint）。测试 589 项（新包 6 项含 §41 就绪与 §42 键集 sanitizer pin、remotes pin 116）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。§43 support bundle 与 §44 分类型 telemetry 以此载荷为基础。

## Composer 连接门禁（§28）

[历史来源记录](artifacts/upstream-first/composer-gate-source.json)落地第 28 节可落地部分：ui-conversation 本就注入 connection 服务，ConversationRoot 新增一个注入 hook——恢复循环状态 observable——任一已定义非就绪 ConnectionState（connecting/reconnecting/authenticating/offline/host-not-ready/auth-expired/device-revoked/identity-changed/incompatible/fatal）使 composer 采用既有 blocked 惰性姿态并显示各状态本地化原因（connection.gate.* 双语键），不会有 prompt 被发往 UI 尚未准备好服务的 Host；ready 与循环未启动保持可用，功能 block 优先于门禁（指明用户必须清除的会话本地原因）。跨 Host 请求外泄由单一代次绑定结构性排除（Host 展示派生自当前世代），§26 载荷级守卫再加一层。多 Host 名册与切换动作需要可重定向连接接缝与外壳投放，仍开放。ui-tool 三处测试台的 connection stub 补齐 state 成员（generation 之外的第二个 observable）。测试 5592 项（另 2 项为本机已核对 Windows 环境类预存失败：ui-deliverables symlink、pdf-license 打包产物）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。

## Web 交接动作 QR 投递面（第 26 节）

[当前来源记录](artifacts/upstream-first/view-handoff-qr-source.json)交付 §26 剩余开放句中的「QR 渲染」子句。规格钉准（双轨并行勘察）：Track A 依赖面——qrcode.react@^4.2.0 已是仓库依赖（ui-settings-devices devDependencies、tsdown 内联、THIRD_PARTY_NOTICES ISC 行已在、纯 SVG 在 jsdom 无需 canvas 桩），浏览器三方实现归 devDependencies 是 packages/client/AGENTS.md 成文规则，无 catalog/policy/web-app 清单变更——零新供应链面；Track B 集成面——HandoffAction 单击流（encode/setLink/copy/dress+title 降级回退）、ScheduleCatalogAction/HeaderOverflowMenu 锚定弹层配方、pairing-panel 的 svg title 断言先例。实现：同一次点击在动作下方打开锚定弹层，把被复制的同一条 #dsh-view= 片段链接渲染为 QRCodeSVG（size 200 marginSize 4，配对面板同参）；弹层逐字复用仓库配方（useAnchoredPosition 向下锚定量测、useDismissOnOutsidePointer 带 portal ref、Escape 关闭并还焦触发器、createPortal 到 body、共享卡片 CSS）；触发器 aria-haspopup="dialog"+aria-expanded，面板与 SVG title 同用本地化 scan 键；剪贴板拒绝的 title 降级回退不变。依赖 devDependencies 增 qrcode/react-dom/@types/react-dom（本包此前无 createPortal 消费者）。车道 handoff.client.spec.tsx 八例（原五例不动+QR portal 渲染/Escape 还焦/外部指针关闭三新例）两连绿；types-lint 0/0、test:docs 17、doc-sync 36（note 首版头格式与语言切换链接两度返修后过）、traceability 6/6（§26 尾句 QR 从外壳工作移入已交付+candidateEvidence 16→17）、审计串行双轮 54 文件/685 测试两连绿（682+3 新例）、gate0 双形态 PASS。本代无 Kotlin/Swift 改动，gradle 验收轮（scanner env+-PdshNativeAcceptance）BUILD SUCCESSFUL 89 任务 2 executed 87 up-to-date（warm 重放），空派生以字节证明：两枚 APK 与 failure-copy 记录 sha256 逐字节一致、core XML 聚合 77 套件/477 测试全绿。深链接、平台分享路由、物理设备及本节其他要求仍开放，不授予整节 PASS。完整目标未完成。

## Client 表面共享 Remote 失败文案（第 45 节）

[历史来源记录](artifacts/upstream-first/failure-copy-source.json)交付 §45「UI 文案统一接入」第一梯队。规格钉准（双轨并行勘察）：Track A 普查出五处无文案的 Remote 渲染簇——ui-conversation steerQueue 与 InputBar promptError toast、ui-goal GoalBar 动作失败、ui-workspace 三对话框、ui-model-selection 双 store；既有分类消费面（QueueDock/DevicesSettingsSection/SubagentHeaderLineage/ui-jobs/ui-deliverables）已达标不动。Track B 划定 provider 码域边界：provider 域开放（任意 string 码、动态 HTTP_*、适配器自由造码）不属 §45 封闭词汇，仅 AUTH 本地化四处消费保留原状；request-inspection errorCode 零消费。裁定：canonical 失败文案九键入 client-locale 的 common 共享词典（failure.authentication/permission/compatibility/conflict/host-state/carrier-invalid/transport/unavailable/raw）——一份词典一个家、无逐包复制漂移；类型面 LocaleKeysOf<N> = NS keys | CommonKeyOf，运行时查找链条目 NS 未命中后咨询 common。新 helper 落 client-locale（新增 dsh-typert-protocol runtime 依赖，无环）：remoteFailureCopy(error, t) 经 classifyRemoteFailure 委托 remoteFailureClassCopy(cls, message, t)（8 类→t('failure.X')，unknown→t('failure.raw', {message})）；rawMessageOf 三分支覆盖 Error、{message} 纯对象（本地失败如 GoalLocalFailure）、其余 String。函数参数逆变以窄联合签名 RemoteFailureTranslate 解决（任一 NS 绑定 t 结构性满足，类型检查强制词典覆盖）。五簇迁移保留两处特例（InputBar 2 个 attachment 码走 attachmentErrorText、session rename conflict 走特征文案——严格更精确）；model-selection 双 store 加 errorClass 字段、三渲染点经 directoryErrorText 类优先。车道 failure-copy.client.spec.ts 四例（类路由×8、unknown raw、四形态分类、双词典九键完整）+goalbar 新增分类与本地失败用例+model-select 新增分类渲染用例，邻域全绿（locale/goalbar/model-selection+catalog/workspace 26 文件 318 测试/conversation 35 文件 464 测试）；types-lint 0/0；test:docs 17、doc-sync 36、pairing 910 对；审计串行双轮全绿；gate0 双形态 PASS；traceability 6/6（§45 remaining「UI 文案统一接入」移出开放清单+第一梯队交付段+candidateEvidence 18→25）。本代无 Kotlin/Swift 改动，gradle 验收轮（scanner env+-PdshNativeAcceptance）空派生以字节证明（两枚 APK 与前代记录 sha256 逐字节一致、core XML 聚合 77 套件/477 测试全绿）。provider 码域本地化、QueueDock 等既有消费面收编、以及本节其他要求仍开放，不授予整节 PASS。完整目标未完成。

## 查看位置 Handoff（§26 第一阶段）

[历史来源记录](artifacts/upstream-first/view-location-source.json)落地第 26 节第一阶段：查看位置载荷（dsh-session-view.v1 前缀 base64url，解析边界对一切语法偏差 fail-loud，ASCII-only 保证浏览器安全编解码）携带 Host 身份（解析边界铸造 HostId 品牌）、SessionId 与含端持久锚点；ClientSessions.encodeViewLocation 在已准入 Host 上捕获载荷（未准入大声失败），openViewLocation 校验载荷恰好指向当前连接的 Host——指向别的 Host 或未准入即在任何请求外泄之前拒绝——随后刷新列表、选中会话、打开并经既有轮次跳转加载器揭示锚点。只转移查看位置，绝不迁移执行 runtime（§27 由架构排除，§11 行已落档）。跨设备投放通道（QR/链接/分享）属外壳工作，保持开放。测试 1630 项（另 2 项为本机已核对的 Windows 环境类预存失败，与上一增量一致）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。

## Follow 续传（§25）

[历史来源记录](artifacts/upstream-first/follow-resume-source.json)落地第 25 节：session.follow 询问新增可选 fromSeq（非负安全整数，边界 fail-loud），Host 在已发布窗口仍覆盖该切割点时从 opening snapshot 省略已覆盖尾部，恰在 cursor、超出 cursor 或受消息数限制的切割回退完整快照；客户端重连与领域 resync 均携带最后已应用条目的含端 seq 重开 follow（RemoteJournalStream 新增 resumeRequest 钩子适配换代 opening 请求，域 resync 直传），换代 replace 变更标记 resumed，域据此把后缀合并到已持有持久窗口之后——续传不缩小已发布窗口、不保留过期瞬态行，assistant 呈现随新 opening baseline 重建；缺口修复仍走完整 tail page。规格示例（revision 201 → 断线 → 从 202 请求）即此路径。cordis catalog、doc graphs、event-producer-consumer 双语行随 wire 变更再生。测试 1627 项（另 2 项为本机已核对的 Windows 环境类预存失败：media-references symlink EPERM、workspace-controller exhausted-carrier-retries 时序）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。

## 审批信息表面（§38）

[历史来源记录](artifacts/upstream-first/approval-facts-source.json)落地第 38 节：user-approval 询问新增可选 Host 评定风险档（ApprovalRisk 四档，随 approval/asked 会话事件持久化），沙箱升权按所请求模式推导（workspace-write=moderate、danger-full-access=high）；浏览器 ApprovalPanel 在决定区旁以事实行列出操作、Host（host facts 的 descriptor.displayName 回退 platform）、工作区、风险档、权限提升原因，命令预览成为关联 Tool 详情 slot 的标题（fact.*/risk.* 双语 locale 键），值缺失的行整行隐藏。client slot catalog、tool-cordis api-catalog、persistence 与 event-producer-consumer 目录随 wire 变更再生。测试 431 项、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。

## 指令风险分级（§37）

[历史来源记录](artifacts/upstream-first/command-risk-source.json)落地第 37 节：CommandDefinition/CommandDescriptor 新增必填 Host 评定 risk 档位（low/moderate/high/critical，注册边界对词表外值 fail-loud），Host 命令层拥有分级、客户端只展示——/permission=high（可切 danger-full-access）、/compact、/goal、/export=moderate、/plan、/feedback=low；描述符经既有 catalog wire 到达客户端，composer 菜单行以 ui-input-trigger 新增的通用 tag 座位渲染尾部徽章（risk.* 四档双语 locale 键），徽章不截断描述。§38 审批 UI 的 Risk 行自此有数据源，完整审批信息表面仍开放。type-equiv 双语文档块、cordis/doc/persistence 目录随 wire 变更再生。测试 593 项、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。

## 运行位置设备命名（§10 收尾）与 §11 第一原则

[历史来源记录](artifacts/upstream-first/host-naming-source.json)接入第 10 节设备命名：host.describe 校验过的 descriptor（含 displayName）本就随 generation 就绪发布（host-preparation 返回它、remote-events 就绪合并展开它、ConnectionHostInfo 经既有声明合并持有可选 descriptor），会话 header 的运行位置 chip 因此在有名字时显示「运行位置 {name} · {platform}」，无 Host-discovery 面的组装回退纯 platform 键——零 wire、服务与夹具改动，一个渲染分支、一对 locale 键、一项骨架用例。§10 traceability 行记命名落地（权限档显示仍开放）；§11 第一原则行如实落档：架构与呈现共同持守——任何设备打开 Session 都是拥有该 Host 的查看端，架构中不存在执行迁移路径，顶栏显式标示执行所在；Follow/Handoff 与多 Host 仍开放。测试 450 项、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。

## 设计语言收口（§9）

[历史来源记录](artifacts/upstream-first/design-language-source.json)把第 9 节收口为单一 token 层并加机械执行：ui-theme design-platform.css 本就声明语义 alias 家族、typography/radius/spacing/ease/duration 原语与深浅两套主题块，本增量新增 design-language 审计——遍历每个 client 包 src 样式表，剥离注释、url() 数据 URI 色板、var() 回退值与 mask-image 透明度渐变后，断言声明中无裸 hex 色值；仍保留字面量的五个文件（ui-workspace Rows 与 ui-primitives HoverCard 的固定暗面、InputBar 静态白发送箭头、JsonTree 语法色板、web pre-theme 启动页）均在文件内注明理由并收敛于审计同步校验的具名允许清单。FileCard removeFailed 的裸 #fff 改为 inverted-label token；手机顶栏状态圆点补 corner-shape: round 配对（既有 corner-shape 跨包审计要求）。测试 127 项（含两项审计用例）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。局限：真机 platform-native 视觉矩阵与验收仍开放（本机无硬件）。

## 手机顶栏（§10 第二个表面）

[历史来源记录](artifacts/upstream-first/phone-top-bar-source.json)补齐第 10 节手机顶栏：strict Session header 在标题簇之前新增 leading 列表座位（SlotMap 合并 + 子注册 + PropsRenderSlots 键，客户端目录再生），ui-sidebar 在其中注册返回会话入口——「箭头+会话」按钮（sidebar 命名空间 phone.backToSessions，双语），与输入框侧抽屉开关共用 max-width 599.5px 媒体查询只在手机档显示，点击打开载有会话列表的悬浮抽屉；运行位置 chip 在 Host generation 已建立时携带状态圆点（6px，state-success-primary），手机顶栏读作「Host ● platform」。overflow 菜单（⋮）如实保持开放——其条目取决于尚不存在的工具栏集合，不预造。测试 473 项（含返回按钮组件/注册用例与媒体查询源级 pin）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。局限：手机档视觉验收依托媒体查询级联（与已封存抽屉开关同层），本机无真机浏览器通过。

## 运行位置可见（§10 首个跨端原则表面）

[历史来源记录](artifacts/upstream-first/running-location-source.json)落地第 10 节运行位置：ready frame 在 home 旁携带 Host Node.js platform——API Remotes 注册 homedir()+platform()，Gateway 产出 host:{home,platform}，client 解析器强制键集精确匹配，ConnectionHostInfo 在已建立 generation 上暴露它（pre-release：无 wire 兼容承诺）。会话页 strict header 的 utilities 行以 locale 键渲染一枚安静的「运行位置 <platform>」chip——数据来自包内 hostFacts observable（ui-conversation inject hooks，对称 ui-workspace 的 useHostInfo 模式；先建的 GlobalStandardProps 全局座位因波及所有 slot props 字面量而被刻意回退）；generation 未就绪即消失，手机端不会误以为命令在本机执行。RemoteMock/夹具默认 platform linux；Kotlin LinkContracts 镜像 ready-frame host；已提交 cordis catalog 再生成。边界外修复（每处先在干净 HEAD 验证失败再修）：四个 client bench（ui-chat apply-inject/chat-apply、ui-tool assembly-surfaces/toolview-slot）自 checkpoint 导入起就未提供其 inject 已要求的 connection 服务——现在提供标准 generation 桩。修改面套件 1559 项通过（一项既有 Windows 环境失败：workspace-controller exhausted-carrier-retries，干净 HEAD 验证为既有）、typecheck、lint 0/0、doc-sync 36、traceability 6/6、gate0 PASS 全绿。局限：手机顶栏 chrome 与 Workstation 式设备命名仍开放。

## 旋转与 Foldable 结构性收口（§8 收尾）

[历史来源记录](artifacts/upstream-first/foldable-frame-source.json)以契约钉住而非新增机制的方式收口第 8 节剩余边界：AppFrame 本就经 ResizeObserver 测量自身盒而非 window.innerWidth，折叠屏窗口尺寸变化因此天然适配——一项行为用例以刻意过期的 innerWidth stub 驱动折叠式变化（框架 900px 而 innerWidth 声称 375，再 500、再 1200）并断言分层只随框架测量走；一项源级 pin 断言 AppFrame 源码不存在任何 innerWidth 读取。旋转依赖同一宽度分层与随方向旋转的 env() 安全区（见安全区增量）；手机/iPad/Android 平板的方向矩阵实测如实保持真机开放（packages/client/ui-layout，124 项测试）。§8 traceability 行刷新；ui-layout 双语 README 补折叠屏句。typecheck、lint 0/0、doc-sync 36、traceability 6/6 全绿。

## 虚拟键盘避让（§8 第二个边界）

[历史来源记录](artifacts/upstream-first/keyboard-avoidance-source.json)落地第 8 节 Virtual Keyboard 边界：AppFrame 订阅 window.visualViewport（resize+scroll），在 scale===1 且可视高度小于窗口高度（键盘遮挡判定）期间把框架元素钉在可视高度——会话底部连同输入区随之保持在 iOS 键盘/Android IME/浮动键盘之上；键盘收起或双指缩放（同样缩小可视视口但属于缩放而非遮挡）时清除内联高度、回到样式表盒。运行时 null/undefined visualViewport 折叠为同一守卫，jsdom 与旧浏览器挂载不受影响。五项 jsdom 用例（带监听器的 stub visualViewport）钉住行为：遮挡期间钉高并跟随后续 resize、键盘收起还原、双指缩放忽略直到 scale 回 1、无 visualViewport 环境不触动、卸载清除钉高（packages/client/ui-layout，全套 122 项）。§8 traceability 行如实刷新（旋转/Foldable 仍开放）。typecheck、lint 0/0、doc-sync 36、traceability 6/6 全绿。局限：真机 iOS 键盘/Android IME/浮动键盘实测保持开放（本机无真机）。

## 移动端安全区适配（§8 首个边界）

[历史来源记录](artifacts/upstream-first/safe-area-insets-source.json)落地第 8 节 Safe Area 边界：页面 viewport 声明 viewport-fit=cover（apps/web/index.html），ui-theme 在 :root 定义四个 --dsw-safe-area-{top,right,bottom,left}=env(safe-area-inset-*, 0px)（普通桌面与无 env() 浏览器一律解析为 0），AppFrame 壳层以四边 padding 收进 Dynamic Island/Home Indicator/横屏边缘，手机档悬浮抽屉与拖拽手柄锚定同一组变量（绝对定位子元素以 padding box 为原点，抽屉在其上再叠加安全区）。六项源级 pin 测试钉住契约（token 声明与 0 回退、框架四边 padding、抽屉/手柄锚定、viewport meta）——jsdom 无法计算 env()，几何主张依托 CSS 级联本身，刘海屏真机视觉验收保持开放。ui-layout/ui-theme 双语 README 更新、§8 traceability 行如实刷新（虚拟键盘/旋转/Foldable 仍开放）。202 项测试、typecheck、lint 0/0、doc-sync 36、traceability 6/6 全绿。

## 分支门禁债务清理（duplication 7 克隆 + hygiene 5 门）

[历史来源记录](artifacts/upstream-first/branch-gate-debt-source.json)清偿设备管理面增量如实记录的既有红：hygiene 16/16 全绿——device-trust 对齐根版本 0.1.5-rc.2 与策略 files 序；ui-deliverables 以 tsdown 构建步骤把 CSS module 复制到 lib/types/client 发射树旁（packageFileExtras 声明 lib/types/**/*.css 策略）并按门序发布 typert 条目；typert-protocol 经 packageFileExtras 声明发布两个生成的失败词表 schema；remotes 客户端 tsconfig 保留进入 ui-deliverables Host 叶的引用并以受审计的 CLIENT_CONFIG_HOST_LEAF_EXEMPTIONS 例外承载（改引 client 叶会因 client 叶闭包回流 remotes 而成项目环）；gateway 的 device-trust 回 dev-only、补 dsh-brand dev 段，ui-sidebar 补 ui-conversation dev 段，依赖策略闭环；acp 测试档 cordis.yml 在本机经硬链接 + skip-worktree 恢复读取（提交树仍是 symlink，未改动）；python sdk 运行时闭包随依赖段落定而闭合。duplication 0 克隆：生成脚本共享 runGeneratorCli、analyzer 共享 sortedGraph、section-store 共享 settlePolicyWrite、ui-cordis 共享 beginAdmittedRegistration；三处跨包生命周期脚手架（workspace-files/documentpreview 准入刷新、两个目录选择器注册、reference/skill 文件页处理器）在客户端包纯度门证明共享助手导入被架构禁止后，以具名理由的 jscpd:ignore 标注收口（每次提取先编译测试全绿、被纯度墙驳回后回退）。受影响套件 1174 项通过，八项 Windows 环境类失败（六个 workspace-files 符号链接、一个 deliverables 符号链接、一个 pnpm ENOENT pdf-license）均已先行干净树验证为既有。typecheck、lint 0/0、doc-sync 36、traceability 6/6 全绿。

## 设备管理设置面（§7-§11 产品线首个增量）

[历史来源记录](artifacts/upstream-first/devices-settings-surface-source.json)落地丢失设备的运维界面：Web 设置新增「设备」分区（packages/client/ui-settings-devices，settings.section 条目 devices、导航序 10），消费 deviceTrust/listDevices 呈现角色色调、客户端声明 platform、配对/最近活跃时间（未准入显示「尚未准入」）、指纹前 16 位与已撤销标记（无操作）；行内 rename（本地拒绝空名、发送前修剪）、需行内确认的单项 revoke 与全部 revoke（完成后报告数量），成功的行内变更触发一次清单重读，失败一律经 classifyRemoteFailure 映射 locale 文案、未分类码保留原始诊断。remote.deviceTrust 生成命名空间挂入 api-remotes 客户端并重导出接缝类型，host preparation 按确切能力准入；分区以 device.list.v1 门控注册、代际变化换组件标识重注册，四个操作经同一 settle 守卫（await 前后查代际，飞行中变化映射 connection changed），formatTime 走注入面（GlobalStandardProps 无 locale 属性）。三个设备码加入共享失败类别映射（device/key-invalid=authentication、device/not-found=unavailable、device/already-revoked=conflict），连接分类器与本分口语义一致；tsdown 客户端纯度门允许 dsh-api-device-trust/capabilities 作为 inline-safe 线层。19 项新测试（组件 12 + 注册 7）、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿。局限：清单无授权变化订阅（刷新按钮 + 变更后重读）；配对签发归引导流程；duplication 7 克隆与 hygiene 5 门为本分支在未触碰文件中的既有红（零 diff 已验证），排队为专项清理增量；iOS 采用开放。

## 设备身份变更确认（第 22 节补全与第 18 节第十一个状态）

[历史来源记录](artifacts/upstream-first/device-identity-confirmation-source.json)补全第 22 节丢失设备清单并让身份变更以确认收口：revokeAllDevices（device.revoke-all.v1，device.admin）撤销全部活跃授权并返回共享时间与数量；renameDevice（device.rename.v1，device.admin）只改显示名不动身份/密钥/角色；列表暴露准入派生的 lastSeenAt 与客户端声明的 platform（Android 配对发送 android、夹具接受）。撤销经类型化事件 deviceTrust/grantsRevoked 播报，网关为每个已准入 Remote 事件流 client 记录 deviceId、事件到达即终止对应流（流测试以 wire end 帧断言；优雅流结束不关 mux socket）。连接面：网关 client 的 classifyFailure 把 device/already-revoked 映射为 device-revoked（修复该状态此前无生产方、不可达的缺陷），device/not-found 与 device/key-invalid 映射为新状态 identity-changed；两者暂停重试并以 locale 键给出重配对指引；device/replay-detected 刻意保持自动重试。码比较为普通字符串匹配（client face 不链接 device-trust 的 details-map 声明，词表按 wire 可合并扩展）。§22 行如实刷新（管理 UI 归 §7-§11）。854 项测试、typecheck、lint 0/0、doc-sync 36、traceability 6/6 全绿。局限：rename/revoke-all 的设置页呈现待 §7-§11 产品线；iOS 采用开放。

## Android 客户端设备准入采用

[历史来源记录](artifacts/upstream-first/android-device-admission-source.json)让 Android LinkWire 为每个业务调用签名设备准入：DeviceAdmission 以配对 Ed25519 密钥对三段式 deviceId
 timestamp
 nonce 签名、每次调用全新 UUID nonce；RPC 信封渲染为 args 旁的 payload.device（网关版本化请求信封的 Link 镜像）、流打开放在 args.device（网关流打开位置）；currentIdentity 收拢配对身份加载；配对与 /link/describe 保持无准入。夹具 Host 经可测的 link-admission 追踪器校验网关语义——四键形状、接受窗口、对配对密钥的签名、带逐条惰性过期与最后接受对的重放账本，nonce 任意时间戳重用与时间戳回退均以 device/replay-detected 拒绝——并在 /api 与 /link/stream 强制准入。模拟器 lane 实证：真实应用 UI 经夹具配对，两条面共五次准入、五个不同 nonce 服务端验证（session/list、workspaceFiles list/read 于 /api；$events 与 workspace/follow 流），分类 gateway/permission-denied 拒绝仍呈现，证明准入校验先于权限门控。:core:test 36/36 + :contract:test + :app:assembleDebug、node --test 5/5、typecheck、lint 0/0、doc-sync 36、traceability 6/6 全绿。局限：夹具账本进程内；iOS 采用开放（尚无 Swift 客户端表面）。

## 设备准入重放 nonce 账本

[历史来源记录](artifacts/upstream-first/admission-nonce-ledger-source.json)把签名准入消息扩展为三段式 deviceId
 timestamp
 nonce：网关 wire 解析器在按请求信封与流打开两条路径上只接受四键 {deviceId, timestamp, nonce, signature}；签名验证后、授权记录新高水位之前，admitDevice 以新错误码 device/replay-detected（reason=timestamp-regressed|nonce-reuse，分类 authentication）拒绝重放——时间戳早于授权持久化的 lastAdmittedAt、nonce 已被本进程准入、或恰等于持久化的 lastAdmittedAt/lastAdmittedNonce 对；持久化高水位对跨重启生效且存储 transform 内重验单调性，进程内每设备 nonce 账本两倍窗口视界后过期。增量同时修复 deviceRoleAdmission 遗留的契约镜像漂移：苹果 schema 夹具（90 分支）与 Swift 守卫（85）自该次推送起不一致且两个原生镜像缺失全部 device/* 码、Swift 自检件一直在失败；现在两镜像以 authentication 携带 device/admission-expired 与 device/replay-detected，Kotlin 钉 92 分支/91 已知码（8/8 通过），Swift 守卫同数，全部夹具在 schema 重生成后刷新。616 项测试、typecheck、lint 0/0、doc-sync 36、traceability 6/6 全绿。局限：先于原始投递的重放仍可成功一次（受窗口约束）；设备时钟回拨在墙钟追上前失败；Swift 泳道由 CI 负责。

## 其余归属方设备权限（第 21 节声明闭环）

[历史来源记录](artifacts/upstream-first/remaining-capability-permissions-source.json)按端点语义为其余全部业务归属方声明设备权限——每个集合本就同质、无拆分、无锁面变化：只读与操作系统面取 view（脱敏设置描述、配置文档、预设目录操作、凭据元数据、workspace-files 七个操作集、presented-file 三操作、session-reference 候选发现、插件清单、LLM 提供方目录与模型发现、agent-preset 目录、命令目录、message-feedback 列表、goal 读取、subagent 目录、dynamic-cordis 清单/Client 源码/inspect 握手）；驱动会话的变更取 prompt.send（设置与凭据写入、文件暂存、preset 选择与管理、命令执行、message-feedback 记录与删除、Session 备注记录、goal 全部变更、subagent 提示词与父级寻址中断、dynamic-cordis 运行生命周期含失败报告与调用）。device-trust 配对引导（redeem/admit）刻意不声明，其规格钉住 issue/list/revoke=device.admin 与引导对不声明；host-preparation 规格断言二十个业务声明来源的每个能力都声明第 21 节词汇内权限，闭环防止未来能力悄悄回退 fail-closed。jobs 为 Host 侧生产者、无 Remote 能力面，无需声明。十七个受影响套件 3236 项测试通过（三处预先存在的 Windows 环境失败类经干净树验证排除）、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿。局限：跨端设备客户端采用与跨发布互通待续。

## Workspace 能力设备权限（第 21 节第二个业务采纳）

[历史来源记录](artifacts/upstream-first/workspace-capability-permissions-source.json)按端点语义声明全部 workspace-controller 能力——每个集合本就同质、无需拆分：workspace.follow.v1 要求 view；workspace.manage.v1（create/rename/delete/insertBefore）与 workspace.sessions.v1（archiveSession/insertSessionBefore）要求 prompt.send（沿用 session 先例：工作区生命周期写入属会话参与）；目录选择器对 native pick 与 browse 声明 view、对 createDirectory（其唯一文件系统写）声明 prompt.send。全仓锁面 grep 未发现整集 pin，仅包内两处能力 deep-equal 补字段。viewer 设备可跟随工作区状态；collaborator 及以上管理注册表、会话顺序与选择器建目录；匿名调用不受影响。664 项测试通过（一项预先存在的 Windows 环境失败经干净树验证排除）、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿。局限：jobs/settings 等其余业务归属方推广待续。

## Session 能力设备权限（第 21 节首个业务采纳）

[历史来源记录](artifacts/upstream-first/session-capability-permissions-source.json)按端点语义声明全部 session-controller 能力并拆分读写集合：只读集合（session.follow.v1、自 manage 拆出的 session.list.v1、session.search.v1、自 model.select 拆出的 model.catalog.v1、file-reference.list.v1、skill.catalog.v1）声明 view；会话变更集合（session.control.v1、cancel-turn、rename-at、manage（现仅 create/rename/fork）、attachment、model.select（现仅 selectModel））声明 prompt.send。持有 view 的设备（所有角色）可跟随、列举、搜索、读目录；prompt.send（collaborator 及以上）门控全部会话变更——与第 21 节矩阵一致；匿名调用不受影响。能力准入映射、host-description e2e 期望与浏览器 fixture 同步两个新 id；网关证据新增 prompt.send 门控用例（viewer 拒绝、collaborator 准入）。856 项测试、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿；一个预先存在的 Windows symlink 环境失败（media-references）经干净树验证与本增量无关。局限：拆分改变广播能力 id（无已发布客户端需迁移）；workspace/jobs/settings 等其余业务归属方的声明推广待续。

## 按请求设备准入（第 21 节远端执行授权）

[历史来源记录](artifacts/upstream-first/per-request-admission-source.json)把授权面裁定落在能力层：TypertRemoteCapability 新增可选 requiredPermission（typert-protocol 词汇 RemoteCapabilityPermission = 第 21 节表格列 view/prompt.send/question.respond/approval.respond/device.admin）；版本化请求信封可在 args 旁携带签名设备准入（{apiProtocolVersion, args, device}，decodeRemoteRequest 剥离保留第三键，版本 1 永不携带），网关按请求经同一 cheapest-first 阶梯验证并按所属能力声明门控端点——角色缺少已声明权限或能力未声明（对设备 fail-closed）在派发前以 gateway/permission-denied（details.role + required / reason undeclared）拒绝，匿名请求不受影响，$events 维持第 15 节流准入治理。首批声明：device-trust 的 issue/list/revoke = device.admin（redeem/admit 先于身份保持未声明）、host 的 describe/negotiate = view；业务服务在各自增量采纳。489 项测试（含八项按请求准入用例与信封编解码测试）、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿。局限：签名仅覆盖 deviceId+时间戳（接受窗口约束跨端点重放，nonce 账本延期），端到端设备客户端尚不存在（测试先行）。

## 协议版本互通矩阵（第 14 节版本轴证据）

[历史来源记录](artifacts/upstream-first/protocol-interop-matrix-source.json)把第 14 节兼容矩阵的版本轴固定为单一规范测试：pins the protocol-version by endpoint-class interop matrix（packages/api/gateway/tests/gateway.host.spec.ts）以真实网关加内联 HostDiscoveryService fixture（host 命名空间、host.describe.v1/negotiate.v1 能力）使两个发现端点可解析，遍历版本 0/1/2/未知与畸形 × 发现端点、业务 RPC、事件结果结算、流打开拒绝行——发现端点准入每个协商层级，业务与事件结果准入 1 与 2（事件结果正格经业务级 interaction-closed 证明版本准入），0 在发现之外得到诊断拒绝消息，未知版本得到通用 gateway/protocol-unsupported；准入版本的流打开行留在流套件。README 以双语言表格记录同一网格。诚实的剩余：跨真实发布版本的互通、设备撤销状态行、闭合错误语义与变更身份确认仍开放（尚无可测的已发布版本）。456 项测试、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿。

## 设备撤销连接状态（第 18 节补全）

[历史来源记录](artifacts/upstream-first/device-revoked-state-source.json)补齐第 18 节状态清单的最后一项：ConnectionState 与 ConnectionSinks.classifyFailure 联合类型新增 device-revoked（与 incompatible、fatal 并列的终态分类——blocked 路径撤回就绪状态并暂停自动重试，直到手动重连或浏览器网络变化），SettingsRoot 以 locale 键 connection.deviceRevoked / deviceRevokedAction（重新配对指引）呈现，连接指示器经既有 blocked 标志显示断开；Phase 7 签名准入的 device/already-revoked 拒绝是其设计触发源，浏览器 generation source 在设备客户端采用 args.device 流打开形式后自然映射。分类器仍归 Gateway 所有，Connection 只拥有调度与状态。十个第 18 节状态现均有双语言 locale-owned UX 文案；253 项测试（含 device-revoked 阻塞分类与设置矩阵行）、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿。剩余：多版本/多语言矩阵、闭合错误语义与变更身份确认。

## 设备角色准入（Phase 7 第三增量）

[历史来源记录](artifacts/upstream-first/device-role-admission-source.json)把角色词表对齐规格第 21 节表格（viewer/collaborator/controller/owner；packages/api/device-trust/src/permissions.ts 的 DEVICE_ROLE_PERMISSIONS 恰好持有表格权限列），新增 admitDevice（device.admit.v1）：对 deviceId+LF+时间戳的 UTF-8 字节做 base64 Ed25519 验签，按代价从低到高检查 not-found→already-revoked→admission-expired→key-invalid，接受窗口 admissionWindowMs 默认五分钟；网关在 Remote 事件流打开接受 args.device（信封内保持版本 2 元数据契约），经 ctx.get 惰性解析 deviceTrust（未组合即不广播设备能力，呈现身份时以 gateway/service-unavailable 大声失败），被准入 client 的回复权限改为其角色权限集——第 15 节 Host 侧 requiredPermission 执行不变。四角色 × approval/question 矩阵经真实 WebSocket 传输双向测试；device/admission-expired 归 authentication 类。489 项测试、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿；Kotlin :contract:test 已知分支计数 84→90 顺带修正了前两增量遗留的漂移。局限：准入绑定流打开（撤销在下次重连生效、无 nonce 账本），按请求业务 RPC 签名延期。

## 设备授权持久化（Phase 7 第二增量）

[历史来源记录](artifacts/upstream-first/device-trust-durable-source.json)把授权从进程内 Map 迁入 device_trust 存储域（packages/api/device-trust/src/spec.ts：defineDomain、DeviceId 键的 grants 表、single 布局、版本 1）：授权在 Host 重启后存活，非法已存记录使 open 拒绝（权威数据不跳过——静默丢失撤销是安全洞）；服务注入 storageDomain、在 [Service.init] 打开域并以 ctx.effect 关闭，读取走域内存表同步状态、写入先落盘。兑换只在持久 put 完成后消费码值（存储失败不烧码），撤销为原子 update（变换内在队列槽位已撤销时抛 device/already-revoked，missing-key 映射 device/not-found）；待定配对码按设计保持进程内——一次性过期机密不得跨重启存活。两个行为测试固定契约：授权（含撤销状态）跨重启存活、待定码值不跨重启存活。Gateway + device-trust 套件 444/444、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿。局限：持久化走组合的 json 后端（<dshHome>/storages），按域路由到 SQLite 为后续部署选择；device/* 码保持未分类，角色映射权限检查与请求签名准入未接线。

## 设备信任接缝（Phase 7 首个增量）

[历史来源记录](artifacts/upstream-first/device-trust-source.json)把审计命名的接缝落成新包 @deepseek-ai/dsh-api-device-trust（packages/api/device-trust/）：ctx.deviceTrust 暴露四个能力门控 Remote 方法——deviceTrust/issuePairing（device-pair.issue.v1）、deviceTrust/redeemPairing（device-pair.redeem.v1）、deviceTrust/listDevices（device.list.v1）、deviceTrust/revokeDevice（device.revoke.v1）。配对码是带配置过期（pairingTtlMs，默认五分钟）的一次性机密：二次兑换 device/pairing-invalid、逾期 device/pairing-expired、非 Ed25519 SPKI DER 公钥 device/key-invalid；兑换登记公钥 SHA-256 指纹入进程内授权存储，列表不含密钥材料，撤销保留记录。角色用第 21 节命名（viewer/collaborator/admin），只命名 Client 下一步；权限执行仍归第 15 节接缝，不开放非 localhost 准入。包组合进 web-app Host bundle，登记 Host 程序、子系统页（七个线上类型 type-equivalence）、doc graph 服务行与目录条目；已知码 schema 增至 89，Kotlin/Swift 契约夹具由再生成投影刷新。Gateway + device-trust 套件 441/441、typecheck、lint 0/0、doc-sync 36 门、traceability 6/6 全绿。局限：授权存储为进程内（持久化为下一增量）；device/* 码保持未分类直到具备跨 Client 语义；签名准入与角色映射权限检查未接线。

## §48 Link 接管审计定案

[历史来源记录](artifacts/upstream-first/link-access-audit-source.json)按规格 §48 的 audit-first 要求定案设备侧接入归属：遗留 packages/remote/link-access、device-trust、link-contracts 保持退役，不从 pre-upstream 树移植；候选网关（@deepseek-ai/dsh-api-gateway + Connection 载体）是设备侧接入的唯一归属，配对与信任以能力门控接缝（§13 风格 device-pair.v1）落在既有网关上而非复活 Link 服务器，网关的准入/能力/权限/失败面对设备与 web/desktop 客户端同权适用；迁入的 Android Link 客户端栈保持为设备侧载体直到候选原生接缝存在，§21 角色表经 §15 Host 权威接缝调和而非沿用 Link 角色命名。审计证据：候选网关现状（/api 载体、能力协商、诊断层级、§15 权限执行、Request metadata is not authorization）、localhost 信任线（§70）、遗留三件套职责清单、以及候选中不存在任何 /link/pair 服务端。Phase 7 顺序由此起步：设备授权存储与配对签发 → §15 接缝角色映射 → 撤销与 lost-device UX；LAN 载体在 TLS/pinning 决策前不开放非 localhost 准入。双语决策笔记（.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit）、doc-sync 36 门、traceability 6/6 全绿。局限：本增量为纯决策落地，Phase 7 首个增量（设备授权存储 + 配对签发）由此排队。

## 模拟器 lane 分类拒绝端到端

[历史来源记录](artifacts/upstream-first/android-refusal-lane-source.json)以随库提交的 Host 侧 Link 夹具（apps/android/support/link-fixture-host.mjs，HTTPS 携带被配对载荷 pin 的自签夹具证书）在本地 AVD 上端到端驱动真实分类拒绝：外壳经自身配对屏完成配对（一次性码值、Ed25519 设备密钥注册），此后每个请求携带经服务端校验的 Ed25519 签名，workspace/follow 流送达工作区记录，列表调用返回夹具文件，被拒绝的 workspaceFiles/read 在文件页呈现类别文案"Host 拒绝了本次调用"（gateway/permission-denied → PERMISSION 类）。驱动该交换修复两处 JVM 测试看不见的外壳缺陷：平台 Conscrypt 不提供 Ed25519 密钥生成（Android issue 399856239），app 捆绑 org.conscrypt:conscrypt-android:2.7.0 并在平台缺失时注册；Files 模型的 workspace/follow 流从未启动，文件页永远为空。生产者侧 failureClass 采纳经调查判为架构空项（所有 job 生产者在 Host 侧运行、RemoteError 不会到达，dsh-sdk provider 在结算前把失败归一化为普通错误），前记录的队列项表述由此更正。Gradle 套件 + :app:assembleDebug、doc-sync 36 门、traceability 6/6 全绿；交换日志、UI dump 与截图随记录归档。局限：夹具是最小 Link Host 而非候选网关（候选不提供 /link/pair，设备侧接入归属仍是 §48 审计决策）；真机与发布签名仍未认定。

## jobs 面失败类别线程化

[历史来源记录](artifacts/upstream-first/jobs-failure-class-source.json)把失败类别线程化到 jobs 面：JobOutcome 与 JobSnapshot 增加可选 failureClass（RemoteFailureClass），本地注册表在结算失败时把类别携带到快照，jobView 投影进 SessionJob wire 类型，ui-jobs 失败行对认证、兼容、可重试与冲突类别呈现类别文案，其余类别与未分类失败保持原始明细（tooltip 保留原始 detail）——第五个共享分类采纳面。jobs-local 66/66（新增结算类别携带用例）、ui-jobs 22/22（新增类别文案与未分类原始明细用例）、typecheck、lint 0/0、doc-sync 36 门全绿。局限：生产者尚未在结算失败时填充类别（bash/子代理生产者为队列项）；模拟器 lane Host 配对夹具仍未驱动真实分类拒绝交换；工具调用错误行保持刻意不分类。

## 队列操作失败分类采纳

[历史来源记录](artifacts/upstream-first/queue-classification-adoption-source.json)把队列 dock 的编辑/删除/插话失败接入共享 Remote 失败分类（ui-conversation 加入 ui-workspace、ui-deliverables 与 ui-subagent 行列）：认证、兼容、可重试与冲突类别给出类别文案，其余类别与非 Remote 错误保持操作的静态失败文案。ui-conversation 套件 447/447（新增分类对静态用例）、typecheck、lint 0/0、doc-sync 36 门全绿。局限：jobs 面需 SessionJob wire 类型携带失败类别（队列项）；工具调用错误行是模型/工具产生的失败而非 Remote 失败，刻意不分类。

## UI 分类采纳广度

[历史来源记录](artifacts/upstream-first/ui-classification-adoption-source.json)把子代理血缘目录的加载失败呈现接入共享 Remote 失败分类（ui-subagent 加入 ui-workspace 与 ui-deliverables 行列）：LinkWire 不再丢弃其本就校验过的信封 details（单次结果与流失败帧两径保留），LinkClientException.Refused 携带 code、envelopeMessage 与结构化 details 透出；GatewayFailurePresentation 消费共享 RemoteFailureClasses 镜像——已知类别得到唯一的下一步动作与呈现文案，词汇表之外的码保持不透明诊断（code 与 message 原样、details 留存信封）；文件查看器先查分类器再走私有 lite-fold 细化。契约测试 + core 185/185（含 LinkClientTest 信封保留用例），:app:assembleDebug 通过门禁，重建 APK 在本地 AVD 安装启动零崩溃。局限：未驱动真实 Host↔设备拒绝交换（需 Host 配对夹具）；呈现文案为外壳本地中文常量（独立模块，不适用 web/desktop 字典模式）。

## 扫描器 AAR 链与 Android 外壳解锁

[历史来源记录](artifacts/upstream-first/scanner-aar-source.json)在本机闭合扫描器 AAR 链：Go 1.27.1 与经 sdkmanager 安装的 NDK 30.0.16248370 按 native/support-scanner/build.json 精确版本运行已提交构建器，产出 8,133,055 字节的 support-scanner.aar（sha256 5af7b7b9…9976），staticVerification PASS（模块图逐 ABI 一致、许可证清单、来源断言、私有路径扫描）；:app:assembleDebug 通过 verifyScannerResources 门禁（回执 sourceSha 与内嵌 manifest 校验），APK 在本地模拟器 AVD 上安装、启动并保持 MainActivity resumed、零崩溃缓冲。不可达的 sum/proxy 端点与 360 主动防御经模块缓存预置（goproxy.cn 镜像）、预置 go.sum、子进程 GOSUMDB=off 与剥离符号链接绕开，内容完整性仍由 ziphash、go mod verify 与来源断言保证（Agent Note 2026-09-20-scanner-toolchain-host-accommodations）。回执中 deviceExecution 仍为 NOT_EXECUTED：扫描器库本体未在设备上调用，冒烟仅覆盖内嵌外壳。

## 浏览器响应式矩阵与手机层抽屉

[历史来源记录](artifacts/upstream-first/responsive-phone-drawer-source.json)以 chrome-devtools 实测矩阵收口 §6/§7 断点族：低于 600px 时框架完全放弃侧边栏轨道（三列显式 grid-column 1/2/3，脱离文档流的抽屉列不再滑动后续轨道），对话区横向占满，展开侧栏以 280px 悬浮抽屉呈现，遮罩点击与 Esc 同径关闭；输入框左端由媒体查询控制的 32px 开关占用 session-maybe 的 conversation.input.left 列表席位，空白首页亦可导航。恰好 600px 回归轨道层，720/960 折叠轨与 1440 桌面布局实测不变。三包 603 项组件测试、lint、typecheck、catalog 与 doc-sync 36 门全绿。视觉通道本会话不可用，验收以观测日志中的 DOM 几何断言为准，截图留存人工复核。

## 诊断层级协议塔量

[历史来源记录](artifacts/upstream-first/diagnostics-only-tier-source.json)把 §14 兼容矩阵的 N-2 行落为网关权威语义：显式 apiProtocolVersion 0 声明诊断层级，请求沿用冻结协议 1 编解码，仅对只读 Host 发现端点（host/describe、host/negotiate）准入；业务 RPC、流与事件结果结算以同一 compatibility 失败（gateway/protocol-unsupported，相同 endpoint 与 supportedApiProtocolVersions 详情）拒绝，Client 呈现常规 incompatible 升级指引。Unknown 版本拒绝语义保持不变。host/negotiate 仍只接受正整数报价，诊断层 Client 无法协商进完整编解码器。Gateway 套件 432/432（解码、RPC 准入、流准入三向），失败码与详情结构未动，信封 schema 与 Kotlin/Swift 镜像保持一致。真实多版本互通矩阵仍是缺口。

Session writer 保持 V3。

## Swift 契约列 CI 证据回收

[历史来源记录](artifacts/upstream-first/swift-ci-recovery-source.json)把 swift-contract lane 的 PENDING_CI 落实为已执行的全绿证据：XCTest 包在托管 macOS runner 上无法稳定构建（macos-14 镜像对任何导入同级 Swift 模块的 SPM 测试目标非确定性失败，最小全新包在两套工具链与串行构建下复现；二十轮探针定界），改为单一可执行目标 dsh-contract-check 以退出码断言同样四项证据（镜像等值 28 码、已分类码均被 schema 声明、未分类解析 unknown、不透明分支排除全部 84 已知码），夹具移至 contract/fixtures/ 由生成脚本刷新。macos-15 lane（Swift 6.1.2，CI run 35450241173 job 105916046840）四项 PASS 全绿，日志随来源记录归档。

镜像不再是可导入的库模块；未来 Swift 外壳消费生成 JSON 投影或在自身模块内重建镜像。Session writer 保持 V3。

## Android core 与 app 迁入契约构建

[历史来源记录](artifacts/upstream-first/android-migration-source.json)把历史 companion 的 core 领域（Lite 折叠、Link/Noise 栈、handoff、支持导出、诊断）与 Compose 外壳原样迁入 apps/android：settings 组合 :contract/:core/:app，根声明 AGP 8.10.1 + Kotlin 2.2.21（apply false），product-version.properties 原样迁移。:core 37 个 JVM 测试类全绿；:app 配置通过；:app:assembleDebug 由 verifyScannerResources 门禁——支持扫描器 AAR（Go+NDK 链）未建，外壳编译证据未声明，模拟器 lane 待门禁解除。

迁入模块尚未消费 :contract，Gateway 失败分类接线随 Gateway 接线增量落地。Session writer 保持 V3。

## Interaction 回复权限的 Host 权威执行

[历史来源记录](artifacts/upstream-first/interaction-permission-source.json)在 Gateway 回复边界落地 §15 requiredPermission 的 Host 权威执行：无对应权限的 Remote 客户端回复以 403 gateway/permission-denied 拒绝，PendingInteraction 不结算、Remote event 投递不消费，底层 Tool 不产生副作用；approval 与 question 两方向均有正反向 fixture 测试（Gateway 套件 431 项全绿）。部署级开关 interactionReplyPermissions 默认双授权，Device Trust 角色化落地后按角色替代。

apps/apple/contract/Package.swift 的 Swift 5.9 尾随逗号修复随本来源记录提交；swift-contract CI lane 待重调度回收首跑结果。原生外壳、模拟器/真机、多版本行为仍未完成；Session writer 保持 V3。

## Swift 契约列与 macOS CI lane

[历史来源记录](artifacts/upstream-first/apple-contract-source.json)在 apps/apple/contract 建立 Swift 包：RemoteFailureClass 枚举与 28 码镜像消费与 Kotlin/TS 同一权威，测试资源由生成脚本从协议包刷新。Swift 侧只固定结构证据——镜像等值、分类 ⊆ schema 已声明码、不透明未知分支排除全部 84 已知码、未分类词解析 unknown；payload 校验仍由 Ajv 与 networknt 列持有，未用脆弱的 Swift 校验器复实现。

ci.yml 新增 swift-contract 作业（macos-14，pull_request/workflow_dispatch 条件下运行 swift test）；本机 Windows 无法运行 swift，该检查在来源记录中如实标记 PENDING_CI，待调度的 macOS lane 回报后由下一来源记录接续。gen-remote-failure-classes-json.mjs 同时刷新 Apple 测试资源，漂移由测试拒绝。

原生外壳、模拟器/真机、多版本行为仍未完成；Session writer 保持 V3。

## 失败分类的扩展与首批 UI 采纳

[历史来源记录](artifacts/upstream-first/failure-classes-adoption-source.json)把共享分类扩展为 9 类 28 码：新增 invalid-input（调用方输入非法，原样重试不可能成功）并纳入 attachment/title/preset/workspace 路径校验码，unavailable 族补充 not-regular-file 与 not-directory。session/steer-unavailable 有意保持未分类——静默跳过消费者具有类检查会不当放大的 owner 语义。

ui-workspace 的会话重命名冲突分支与 ui-deliverables 的呈现文件缺失映射改为消费 classifyRemoteFailure/classifyRemoteFailureCode，对既有码行为不变、同类码按同一语义路由；Kotlin 镜像枚举与映射同步并经 28 码投影等值测试验证。定向 451 项通过（ui-deliverables 的 1 项 symlink 失败为已知 Windows EPERM 环境类，非回归，由 CI 仲裁）；限定 lint、doc-sync 36/36、§45 追踪测试通过。

其余 client 表面、N-2 诊断层级、Swift 列与多版本行为仍未完成；分类仍不授予能力、权限、重试或版本准入，Session writer 保持 V3。

## Kotlin 契约列与 apps/android 起步

[历史来源记录](artifacts/upstream-first/android-contract-source.json)在 apps/android 建立全新 Gradle 工程（Gradle 8.14、Kotlin 2.2.21），首个 contract 模块以 Kotlin JVM 库镜像候选 Remote 失败契约：RemoteFailureClass 枚举与 RemoteFailureClasses.classify 镜像 TypeScript 权威，未收录码解析为 UNKNOWN 不透明呈现；schema 在测试期直接从协议包复制，分类投影由 scripts/gen-remote-failure-classes-json.mjs 生成并提交，漂移由测试拒绝。

8 项 JUnit 测试（networknt 2020-12 校验器）验证 schema 结构（84 已知分支 + 1 不透明未知分支）、5 个真实录制 HTTP payload、未知未来码保持不透明、非法已知码详情被拒、缺 message 被拒、Kotlin 镜像与 TypeScript 投影一致、分类只引用已声明码。双语文档与配对、doc-quick 17/17、doc-sync 36/36 通过。

CI 通道同步解锁：候选分支的 ci.yml 增加 workflow_dispatch 并放宽 job 事件条件（因候选基于 upstream 基线与 origin/master 冲突、PR merge ref 无法创建），已通过 API 调度在分支 ref 上运行九作业 lane。Kotlin 证据仅为本地 JVM 测试，非安装应用、模拟器或真机资格；原生外壳尚未迁入，Swift 列与多版本行为仍未完成。

## Remote 失败码的共享 Client 分类

[历史来源记录](artifacts/upstream-first/remote-failure-classes-source.json)在词汇表 owner @deepseek-ai/dsh-typert-protocol 中建立封闭 RemoteFailureClass 分类：authentication、permission、host-state、compatibility、carrier-invalid、transport、conflict、unavailable、unknown。classifyRemoteFailureCode/classifyRemoteFailure 把码映射到这些呈现语义；映射只收录已有跨 Client 一致含义的 21 个码，可合并扩展词汇表的其余码（包括所有未来码）有意解析为 unknown，按不透明诊断呈现，不推断恢复动作或权限。

网关 client 的 classifyFailure 改为消费该分类：compatibility 投影为 incompatible、carrier-invalid 投影为 fatal，其余类别保持默认重连行为；对原有已分类码的可观察行为不变，133 项网关 client 测试原样通过。scripts/verify-remote-error-model.ts 新增 verifyRemoteFailureClassification，analyzeRemoteErrorWorkspace 在 doc-sync 的 verify-remote-error-envelope 门禁内执行它，分类引用未声明码即失败，分类因此无法脱离清单漂移。

定向 32 项测试（分类单元、协议回归、verifier 门禁）、限定 lint、两面构建导出、envelope 门禁 84 码保持 current、note 格式与双语配对、doc-sync 36/36 通过。新增 Agent Note 记录决策、替代方案、契约与回滚。

以上为本地 TS 证据。其余 client 表面的接入、Swift/Kotlin 投影、多版本行为与 UI 文案统一仍未完成；分类不授予能力、权限、重试策略或版本准入，Session writer 保持 V3。

## 正式 Remote 错误信封 schema

[历史来源记录](artifacts/upstream-first/remote-error-envelope-schema-source.json)以编译器无关错误模型为唯一输入，生成正式 Remote 失败信封 JSON Schema（draft 2020-12，$id=urn:deepseek-harness:remote-errors），并随 @deepseek-ai/dsh-typert-protocol 打包导出。84 个已知码分支各自携带由解析详情根生成的对象 schema；未知码分支保留不透明对象诊断，并以 not-enum 明确排除全部已知码，非法的已知码不能假扮未知码绕过校验。输入投影接受扩展字段，消费方须保留原始诊断对象而不是清洗未知字段。

生成复用 emitRemoteErrorSchemas(face) 的 Zod emitter，经 data URL 在生成期执行 emitter ESM，不另写 TypeScript 解释器；同 face 重复码、未声明 schema、跨面不一致和 Map 原型键碰撞均被拒绝。当前 Zod JSON Schema 转换遗漏元组基数，固定/可选/rest 元组的详情一律使生成失败，未放宽为无约束数组，也未手写近似 schema。doc-sync 中的 verify-remote-error-envelope 门禁取代原 remote-error-model 叶子，校验独立清单、解析详情根、跨面一致与产物新鲜度，叶子总数保持 36。

定向回归 117 项通过、5 项按既有条件跳过；负向控制拒绝过期产物、非 JSON details、元组基数与跨面不一致。plain Node 下 built emitter 与源码输出精确一致，144 个面/码组合全部加载。本地打包协议 tarball（0.1.5-rc.2，未发布 registry）经 Ajv 2020-12 校验器消费：84 分支、五类真实 HTTP payload 接受、五类非法输入拒绝、未知字段保留。

以上均为本地 Node 证据。Swift/Kotlin 消费、旧版已发布 Client、多版本 N/N-1/N-2 行为与设备矩阵仍未验收；本增量未新增运行时 UI、Session 事件或 Session 格式，writer 保持 V3。§45 追踪已加入本 schema 的候选证据，acceptanceProven 仍为 false。

## 可移植校验诊断与解析后的错误详情

[历史来源记录](artifacts/upstream-first/remote-validation-details-source.json)将 gateway/bad-request 的问题条目明确为 code、message、path。Settings、Credentials、Subagent 和目录创建通过协议辅助函数转换；通用 Connection 在自己的 envelope 解析处复制相同字段，保持不依赖 Typert。库专用元数据与附带输入不跨端传输；消息保留拥有方原文，不据此宣称通用脱敏。

错误模型在保留原始类型引用的同时，复用严格 Remote checker 投影，生成独立 Host/Client 的 JSON 详情根。全部 84 码、144 个面/码组合可生成 Zod 与 JSON Schema；60 个两面共有码的 schema 一致。品牌、条件和映射类型经实际生成的 validator 验证；unknown、any、object、bigint、symbol 和可调用详情明确拒绝。完整 schema 尚未发布，转换成功不等于全部 payload 等价或原生兼容。

领域/载体回归 86 项、目录/协议补充 26 项、生成器回归 214 项通过，生成器另有 28 项按既有条件跳过；21 项聚焦检查包含在生成器范围内，不重复累计。隔离的真实 shipped Web Loader Host 对五类 HTTP 校验拒绝录制并重放一份 owner-local 快照，五类实际详情均通过生成 Zod 与 JSON Schema 消费验证，无模型请求。构建后的生成器模型与源码模型完全一致。

初次类型检查发现新 Host 快照误入 Client 编译面，以及遗漏的目录创建生产者。测试已按既有配置归入 Host，556 个误生成文件经时间、源映射与未跟踪状态核对后备份隔离；两面类型检查通过。最初 HTTP 夹具把 subagents 写成单数；修正后又发现 Connection 陈旧 bundle，旧观察保留，按正常构建更新该包并加强 envelope 字段断言后重新录制和回放通过。

最终 doc-sync 36/36、快速文档 17/17、定向 lint、类型、追踪与空白检查通过。未新增浏览器 UI、真实模型、物理设备、签名、安装或发布验收；Session writer 保持 V3。可选元组 schema 等价性、完整已发布详情/envelope、全 Client 一致呈现、多版本和原生矩阵及后续 Phase 仍未完成。

## readonly 数组与元组 schema

[历史来源记录](artifacts/upstream-first/readonly-schema-source.json)补齐既有 Zod 生成器对 readonly 数组和元组的处理：验证元素后冻结解析容器。keyof、unique 及不支持的元素类型仍明确拒绝。109 项 schema 与 Remote codec 测试通过，定向 lint 通过。

实际错误类型图经构建后生成器探测：144 个编译面/错误码组合中 130 个可生成 Zod，129 个可转换为 JSON Schema；这只说明可生成，不证明全部 payload 等价。实际协议版本错误的数字数组在 Host、Client 两侧均验证有效值、拒绝错误元素，并保留解析结果冻结语义；该数组的 JSON Schema 往返也通过。

14 个 Client 跨面引用仍无法直接投影，gateway/bad-request 的宽泛 object 仍被 JSON Schema 转换拒绝，没有改为任意 JSON。首次测试还发现 Zod 4.4.3 的可选元组 JSON Schema 往返会改变接受范围；独立对照确认普通可变元组同样存在，保留失败记录，不宣称该路径已具可移植等价性。

文档聚合为 35/36；为生成器双语 README 补齐一致稳定锚点后，快速文档检查 17/17 通过，链接复核通过。初次中文片段修改造成的配对失败也保留。完整详情 schema、跨平台 Client 一致呈现、多版本互通与 Phase 3 仍未完成。

## Remote 错误详情类型图

[历史来源记录](artifacts/upstream-first/error-type-model-source.json)记录 Typert 的 analyzeRemoteErrors() 投影。它复用独立 Host/Client 编译程序和既有 TypeGraph 转换，直接读取基础错误表及扩展，保留未被 service 或 schema 根引用的错误。Host 有 80 码、Client 有 64 码，合集为 84 码；四项 Client 特有声明不再依赖 Host 图覆盖。

普通 Node 加载构建后的生成器，所得模型与保存的源码模型完全一致。生成器相关回归为 202 通过、28 跳过；投影、清单和调度的 102 项通过与前者重叠，修正 fixture 路径后的 7 项也不累计为新增测试。Host/Client 类型检查及定向 lint 通过。

文档聚合先通过 34 项、失败 2 项；修正中文事件源码行号、中文链接及 fixture 路径后，双语配对和包路径两个失败项均通过，未重新宣称完整聚合 36/36。类型图保留声明结构，尚不是可执行 codec、可移植详情或 envelope schema；完整 §45、原生多版本互通和 Phase 3 仍未完成。

## 已知码语义与历史来源校正

[历史来源记录](artifacts/upstream-first/error-code-schema-accuracy-source.json)将 gateway/result-invalid 的说明收窄为实际产生条件：流方法返回值既不是 Iterable 也不是 AsyncIterable。Gateway 保留弱结果 codec 元数据，不由此宣称一般返回 payload 已被验证；本轮只修改声明说明与生成的 schema，未增加运行时解码器。93 项相关结果、codec 与流测试通过，另有 82 项因名称筛选未执行。

新本地 tarball 内的修正 schema 和双语 README 与源码一致；标准 JSON Schema 消费验证识别 84 码并拒绝五种未知或非码输入。当前新鲜度、四项实际 CLI 负向对照、Gateway 双端类型与六项追踪检查通过。此前生成器、门禁调度和文档证据保留其原始范围；不新增完整聚合、浏览器、原生或真实模型验收。

原报告生成失败还指出历史 profile composition 使用了更新后的 run-gates.ts。已封存旧文件与历史 SHA 完全一致，报告来源选择器已接入该副本；未改写历史预期摘要或跳过校验。原 schema 记录和失败日志保持不变。完整 §45 的跨平台语义、详情验证、Client 一致呈现及兼容矩阵仍未完成。

## 已知错误码 schema 与语义声明门禁

[历史来源记录](artifacts/upstream-first/error-code-schema-source.json)绑定从 14 个拥有方、84 条 RemoteErrorDetailsMap 声明派生的[已知码 JSON Schema](packages/typert/protocol/remote-error-codes.schema.json)。协议包导出并携带该文件；49 条声明补齐失败语义。生成器拒绝重复归属、缺少说明、可选码、开放索引和间接成员，忽略私有嵌套、函数局部及外部模块的同名类型。新鲜度检查与其测试接入 doc-sync 和 test:docs。

102 项生成器和门禁回归通过，五项平台用例按既有规则跳过；最终作用域调整后的 14 项生成器测试另行通过，数量与前者重叠。实际 CLI 的四项负向对照拒绝过期 schema、缺少说明、重复归属和开放索引。最终本地 tarball 中的 schema、导出和双语 README 与当前源文件一致，标准 JSON Schema 消费验证识别全部 84 码并拒绝五种未知或非码输入。

Host/Client 类型、限定 lint、六项需求追踪及空白检查通过。doc-sync 初次 34/35，仅事件关系图源位置过期；重建后原失败门禁通过，未重跑聚合。Publint 无错误，保留原有未发布 src 通配导出警告。四个产品声明文件的去注释 AST 与前一封存相同；本轮无运行时或 UI 行为变化，不新增浏览器或真实模型验收。

该 schema 只识别当前构建的已知错误码，不验证完整错误 envelope 或 details；TypeScript 详情注解只是诊断参考。源码表仍可扩展，未知新版或插件码保留原诊断；码被识别不代表能力已挂载、权限已授予或可以自动重试。Swift/Kotlin 消费、跨版本互通、统一 Client 呈现与完整 §45 仍未完成，完整目标继续 IN_PROGRESS。

## 无效流数据与显式连接恢复

[历史来源记录](artifacts/upstream-first/invalid-stream-errors-source.json)记录无效 WebSocket 帧、事件就绪信息与交互记录的错误分类。Gateway 保留解析原因和流标识，以 gateway/stream-invalid 终止受影响流；事件代次的验证失败发布 fatal，暂停自动协商直到显式重连。真正的载体断开保留既有重试策略，业务错误和交互回答保留策略不变。共享中英文控件显示 Host 数据不可用，并说明自动重试已暂停。

800 项相关回归、七项隔离真实 Host/Windows Chrome 场景和两项既有 Question 录制回放通过。六个新增场景分别向中英文页面注入无效 JSON、二进制帧及无效交互记录，虚拟浏览器时钟前进 60 秒无自动重连，显式恢复后草稿保留且无 Prompt 提交。既有传输中断仍自动恢复；Question 经 dsh web 完成后与原始录制 Session 比较。中英文截图已视觉检查，不代表物理网络、实际设备、新旧发布版本或真实模型验收。

Host/Client 类型、两份 Client bundle、限定 lint、doc-sync 34/34、六项追踪检查通过。初始测试夹具及构建时序错误已修正，失败日志保留；沙箱 tsx ENOMEM 的 lint 与 dsh 回放在主机原样通过。完整 GUI 聚合未重跑。错误表仍允许领域扩展，§45 跨领域闭合语义及完整呈现、多版本/多语言兼容、后续 Phase 和完整目标均未完成，Session writer 保持 V3。

## 交互回复拒绝与协议不兼容恢复

[历史来源记录](artifacts/upstream-first/interaction-reply-errors-source.json)记录内部 interaction-result RPC 的错误保留。除仍按本地完成处理的 interaction-closed 外，失败 envelope 转为保留 code、message、details 的 RemoteError；协议不支持由既有 Connection 状态机进入 incompatible，暂停自动协商。冲突及未知错误沿用既有恢复策略，不新增重试控制器、协议字段或 Session 事件。

740 项 Gateway、Remotes、Connection 回归与两项真实隔离 Host/Windows Chrome 场景通过。浏览器仅将回复请求的协议版本改为不支持的版本，观察实际 Host 拒绝；界面显示 Update required，虚拟浏览器时钟前进 60 秒无自动协商和回答重放。显式重连后同一待决审批恢复，用户重新拒绝才记录一次 rejected。现有双 Client 冲突和交互关闭场景通过。截图已人工视觉检查；这不是实际新旧二进制升级、物理设备睡眠或真实模型、Tool 执行验收。

Host/Client 类型、Gateway Client 构建、限定 lint、doc-sync 34/34、六项需求追踪与空白检查通过。完整 GUI 聚合未重跑；§45 完整错误语义、呈现与兼容矩阵及后续 Phase 仍未完成，Session writer 保持 V3。

## 共享 Client 错误传播与重连候选刷新

[历史来源记录](artifacts/upstream-first/remote-error-propagation-source.json)记录 16 处共享 Client 回调与命令目录等待的错误传播修复。Prompt、Queue、Stop、子会话重命名、模型、命令、权限、技能、搜索、清单和文件读取保留原始 RemoteError 的 code、details、cause，不再转成丢失结构的普通 Error。Gateway 对未知 Host 码保持原值；这不代表当前 Client 已理解未知语义，也不授予额外能力。

1464 项相关回归、五项真实隔离 Host/Windows Chrome 场景通过。中英文清单页收到受控未知错误时显示现有本地化通用失败，显式重试后读取真实 Loader 清单；未知命令错误显示 Host 原始诊断，执行处理器未运行。现有命令/清单能力撤回、迟到结果和不重放检查也通过。新错误由 HTTP envelope 注入，不是实际新旧应用、其他语言 SDK、原生设备或真实模型验收。

浏览器回归发现重连菜单永久等待，封存的旧命令 bundle 也复现相同结果。定向测试证明相同查询的重新识别会更换命中对象，误使排队刷新失效；修复使用既有菜单查询代次和最新范围，不新增状态机，改查询、关菜单与销毁仍会取代旧工作。修复前后的截图、RPC 状态、负向对照以及构建产物恢复摘要均保留。

Host/Client 类型、受影响 Client bundle、打包 PDF 许可检查、限定 lint、doc-sync 34/34、六项需求追踪与空白检查通过。旧 File 测试夹具补齐文件上传能力，权限夹具改为真实 RemoteError；产品准入未放宽。早期 1317 与 281 项测试包含重复场景，不相加。完整 GUI 聚合未重跑，§45 闭合错误语义、完整错误呈现、兼容矩阵及后续 Phase 继续 IN_PROGRESS。

## 传输中断的统一错误语义

[历史来源记录](artifacts/upstream-first/transport-failure-semantics-source.json)记录 Connection 请求发送/正文读取与 Gateway 逻辑流的故障分类。已识别的请求或正文中断，以及逻辑流载体重试耗尽，均使用 gateway/transport-interrupted；请求携带 endpoint，逻辑流携带 stream，只有实际收到 HTTP 响应时才有 httpStatus。JSON 解码和未识别异常仍为内部错误，取消与 Host 业务拒绝保留原有语义。没有更改请求重试策略、业务错误码或 Session V3。

704 项 Connection/Gateway/Session/Workspace 回归通过，包含先前 229 项定向测试，两组数量不相加。真实隔离 Host 与 Windows/Chrome 用例中断 Prompt 后显示正确错误并保留草稿，替换 WebSocket 后请求数保持 1，显式再次提交才增加为 2，已接受用户消息始终为 0。该用例不调用模型；另一项录制 Prompt 去重回放通过。故障由浏览器控制，不证明真实网络拓扑、独立设备身份、旧版应用或真机。

最终 Host/Client 类型、限定 lint、Node/Client bundle、doc-sync 34/34、六项需求追踪与空白检查通过。初次类型编译因新浏览器用例未划入正确编译面，产生 500 个源码旁生成文件；按未跟踪状态、既有封存、编译时间和 source map 逐个核对后移入保留目录，原源码未改动，Client 目录恢复到先前字节。失败检查和浏览器定位修正记录保留。规格 §45 进入 IN_PROGRESS；跨领域闭合错误语义、本地化呈现、完整兼容与 Phase 2/4–12 仍未完成。

## 子 Agent 按轮次停止

[历史来源记录](artifacts/upstream-first/subagent-interrupt-target-source.json)记录 subagent.interrupt-turn.v1 与 subagents.interruptTurnByParent。Client 每次点击捕获 subagentTiming.active.startSeq；Host 先检查持久父子地址，再匹配仍打开的子级自身轮次。过时、null、不存在或已结束的目标均不取消后续工作，继承的父级轮次也不能授权取消子级。缺少目标时，新 Client 不在声明此能力的 Host 上退回旧操作。Host 不增加父 Agent 在线查询，既有 inbox 保留与 FIFO 恢复语义继续成立。

308 项定向测试与 66 项 Client 回归通过，两组包含重复的五项取消测试，数量不相加。真实 Web 的 10 项子 Agent 对话、1 项能力撤回、3 项 Stop 录制与 5 项 Windows Cordis 回放通过。Stop 录制重发首次已接受请求时，第二轮保持运行；新的点击停止第二轮，既有 UI、转录及 FIFO golden 保持只读。父级离线表现通过目录响应控制，不构成物理断开的父级或 Device Trust 证据。模型响应仍是录制/脚本回放。

Timing checkpoint 版本 3 从既有事件重建目标，Session writer 保持 V3，没有新增 Session 事件或通用 mutation ledger。新的 Remote 声明、受影响 bundle、最终类型、lint、依赖与 Client 包规则通过，doc-sync 34/34 及六项需求追踪校验通过。临时录制文件名已与 V3 头一致，版本校验与仓内 golden 未放宽。旧 interruptByParent、旧普通取消和模型祖先中断保留各自当前活动语义；完整兼容矩阵、设备撤销、handoff 及后续 Phase 仍待完成，完整目标保持 IN_PROGRESS。

## 子 Agent Prompt 重复请求识别

[历史来源记录](artifacts/upstream-first/subagent-prompt-idempotency-source.json)记录子 Agent Prompt 的重复请求处理。Host 复用已有 requestId，在子级自身已接受事件中查找原消息 id；并发 Queue/Steer 重试只入队一次，消费或移除后的请求仍确认原消息。Host 内部 subagentPromptReceipts 投影不进入 Client 快照，并排除 fork 继承的父日志。已结束子级及新运行时中的重复请求在恢复激活前完成确认，不重新启动子级；父级权限和取消检查仍保留。

179 项定向测试通过，覆盖继续执行、权限、移除后重试、新运行时恢复、投影 checkpoint、继承与生成目录。真实隔离 Host/Chrome 的 10 项子 Agent 对话录制用例通过：并发 HTTP 重发返回同一消息 id，冷状态重试前后的完整实际子 Session 日志逐项相等。既有组合 UI golden 未更新，模型响应仍为录制回放，不是 live-provider 验收。受影响构建下的 Windows Cordis 5 项回放通过。类型、定向 lint、构建和 doc-sync 34/34 通过；完整需求追踪的六项校验继续通过。

规格 §17 已进入 IN_PROGRESS，按普通 Prompt、子 Agent Prompt、交互、按轮次取消、条件重命名及后续设备/handoff 操作分别定位证据。clientMutationId 是建议字段；本轮没有增加通用 mutation ledger、Session 事件或 wire 字段，Session V3 保持不变。旧取消、子 Agent 中断、设备撤销、handoff 等仍需分别核验，Phase 3/4 与完整目标仍未完成。现有子 Agent 回放中的旧隐藏输入框断言已对齐当前可见且禁用的加载状态，浏览器路径覆盖和等待路由清理也已补齐；这些测试维护不代表新增产品 UI 行为。

## 交互回答的 Host 归属与迟到确认

[历史来源记录](artifacts/upstream-first/interaction-reply-scope-source.json)记录 Gateway Client 回答保留的范围。应用发现将校验后的 HostId 提供为显式回答 scope；只有 scope、待处理 id 和 revision 均匹配时才重发内存中的回答。缺少 scope 或待处理快照时禁用保留，Host 身份变化后重新请求回答。旧连接的迟到成功或 interaction-closed 确认只能清除其发送的那份回答，不能清除替换 Host 的回答。

267 项 Client/准备/发现测试和 178 项 Host/协议测试通过。真实隔离 Web 的 4 个完整 Question 回放覆盖同 Host 接受前后丢失、认证中断，以及受控更换发现身份后重新作答；原录制与完整 Session 比较保持不变。该身份场景使用一个真实 Host 和受控发现响应，不构成双物理 Host 或 Device Trust 验收。公开类型进入生成的 Cordis Client API 目录后，目录相关 6 项单元测试及构建产物的 5 项 Windows Cordis 完整回放通过。类型、定向 lint、依赖与 Client 包规则通过；初次文档检查发现目录过期，重新生成后 doc-sync 34/34 通过。

回答保留仍仅在内存中，刷新或卸载即丢失，不提供授权或持久化回执。没有增加 Session 事件、wire 字段或通用 mutation ledger，Session V3 保持不变。§17 的 Prompt、定向取消、条件重命名、交互与后续设备/handoff 操作仍需逐项核验；Phase 3/4 和完整目标均保持 IN_PROGRESS，既有安装、原生平台、跨版本及发布缺口仍保留。

## 原规格恢复与完整需求追踪

[历史来源记录](artifacts/upstream-first/specification-traceability-source.json)记录原规格恢复和需求追踪入口。[原始文件](artifacts/upstream-first/original-specification.md)来自本任务首次读取命令的完整日志，恢复字节的 SHA-256 与初始 UPSTREAM_DELTA.json 中的 4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80 完全相同。原外部路径缺失不再阻止需求核验；[恢复回执](artifacts/upstream-first/original-specification-recovery.json)保留来源和输出处理方式。

[逐项追踪记录](artifacts/upstream-first/specification-traceability.json)覆盖 0–80 共 81 个编号章节及全部 1,983 行非空原文，包含嵌套旧能力清单、代码示例、矩阵和未编号的 Gate 1–4。它定位候选证据与剩余工作，保留建议、示例、实验和硬性要求的原文语境。当前是需求核验入口，verificationStatus=NOT_STARTED 表示尚未逐项审查本节全部要求，不表示已有实现被删除，也不授予整节 PASS。

六项校验测试拒绝漏章节、漏原文、改写内容、规格 SHA 不符、非法状态、无证据位置和未经审查的完成声明。顶层审计命令同时核对原规格字节、完整源覆盖及报告状态词汇。生成报告仅使用 NOT_STARTED、IN_PROGRESS、BLOCKED、PASS、FAIL、DEFERRED；历史原始回执保持不可变。架构摘要已区分已验证的协议 2/1 局部路径与尚未完成的完整 N/N-1 矩阵。

完整目标仍为 IN_PROGRESS。Phase 2 的安装/插件/升级/原生平台证据、Phase 3 的完整 Error/Idempotency/兼容矩阵，以及 Phase 4–12 的恢复、共享响应式 UI、诊断、Device Trust、Remote、Native、Lite 和同候选发布均继续保留。源覆盖通过不证明这些功能完成。以下历史增量保留其采集时的结果与限制，当前待办需结合完整规格和各专属矩阵核验。

## 上传完整回放与 Harness home 路径表示

[历史来源记录](artifacts/upstream-first/upload-home-replay-source.json)绑定上传完整 Session 回放修复。文件实际保存在隔离 Harness home，旧比较在序列化后直接替换路径，漏掉 Windows 工具参数中的 JSON 转义以及结果里的斜杠路径。Web fixture 适配器按路径字段、工具参数路径属性与 read 结果的 path 标记处理显式 home token：比较前展开预期，再与真实日志完整比较；录制捕获使用理解 JSON 转义的逆向操作。共享 Session 归一化器不变。

范围处理保留精确 home 根、目录后缀、文件名和读取内容；相邻目录、无关参数与普通文本不被改写。13 项单元及 fixture 代际测试通过，覆盖 Windows 原生和斜杠表示、空格/中文/引号、嵌套工具调用、POSIX 字面反斜杠、保留参数空白和错误路径/内容。两项真实浏览器反向对照分别修改预期结果的文件路径和行内容：六个交互用例仍通过，但完整 Session 比较拒绝错误预期；随后恢复原字节。

最终只读浏览器回归包含上传录制、上传能力恢复和 Windows 原生 Cordis，3 个文件、12 个用例及各套件收尾全部通过。上传使用实际字节持久化与真实 read 工具；能力恢复仍采用受控发现与回复交付；模型输出使用录制回放。原上传和 Cordis 录制、预期文件以及共享归一化器逐项哈希不变，没有刷新黄金文件来绕过差异。Host/Client 类型、范围 Lint、两对文档和 doc-sync 34/34 通过。

本项上传完整回放标为 PASS，复用既有产品构建。本轮没有真实提供商、POSIX 浏览器、设备或安装包证据；早先 GUI 聚合未重跑。后续继续其余 HTTP/UI、变更回执、兼容错误矩阵、原生与后台恢复、Device Trust 和后续阶段。原外部规格仍待恢复，完整需求审计不能据当前通过项缩减范围。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或使用子代理，总目标保持执行中。

## Windows 原生 Cordis 完整录制回放

[历史来源记录](artifacts/upstream-first/cordis-native-replay-source.json)绑定 Windows 原生组合的完整 Cordis 回放。官方 Web profile 在 Windows 提供 PowerShell，在 POSIX 提供 Bash；两者模型可见提示词与工具 schema 不同。驱动按实际 Host 平台选择独立 header class，Windows 新增自己的 V3 Session 与完整预期文件，POSIX 原有各代录制和固定文件保持不变。没有修改产品 profile、工具提示词或快照归一化器。

Windows 新归属通过相同已录制模型轮次和真实工具、审批与浏览器生成。审查确认：V3 Session 和 UI 预期与原 POSIX 文件逐字节相同，提示词仅替换 shell 退出说明，工具 schema 仅将 Bash 换成 PowerShell，其余工具逐项相同。随后在只读 replay 模式运行，五个用例与整套收尾均通过，完整持久化 Session、完整提示词、完整工具 schema 和 UI 均严格比较，运行前后 fixture 哈希不变。

两项反向对照分别故意修改 Windows 预期提示词和 PowerShell schema；每次五个交互用例通过但整套在对应固定值比较处失败，恢复原字节后完整回放通过。该对照证明没有跳过或放宽请求头检查。语料归属与存储策略 3/3、Host 类型、范围 Lint、两对文档同步及 doc-sync 34/34 通过。本增量复用上一阶段的 Client 构建，不声称新增产品构建或执行了 PowerShell 中止行为。

本项 Windows 完整回放标为 PASS；先前将 POSIX 固定值用于 Windows 的失败保留为历史证据。这不代表 POSIX 本轮实测、真实模型提供商、Windows CI 矩阵或完整 GUI 聚合通过。上传完整 Session 的 harnessHome 差异与其他阶段仍待处理；Phase 3、Phase 4 和完整目标保持 IN_PROGRESS。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或使用子代理。

## 动态 Cordis UI 与真实浏览器连接恢复（回放仍有失败）

[历史来源记录](artifacts/upstream-first/dynamic-cordis-ui-source.json)绑定清单、面板和 @pluginId 补全的 Connection 归属。无清单支持时不发起读取、不注册入口；只读清单不显示变更控件。Run、Approve、Decline、Stop 和 Remove 分别检查必需操作，拒绝请求不依赖启动能力。每次连接代际变化都替换面板与补全源，即使能力相同；旧读取、回调和补全选择不能修改替换状态。迟到 Remove 不能移除新行，迟到 Stop 不能改变新面板的选择或发布错误。已记录工具卡片仍由 Session 派生。

真实隔离 Host 与 Chromium 场景通过，发现声明和 Stop 回复交付受控，模型调用数为零。场景实际执行纯 Host 启停、双半部加载、拒绝与移除，核对完整变更调用顺序。只提供请求确认时，待审批请求在重连后从清单恢复且仍可拒绝；重连卸载 Client 激活、不自动重放，显式运行才重新加载。Stop 已被 Host 接受但回复尚未交付时断线，旧确认释放后新面板仍保留另一版本选择和输入草稿。这不证明 Host 变更回滚、真实模型提供商、原生设备或跨平台行为。

相关测试为 18 个文件、386 项通过；Host/Client 类型、范围 Lint、生成目录、两个 Client 包构建、依赖刷新及 doc-sync 34/34 通过。最初浏览器失败分别来自空 Session 不在侧栏、零尺寸标记的可见性等待，以及第一次 Stop 未收完回复就重连；驱动分别补充已落盘会话、等待标记挂载和响应完成检查，严格取消计数仍为 1。

录制模型 Cordis 回放在沙箱内遇到 EPERM realpath，使用原命令进行宿主重试后五个用例通过，但整套仍因 system-prompt pin 失败：当前 Windows 进程退出说明与既有录制不同。没有刷新录制 Session、提示词固定文件或放宽归一化来消除差异。因此本阶段整体保留 IN_PROGRESS，浏览器能力验收通过不等于完整录制回放通过。既有上传完整 Session 回放失败和 GUI 聚合 5657 通过、3 失败、1 跳过未重跑。

87 个已选业务 Remote 与 2 个发现引导方法的分类保持不变。后续仍需处理完整回放差异、其余 HTTP/UI 与变更回执、兼容错误矩阵、原生和后台恢复、Device Trust 及后续阶段；恢复原方案外部文件后才能完成逐项需求审计。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或使用子代理，完整目标保持执行中。

## 动态 Cordis 操作准入与 Client 运行时撤回（部分完成）

[历史来源记录](artifacts/upstream-first/dynamic-cordis-runtime-source.json)绑定十二项独立动态 Cordis 操作声明，分别覆盖清单、Host 启动、Client 代码、请求确认、用户结算、停止、移除、inspect 清单与响应、两类失败报告以及调用。每项已选 Remote 在派发前检查精确能力，不以插件清单或普通 Session 控制支持替代。能力不改变 Session 归属、精确运行身份、人工批准与 Host 原有校验，也不使变更具备重试幂等性。

Client 用户双半部运行在首次 Host 激活前检查其必需操作集合；模型驱动的运行要求对应请求确认支持。连接撤回清除旧批准与失败状态，使旧编排步骤失效。迟到的 Host 启动、代码获取、Client 加载与结算结果不再触发后续请求，也不能清除相同 Plugin 的替换尝试。加载引擎清空已加载视图、撤销排队加载，并保留拆除与替换加载的逐 Plugin 顺序；旧 host.call 闭包不能访问新连接。迟到激活会先清理，再允许新加载完成。已被 Host 接受的激活不回滚。

inspect 撤回取消活动查询和排队清单，保留本地 provider 注册。新发布链不等待旧的停滞发布；旧查询结束时只有仍持有该请求 controller 才能清理，避免释放相同 ID 的替换请求。服务销毁后停止查询与发布。不支持的清单和诊断报告不探测 Host。

本阶段为源码、单元行为、类型、Lint 与构建证据：359 项测试通过，Host/Client 类型、范围 Lint、相关构建与依赖检查通过，四对文档同步后 doc-sync 34/34 通过。两次文档失败分别发现配置目录中的源码行号过期及对应中英文配对未同步，均已按生成目录与配对流程修复并保留日志。没有运行新的动态 Cordis 浏览器场景或录制会话快照。

静态清单为 87 个已准入业务方法、2 个发现引导方法、0 个未分类方法；这不证明完整 HTTP/UI 或重连恢复验收。动态 Cordis 面板的独立按钮准入、旧回调隔离、清单撤回、迟到变更回执，以及真实 Host/browser 和录制会话覆盖仍未完成，当前阶段明确标为 IN_PROGRESS。Windows 文件上传完整 Session 快照差异和既有 GUI 聚合失败仍保留；原方案外部路径仍需恢复后才可完成逐项审计。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或使用子代理，完整目标继续执行。

## 插件清单能力与设置页的连接归属

[历史来源记录](artifacts/upstream-first/plugin-inventory-capability-source.json)绑定 plugin.inventory.v1 只读能力、Host 取消读取和设置页注册生命周期。缺少声明时不注册插件列表标签、不探测 Remote；Client Gateway 也在派发前检查声明。能力不授予 Loader 或预设变更权限，不增加历史、变更订阅或第二套缓存。

每次连接拥有独立标签注册与组件身份；替换连接即使声明相同能力，也取消旧读取并丢弃旧搜索、预设选择、卡片展开和菜单状态。保留的旧回调在派发前拒绝，迟到结果不能覆盖替换页面。恢复后按需读取当前 Host，独立输入框草稿保留。Host 在检查前及等待预设发现完成后检查取消，取消请求不返回清单，但不声称中止 roster 内部发现过程。

真实隔离 Host 浏览器用例读取实际 Loader 行，控制发现声明及首次读取的响应送达。首次响应暂留后移除旧行、安装新行，再以相同能力重连；旧请求取消，新页面读到新行，旧响应释放后保留新搜索与展开状态。随后撤回入口并恢复，页面状态清空、输入草稿不变。共三次读取、一次取消，不调用模型。最终构建复验通过，不代表真实模型提供方或原生设备验收。

155 项定向测试通过，Host/Client 类型、范围 Lint、相关构建、依赖和 51 个 Client 包检查通过。四对文档与生成目录同步，doc-sync 34/34 通过。初始类型检查发现 list 未声明取消参数，已补齐 Host 方法与生成 Remote 后通过；该失败日志保留。

已选 Remote 清单推进到 75 个已准入、2 个发现引导、12 个待分类方法，剩余均为动态 Cordis。Windows 文件上传完整 Session 快照差异仍未修复；既有全 GUI 聚合 5657 通过、3 失败、1 跳过也未重跑。原方案外部路径当前不存在，已请求新路径，最终完成审计必须取得原文后逐项核对。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或调用子代理，完整目标继续执行。

## 文件上传能力准入与草稿、回执的连接归属

[历史来源记录](artifacts/upstream-first/file-upload-capability-source.json)绑定独立的 file-upload.stage.v1 声明。生成 Remote 与原始字节载体均在起始连接内准入，缺少能力时不读取 Blob、不创建 Worker、不探测上传端点；连接撤回或服务卸载取消载体，旧进度和回执不能发布到替换连接。共享的能力缺失错误由 Gateway 声明，上传服务不反向依赖应用 Remote 组装。Session 归属、字节存储和回执消费仍由原有 Host 服务负责，能力声明不替代授权。

输入框撤回活动与排队上传，也使已经完成的回执失效，同时保留浏览器 File 对象、图片和文本草稿。能力恢复不会自动重新上传；用户显式点击重试后才暂存到当前连接。缺少能力时本地文件命令显示为图片，选择器筛选图片，普通文件接收被本地拒绝，失败卡片保留移除操作但隐藏重试。选择器回调绑定打开时的 Host；普通消息与命令附件序列化均拒绝跨连接完成。

真实隔离 Host 浏览器用例控制发现声明及原始上传响应送达，不调用模型。原生选择器验证图片独立接收、旧选择器拒绝，以及已完成回执、两个活动上传和一个排队文件的撤回。Host 实际接受前三次上传，旧响应释放不恢复回执，排队文件未派发，支持恢复后仅显式重试产生第四次请求。用户草稿保留；已存储字节不回滚。

360 项定向测试通过，Host/Client 类型、范围 Lint、相关构建、依赖与 51 个 Client 包校验通过，五对文档和生成目录同步后 doc-sync 34/34 通过。初始类型引用缺失导致的 112 个源码旁编译产物，均通过报错路径、Git 与归档排除、生成时间和 source map 核对，并按字节哈希备份后逐个清理。夹具、Lint、选择器、Chromium 缺失和 sandbox ENOMEM/EPERM 的失败日志保持可查。

完整回放仍有明确未通过项：宿主运行中，上传恢复用例和原有模型回放合计七项断言通过，证明字节持久化、真实 read 工具执行与浏览器展示；套件收尾的完整 Session 快照比较因 Windows 原生及斜杠路径没有匹配既有 harnessHome 占位符而失败。未修改归一化器或刷新黄金文件来绕过该差异，不能宣称完整回放通过。没有真实模型提供方或原生设备验收结论。

已选 Remote 清单为 74 个已准入、2 个发现引导、13 个待分类方法。后续继续插件清单与动态 Cordis，并保留 Windows 完整回放、HTTP/UI 矩阵、变更回执、兼容错误、后台恢复、Device Trust 与后续阶段。未重跑全 GUI 聚合，既有 5657 通过、3 失败、1 跳过状态保留。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍未完成。

## Feedback 能力准入与跨连接反馈隔离

[历史来源记录](artifacts/upstream-first/feedback-capability-source.json)绑定消息反馈读取、写入、删除以及 Session 备注记录的四项独立能力。Client Gateway 在派发前检查对应声明；消息 CAS 变更还需要读取支持以取得当前版本。Host 原有的 Session 归属、目标消息校验、版本冲突与持久化保证保持，Session 备注仍只确认日志追加，不承诺落盘刷新或幂等重试。带文本的 Host 反馈命令继续由命令执行能力单独准入。

缺少消息读取能力时不显示入口、不探测列表；只读评分以静态图标呈现，提交与撤回分别要求 put 和 delete 支持。Session 弹窗独立要求 record 能力。Connection 撤回立即清除反馈版本、队列请求归属、弹窗草稿与提示，保留独立消息输入框草稿。排队操作在等待前捕获 Host，旧读取不能释放替换请求，旧 put/delete 回执不能改写新版本，旧对话框成功或失败不能关闭新草稿或发布旧 toast。传输拒绝变为可显式重试的失败；同一连接内主动关闭草稿后的成功确认语义保持。

真实隔离 Host 浏览器用例播种一条已完成助手消息，不运行模型。受控发现声明验证无能力、只读、独立 put/delete/record，以及未提交对话框撤回。一次真实 put 在 Host 提交后暂留响应，连接替换取消送达；新连接独立打开的反馈草稿在旧回执释放后仍保留，没有旧提示。随后实际撤回评分并记录一次 Session 反馈；日志恰为一次 message-put、一次 message-delete 和一次 feedback/record，变更请求也各一次，无自动重放。该证据不说明已接受变更可回滚，也不证明真实提供方或原生设备行为。

Feedback 领域、UI、控制器与弹窗、代际竞态、Remote 准入和 Client 纯度共 284 项测试通过。最终构建后的真实 Host 浏览器复验通过，Host/Client 类型、范围 Lint、相关构建、依赖检查和 51 个 Client 包校验通过。七对双语文档及生成目录已同步，doc-sync 最终 34/34 通过。初始夹具、销毁后上下文访问、Lint、sandbox ENOMEM 和源码别名位置错误均保留失败日志；源码别名已放在手写区域，未修改生成器来豁免检查。

已选 Remote 清单推进到 73 个已准入方法、2 个发现引导方法、14 个未分类方法。后续继续文件上传、插件清单和动态 Cordis 操作与消费者；完整 HTTP/UI、变更回执、兼容错误矩阵、后台恢复、Device Trust 和其余阶段仍未完成。未重跑全 GUI 聚合，既有 5657 通过、3 个 Windows sandbox/前提失败、1 跳过的状态不变。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍在执行。

## Subagent 能力准入与目录、输入、中断的代际归属

[历史来源记录](artifacts/upstream-first/subagent-header-source.json)补充目录不可用时的标题回退：普通 Session 标题由 Conversation 页眉持有，Subagent 插件只为子会话保留文字，避免重复显示父级标题。35 项 Subagent UI 测试、增强后的真实 Host 浏览器场景、Host/Client 类型检查、局部 Lint 与 Client 构建通过。浏览器同时复验目录和提示词撤回、草稿保留、独立 Stop 与一次持久化中断。该局部修正没有重跑下述 925 项回归和 doc-sync；两者保留为已绑定的核心增量证据，完整目标仍未完成。


[核心增量来源记录](artifacts/upstream-first/subagent-capability-source.json)绑定 subagent.catalog.v1、subagent.prompt.v1、subagent.interrupt.v1 三项独立能力及 Client Gateway 操作准入。能力声明只表示 Remote 支持，持久父子归属、在线激活与提供方校验仍由既有领域层负责，提示词和中断没有新增幂等重试承诺。

目录撤回清除缓存、打开菜单、刷新请求归属与父级可用提示，保留持久子级地址、已选驻留 Session 和草稿。目录响应同时绑定起始 Host 和请求槽位，旧结算不能发布旧内容，也不能移除替换连接的新请求。输入区分别解析 Send 与 Stop 能力；保留的 Stop 回调不能跨 Host 或子级地址调用，图片编码期间替换连接会阻止子级提示词派发，旧 prompt 和 interrupt 回执不发布新连接错误或确认状态。

真实浏览器验收发现：父级目录提示被撤回后，旧布局等待逻辑会无限隐藏整个输入区，包括仍可用的 Stop。修复后驻留输入框保持可见，未知父级可用性继续禁用发送，Stop 独立可用，草稿保留。提示语也区分仅缺少发送能力与同时缺少发送、停止能力，目录动作缺失时仍保留身份文字。

真实隔离 Host 启动实际可继续子级，模型调用通过脚本化回放保持等待，发现响应受控撤回目录和提示词能力。浏览器最终验证一次实际 Stop 请求、一次持久化 aborted 轮次、零提示词请求，恢复支持后没有新轮次或自动重放。这是受控模型输出下的真实运行时和浏览器集成证据，不是真实提供方、原生设备或权限边界的完整验收。

最终选定回归为 925 项通过、1 项跳过，共 52 个文件；另一次修正 Connection 夹具后的 159 项复验与其部分重叠，不相加为独立测试总数。真实 Host 浏览器用例通过，Host/Client 类型、范围 Lint、相关构建、依赖声明和 51 个 Client 包校验通过。双语 README、能力决策记录、浏览器说明及生成目录已同步；初始文档聚合的事件图来源行号过期已修正，最终 doc-sync 34/34 通过。初始夹具、选择器、布局、构建过滤和 sandbox 失败保留记录；realpath EPERM 与 tsx ENOMEM 通过最小宿主权限重跑解决，没有放宽产品权限检查。

已选 Remote 清单为 69 个已准入方法、2 个发现引导方法、18 个未分类方法。下一步继续 Feedback、文件上传、插件清单和动态 Cordis 操作集及消费者；完整 HTTP/UI、变更回执、兼容错误矩阵、后台恢复、Device Trust 和后续阶段仍未完成。未重跑全 GUI 聚合，原 5657 通过、3 个 Windows sandbox/前提失败、1 跳过的状态保持。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍在执行。

## Goal 能力准入与目标栏代际归属

[历史来源记录](artifacts/upstream-first/goal-capability-source.json)绑定 Goal 读取、创建、编辑、暂停、恢复、完成与清除的独立能力声明，以及既有 Client Gateway 的请求准入。领域层继续负责 Agent 归属、revision/CAS 和状态转换校验；能力表示对应 Remote 的支持，不替代授权，也不改变命令与模型工具各自的调用策略。

目标栏要求 goal.read.v1，各操作还要求对应能力。缺少读取能力时不探测 API、不显示目标栏；只读 Host 保留目标信息而不提供变更按钮。激活源订阅已有 Connection 代际源，撤销时立即清除旧激活状态，忽略旧读取与无能力期间的事件。动作回调捕获起始 Host 身份，拒绝保留回调跨代际派发，旧成功或失败回执也不能成为新连接的操作结果。传输拒绝被转换为可显式重试的本地错误。

替换权限快照为 GoalBar 提供新的组件 key，明确丢弃旧 Host 编辑器和等待动作状态，消息输入框草稿保持。真实隔离 Host 浏览器用例播种 active 但 disarmed 的 Goal，分别验证无能力、只读、仅编辑及完整支持。真实编辑先提交，暂留 HTTP 回执因重连取消；随后新打开的编辑器草稿在旧回执释放后仍保留，消息草稿不变，持久事件只有 create、edit，没有自动重放。该结果不证明回滚已接受变更，也不涉及真实模型提供方执行。

Commands 浏览器用例增加了连接变更提示的结算屏障，再断言提交文本保留；该用例与 Goal 真实 Host 用例均通过。原 GoalBar keyless 回放最初因缺少 Playwright 默认浏览器而未启动；启动器改为读取既有 DSH_PLAYWRIGHT_EXECUTABLE_PATH 后，两项回放及 fixture 清单检查通过，active/inactive 原有快照不变。keyless Connection fixture 与真实 Host 场景分别记录，未混为实际后端验收。

Goal 领域、UI、代际竞态、Gateway 准入、Connection fixture 与 Client 构建边界共 245 项测试通过。Host/Client 类型检查、范围限定 Lint、相关 Host/Client 构建、51 个 Client 包边界检查及依赖检查通过；新增 Connection 类型依赖只更新一个 UI manifest 和锁文件。中英文 README、能力决策记录、浏览器说明和配置来源行号已同步，doc-sync 34/34 通过。初始 Lint 与旧回放浏览器启动失败日志保留。

已选 Remote 清点为 66 个已准入方法、2 个发现引导方法、21 个未分类方法。后续继续 Subagent、Feedback、文件上传、Host inventory 和动态 Cordis 操作集及消费者，完整 HTTP/UI、变更回执、兼容错误矩阵、后台恢复、Device Trust 与其余阶段尚未完成。未重复全 GUI 聚合，既有三个 Windows sandbox/前提失败仍不标绿。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍未完成。

## Commands 能力准入与代际归属

[历史来源记录](artifacts/upstream-first/commands-capability-source.json)绑定 Commands 目录和执行能力声明、Gateway 准入以及 Client 连接切换处理。command.catalog.v1 与 command.execute.v1 分别由已有命令注册表所有者声明；没有目录能力时不发探测请求，仅有目录能力时不提供可执行 Host 行。独立 Client 贡献项保留自身可用性，Host 装饰要求当前可执行描述符。

Command UI 订阅已有 Connection 代际源，连接撤销时立即清理候选、关闭弹窗并结束等待目录的 Enter 操作。保留的候选和输入提交回调绑定起始 Host 身份，不能在同样具备能力的新连接上执行；旧执行回执不发布本地完成事件，分离执行的旧失败也不产生过时通知。当前提交因连接变化拒绝时保留草稿与附件并提示显式重试。传输取消仍由 Gateway 负责，未引入第二套连接生命周期。

真实隔离 Host 与 Chromium 的五阶段预期输出匹配：无能力、仅目录、完整能力、执行后撤销、恢复且不重放。测试命令处理器真实运行一次，发现能力声明与 HTTP 回执延迟受控；断连后原提交文本保留，恢复后执行请求及处理器次数仍各为一。该验证不代表回滚 Host 已接受的操作，也不是 live-provider、原生 OS 或设备验收。

命令注册表、UI、目录、弹窗、Remote 准入与 Connection fixture 共 320 项测试通过，Client 构建边界另有 25 项通过。完整 Host/Client 类型检查、范围限定 Lint、相关 Host/Client 构建、51 个 Client 包边界检查及 doc-sync 34/34 通过。构建只允许精确的 Commands 能力声明入口，负用例仍拒绝 Host 实现和任意子路径。

初始能力子路径映射、测试错误结果字段、浏览器用例编译归属、Client 内联声明及 Lint 失败日志保留。错误的 Client 编译归属产生 552 个源码目录编译文件；清单记录创建时间和哈希，核对其未跟踪状态及工作区范围后保存字节并逐个清理，未修改已跟踪的 vendor 源码。tsx 的 sandbox 用户信息 ENOMEM 启动失败按相同命令进行 Host 窄范围重试。

本轮未重复 GUI 聚合，上一封存增量仍为 5657 项通过、3 项 Windows sandbox/前提失败、1 项跳过，不能声称全 GUI 通过。已选 Remote 描述符清点为 59 个已准入方法、2 个发现引导方法、28 个未分类方法；接下来继续 Goal、Subagent、Feedback、文件上传、Host inventory 与动态 Cordis 的操作集和消费者，以及完整 HTTP/UI、兼容错误矩阵、变更回执、后台恢复、Device Trust 和后续阶段。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍未完成。

## Session 原生 Remote 入口收敛

[历史来源记录](artifacts/upstream-first/session-native-retirement-source.json)绑定无生产 Client 调用方的 Session 原生 Remote 入口移除。canOpenWorkspacePath 查询已删除；openWorkspacePath 保留为 Host 本地方法，与既有 workspaceDesktop 一起服务声明文件所有者。Client 原生文件操作仍使用 presentedFiles 的持久化文件坐标，由其所有者负责 Session 授权、文件系统到 Host 的路径验证与原生策略；没有增加并行的任意路径入口或兼容别名。

生成的 Client Session 类型排除这三个辅助方法名，Connection fixture 同样拒绝调用。真实隔离 Host 验证匿名请求为 401、已认证旧路径为 404、Gateway 直接派发为 gateway/invocation-unavailable。测试以空路径作为防副作用哨兵：若入口回归，响应将不再满足 404 断言，也不会意外启动原生应用。现有交付文件菜单七阶段快照仍精确匹配，草稿及种子 Session 日志不变；桌面元数据与成功原生响应受控，不构成 OS 应用启动验收。

Host 原生适配器、生成 Client 类型、fixture 派发、认证及文件预览 10 个测试文件 153 项通过。Host 本地打开、显示位置、失败和取消行为的 9 项测试通过；本地派发前保留调用方的原始 abort reason，文档与生成目录已明确此异常语义。UI 预览的负断言针对当前 presentedFiles 原生操作，继续证明预览只进入侧栏。生产源码和 Python 中没有保留旧 Session 原生 wire 调用。

Host/Client 类型检查、范围限定 Lint、相关 Host、Client 和 Cordis 工具目录构建通过。初次 doc-sync 为 33/34，差异仅为 Workspace files 配置来源行号；同步中英文对侧后完整聚合 34/34 通过，最后的 Cordis 目录检查确认 99 个生成文件或区域新鲜。双语包文档、Session API 文档与仍有效的 Sidebar 归属记录已同步；原 Sidebar 记录修改前的字节另行归档。

GUI 汇总为 5657 项通过、3 项失败、1 项跳过。失败仍是 Windows 文件符号链接前提、sandbox 用户目录访问与原生对话框 worker；后两项在上一封存增量的 Host 窄范围复核通过，本轮未重复不受修改影响的系统验证。最终符号链接拒绝断言仍未执行，GUI 汇总不标为通过。初始本地测试转换中的 helper import 错误及配置目录失败均保留日志。

重建的已选 Remote 描述符清点为 57 个已准入方法、2 个发现引导方法、30 个未分类方法。后续继续 Commands、Goal、Subagent、Feedback、文件上传、Host inventory 和动态 Cordis 操作集及消费者；完整 HTTP/UI 覆盖、兼容与错误矩阵、变更回执、后台恢复、Device Trust 和后续阶段尚未完成。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动。

## Settings 代际撤销与权限默认值保存

[历史来源记录](artifacts/upstream-first/settings-generation-repair-source.json)绑定 Settings 镜像即时撤销、权限默认值保存的 Host 归属检查和旧设置测试夹具修复。Settings 所有者直接订阅 Connection generation；连接撤销立即清除共享文档和写入权限，不等待重连完成。权限默认值要求当前代际已接受的描述、读写能力和可写 provider；旧选择不能发送给替换后的 Host，旧成功或错误不能发布到新镜像。

新连接可独立保存而不等待旧连接的延迟响应；旧请求不重放，已提交的 Host 写入不回滚。销毁拒绝新选择并等待已发出的写入结束，销毁后的保留回调也不会读取已撤销的 Context。当前代际的传输错误保留在行状态中，用户可显式重试。测试夹具补齐明确的 Settings 能力与 Connection 订阅，没有放宽生产准入。

Settings、权限、主题、语言及相关消费者 14 个测试文件 156 项通过；最后的权限控制器与销毁回归 17 项通过。GUI 汇总为 5654 项通过、3 项失败、1 项跳过，原先主题、语言和权限设置失败及 5 个未处理错误已消除。剩余用户目录访问和原生对话框 worker 失败有 sandbox EPERM/ENOMEM 证据；两个测试在 Host 原样复核通过。最终文件符号链接测试仍在创建链接时遭遇 Windows EPERM，未进入拒绝断言，GUI 汇总不标为通过。

最终构建的浏览器验证 2 个文件 3 项通过：七阶段快照覆盖可写、旧保存等待、发现前撤销、只读恢复、可写恢复、新保存以及旧响应释放；保留输入草稿，没有自动重放操作。两次权限变更都由隔离真实 Host 写入 settings.yaml。能力描述受控，首次真实变更响应被延迟；不能把此场景称为跨设备或安装产物验收。冷启动仍只发出一次 Settings describe，既有发现准入场景也通过。

Host/Client 类型检查、Client 构建、范围限定 Lint、51 个 Client 包声明检查、依赖策略和 doc-sync 34/34 通过。初始夹具遗漏、测试参数化、异步销毁 Lint 和浏览器未先选择 Workspace 的失败保留日志；修正后的浏览器使用正常目录选择流程。Windows 用户目录读取与原生对话框打开后中止仅构成两个 provider 行为的窄范围实测。

后续继续核实未使用的 Session 工作区原生 Remote 暴露，处理其余 32 个未分类的已选 Remote 方法及全部 HTTP/UI 消费者，再完成兼容与错误矩阵、变更回执、后台恢复、Device Trust 和后续阶段。Session V3 未变；没有提交、推送、发布、迁移用户数据或改变自启动。完整 Goal 仍为进行中。

## Session 搜索与附件读取的独立能力准入

[历史来源记录](artifacts/upstream-first/session-extra-capabilities-source.json)绑定 Session 搜索和持久化图片读取的独立能力声明。session.search.v1 与 session.attachment.v1 由既有 Remote 所有者提供，Gateway 统一执行准入和连接代际取消，不增加第二套连接生命周期。附件读取仍须通过 Session 日志引用授权。

Workspace 搜索在缺少能力时保留本地标题与 Workspace 匹配，不发出内容查询。连接代际撤销会清除内容结果并取消待完成查询；能力恢复后重读当前查询。同能力的新 Host 代际也会使已完成的旧结果失效。查询文本、已选 Session 和输入草稿不因这些变化被改写；旧响应和旧错误不能恢复结果。Workspace Host 信息订阅改为即时的 generation 通知。

相关准入与 Workspace 测试 270 项、Host 搜索与附件授权测试 42 项、Gateway 准入及代际取消测试 26 项、Connection fixture 测试 47 项通过。隔离真实 Host 的浏览器文件 5 项通过，四阶段快照覆盖能力均缺失、仅搜索、仅附件、两者均具备；内容查询只在具备搜索能力时发出。真实 Gateway 拒绝匿名和 schema 无效的搜索、附件请求，种子 Session 日志和草稿未改变。发现描述受测试控制，搜索响应来自真实 Host。构建 Client 的图片装配回放 4 项通过；该回放使用受控 fixture 图片，并补齐 fixture 已实现的 Workspace 能力声明，不等同于真实 Host 附件字节传输验收。

Host/Client 类型检查、相关构建、范围限定 Lint、差异检查与 doc-sync 34/34 通过。Windows sandbox 的 tsx 启动出现 uv_os_get_passwd ENOMEM，相关命令经窄范围 Host 重试通过。初始 Connection 夹具、类型、箭头函数格式、图片测试配置和 Workspace fixture 声明失败均保留日志。

GUI 汇总没有通过：5626 项通过、21 项失败、1 项跳过，并有 5 个未处理错误。PDF 打包许可证检查补齐 Windows pnpm 路径后单独通过；主题、语言、权限设置夹具与原生/系统前提失败仍待处理。九个失败测试文件与本轮前归档或基线一致；此文件比对不证明运行时行为未变，也不能确认各失败的引入时间。没有把 GUI 汇总失败计为通过，也没有完成原生设备验收。

已选 Remote 描述符清点为 57 个有准入的方法、2 个发现引导方法、32 个未分类方法。这不是全 HTTP/UI 覆盖。后续先处理已发现的设置测试问题，核实 Session 工作区原生接口的 Remote 暴露，再继续 Commands、Goal、Subagent、Feedback、文件上传、Host inventory 和动态 Cordis 能力。兼容与错误覆盖、变更回执、后台恢复、Device Trust 及后续阶段仍未完成。Session V3 保持不变，没有提交、推送、发布、迁移用户数据或修改自启动。

## 交付文件的原生 Remote 操作与能力准入

[历史来源记录](artifacts/upstream-first/native-file-actions-source.json)绑定交付文件的原生接口迁移、Client 准入及超时依赖分类修正。既有 ui-deliverables 所有者通过生成式 presentedFiles Remote 提供 desktop、open、reveal，分别声明独立能力。两条旧原生 HTTP 路由已移除，真实 Gateway 的认证和严格参数校验继续负责入口，不增加第二个能力注册表。

Client 仅在声明元数据能力时读取桌面信息，每个原生菜单项还要求对应操作能力和当前代际已接受的桌面信息。缺少条件时移除入口，侧栏预览独立保留。连接替换取消元数据与操作请求、清除临时确认状态并拒收旧结果，不自动重放用户操作。Host 保留持久 Session 声明、当前文件、分叉工作目录及进程路径映射验证；销毁等待尚未结束的适配器，适配器忽略取消并迟到返回成功时也拒绝确认。错误信息不泄露私有 Host 路径。

相关测试 8 文件 210 项通过，单独排除一个无法创建真实符号链接的用例；该用例的 Host 原样复核仍在创建链接时返回 EPERM，尚未到达拒绝断言。依赖策略、Gateway 交互及超时回归另有 3 文件 110 项通过。TimeoutReason 的类身份要求通过共享 peer 依赖保留，既有两项 Gateway 导入分类问题已修正，没有增加可重复安装的安全豁免。Client 包规则检查通过。

最终构建上的两个浏览器文件 10 项通过；原有 POSIX 原生命令场景的两个用例在 Windows 上按原规则跳过。七阶段快照精确比较元数据缺失、只有动作、只有元数据、仅打开、仅显示位置、撤回和恢复时的菜单数量。真实隔离 Host 验证匿名请求拒绝、负索引和不符合 schema 的参数拒绝，以及旧路由 404；草稿与完整种子 Session 保持不变。原生桌面元数据及成功操作响应由测试控制，未启动系统默认应用，不构成原生设备或安装产物验收。

Host/Client 类型检查、范围限定 Lint、Host 与 Client 构建、依赖分类、Client 包检查及最终 doc-sync 34/34 通过。初始迁移 fixture、类型链接、编解码器依赖、生成目录说明与类型归属问题已修正；初次 doc-sync 为 32/34，补齐服务职责分类、配置目录和双语对侧后全部通过。失败日志保留。离线安装最初因沙箱无法访问 pnpm SQLite 存储失败，Host 原样重试成功；未运行安装脚本。

静态比对已选入 BFF 的构建 Remote 描述符：55 个方法有能力准入，2 个是发现引导方法，34 个仍未分类。该清点不调用业务接口，也不涵盖所有 HTTP 路由和 UI 消费者。后续处理 Session 的 search、attachment、canOpenWorkspacePath、openWorkspacePath，以及 Commands、Goal、Subagent、Feedback、Host inventory 与动态 Cordis 的操作集和消费者。完整兼容与错误覆盖、变更回执、后台及原生恢复、Device Trust 和后续阶段仍未完成。Session V3 与模型指引不变，没有提交、推送、发布、迁移用户数据或修改自启动。

## 文件、会话与技能的独立发现能力

[历史来源记录](artifacts/upstream-first/reference-discovery-source.json)绑定三类 Host 发现声明、Gateway 请求准入及 Client 消费者。fileReferences/list、sessionReferenceResolver/candidates、skills/list 分别要求自己的能力，不通过失败请求探测功能。文件和会话来源仍负责引用序列化；撤回发现能力不撤回独立可用的文件预览。

InputTrigger 的候选失效订阅独立于名称词表，连接变化立即取消旧查询、清空候选和面包屑，随后刷新当前菜单并重试去重预热。程序化入口保持单一来源，来源移除或销毁会释放订阅并取消排队刷新。文件和会话查询丢弃旧 Host 响应；技能缓存与连接代际绑定，迟到请求不能恢复旧名称或预览。缺少技能能力时保留已输入的文字及 Host 调用语义。

最终相关测试 13 文件 341 项通过，最终构建上的两个浏览器文件 9 项通过，包含原有引用编辑回放、既有文件预览场景和新增独立发现场景。六阶段快照比较实际文件、会话、技能候选数量；缺少能力时没有对应发现请求，文件引用可继续预览，技能文本在撤回和恢复后保持不变，两个完整种子 Session 的事件保持不变。浏览器使用隔离真实 Host、真实发现提供者及受控能力声明，不替代真实模型、原生设备或安装产物验收。

Host/Client 类型检查、范围限定 Lint、两个 Host 所有者和五个 Client 构建、doc-sync 34/34 通过。初始卸载回调错误、来源路径别名遗漏、测试类型及 Lint 问题、空目标 Session 不显示的浏览器 fixture 已修正，失败日志保留。tsx 路径生成器受沙箱 ENOMEM 限制，原样 Host 重试成功；初始构建过滤只选中 Node companion，最终改为明确选择五个 /client 产物后验证浏览器。

仓库依赖分类检查仍有两项失败：Gateway 的 deadline 与 timeoutOf 导入未被策略分类。源码与本轮前归档一致，策略与 HEAD 一致；此项作为已有未通过结果保留，没有将整套检查报告为通过。下一步处理该分类问题、原生文件菜单发现及剩余能力清单。完整兼容与错误覆盖、变更回执、后台及原生恢复、Device Trust 和后续阶段仍未完成。Session V3 不变，没有提交、推送、发布、迁移用户数据或修改自启动。

## 工具、产物与正文的文件预览准入

[历史来源记录](artifacts/upstream-first/transcript-file-previews-source.json)绑定工具路径、产出文件标签、显式交付卡与收尾正文的预览入口。它们通过既有 Chat、Tool 和 Turn-tail props 共用当前查看器查询，没有新增文件探测请求。查看器撤回时保留文件名、工具结果展开与持久内容，撤回预览按钮和正文链接；保留回调在执行前再次检查。嵌套工具调用经相同查询更新。

显式交付卡移除不可用的卡面预览及左侧预览按钮，保留文件说明和独立的原生菜单；选择原生操作后的焦点在没有预览按钮时回到菜单按钮。原生路径不可用且没有当前查看器时，不再建议使用不存在的侧栏预览。原生操作本身的发现和准入仍属于后续工作。

初始包测试为 769 项通过、19 项失败：18 项是旧的 Client 组合 fixture 未提供查看器注册表，修复后的六个相关文件 128 项通过；嵌套路径和提示补充测试两文件 23 项通过。剩余一项原有 Host 测试在创建临时文件符号链接时返回 EPERM，宿主复核仍相同，尚未到达符号链接拒绝断言；该项保留为受权限限制的未通过证据，没有记为整套通过。

最终构建的三个浏览器文件共 4 项通过，包括原有文件行布局、正文精确匹配和两项能力场景。新增四阶段快照精确比较工具、产出文件、交付卡、正文的实际按钮数量，并核对草稿与完整种子 Session 不变；不可用、恢复、撤回、再恢复均通过，可用时逐个入口能打开内容。原生桌面元数据和 422 拒绝由测试控制，没有启动系统默认应用。原有两个浏览器入口仅增加既有本机 Chrome 选择约定。

Host/Client 类型检查、范围限定 Lint、三个 Client 及目录所有者构建、doc-sync 34/34 通过。早期 fixture 类型遗漏、测试局部变量遮蔽 Node process 和测试查询参数错误均已修正并保留初始日志。浏览器结果是隔离真实 Host 加受控能力声明，原生拒绝是受控响应；不替代真实模型、安装产物或设备权限验收。

下一步处理 Host 的 fileReferences、skills、sessionReferenceResolver 操作声明与消费者、原生文件菜单发现及剩余能力清单。完整兼容/错误覆盖、变更回执、后台/原生恢复、Device Trust 和后续阶段仍未完成。Session V3 不变，没有提交、推送、发布、迁移用户数据或修改自启动。

## 输入框及已发送消息的引用预览准入

[历史来源记录](artifacts/upstream-first/reference-previews-source.json)绑定 Composer、InputTrigger、文件引用、技能和 Chat 的改动。预览入口查询当前 Sidebar 查看器，技能还要求该 Session 的目录已缓存提供方路径；查询和冷点击均不发起目录请求或保留延迟打开。来源、词表和查看器变化会更新可用性，实际打开时再次检查。不可预览的已发送引用显示为标签。临时可用性不进入草稿序列化或 Session 日志。

Chat 通过框架绑定的可观察值更新引用按钮，多个读者共享订阅，最后一个读者离开后释放订阅。可选 InputTrigger 服务的挂载与卸载会更新技能入口。连接替换仍按原有目录规则失效缓存，正常菜单发现重新加载后才恢复技能预览；草稿、技能调用和引用序列化语义保留。

相关单元测试涉及 72 个文件、1028 项。初始集合为 1024 通过、4 失败，失败均来自旧的局部控制器 fixture，且有一项关联的未处理错误；补齐后两个失败文件的 106 项全部通过，后续技能 fixture 调整另有 26 项通过。范围限定 Lint、Host/Client 类型检查、六个 Client 构建、目录所有者构建与 Web shell 构建通过。文档总检初次为 33 项通过、JSDoc 检查失败；补齐三个说明项后单独重跑该门禁通过，没有把这描述为总检重新运行。

最终构建上的两个能力浏览器用例通过，其中新增场景验证不可用、恢复、撤回、再恢复，草稿和 Session 日志不变。原有引用流程最初因 Windows 临时路径在 ARIA 中转义而有一项差异；仅补充该场景已知路径的精确替换后，原有 6 项回放通过，golden 和共享规范化器未改。Question 首轮的子进程因沙箱 uv_os_get_passwd ENOMEM 未启动；相同用例在宿主环境通过，完整 22 条 Session 与工作区比对一致。受控能力声明配合真实隔离 Host、单元生命周期测试和无 Key 回放分别记录，不作为真实模型或原生设备验收。

工具行、产物文件卡片及正文链接仍需审查查看器可用性；Host 的 fileReferences、skills 和 sessionReferenceResolver 操作声明、剩余能力清单、完整兼容/错误矩阵、变更回执、后台/原生恢复和 Device Trust 等后续阶段未完成。Session V3 不变，没有提交、推送、发布、迁移用户数据或修改系统自启动。

## 文件列表与文档渲染器能力准入

[历史来源记录](artifacts/upstream-first/file-ui-capabilities-source.json)绑定文件树、文档预览和 Sidebar 注册表的改动。只有 Host 声明列目录能力时才注册 Files 入口；不能被当前查看器认领的文件仅显示名称。文本分页与完整字节读取分别决定预览器选项，HTML 另外要求关联文件读取。仅完整读取可预览图片/PDF，无需文本读取；文件预览也不要求列目录能力。

文件树和文档注册属于已准入 Host 快照。连接替换会取消旧请求、丢弃旧内容 store，并通过新注册重新读取保留的 tab。单元测试分别证明迟到列表/文本结果不写入、保留回调不再请求，以及旧 HTML 关联文件结果被拒绝。渲染器注册变化通过 subscribeAvailability 通知 Sidebar 类型快照，使文件行更新动作而不替换 tab；订阅启动失败会回滚类型。

47 个文件中的 452 项相关测试通过。最终构建后的两项真实 Host 能力浏览器用例通过，分别验证文件资源恢复与列表/文本/图片/HTML 子集；观测到缺失能力对应的请求为零。既有完整文档预览回放也通过，覆盖 Markdown、隔离 HTML、固有尺寸图片、PDF、代码分页与 Copy，原 fixture 和 golden 未改。Question 回放继续比较完整 22 条 Session 与工作区。最终类型、范围限定 Lint、三个 Client 构建、打包 PDF 许可证检查及文档总检 34/34 通过。

初次 PDF 打包检查缺少 Windows npm_execpath，最终使用已核验的本地 pnpm.cjs。完整预览最初无法启动缺失的缓存 Chromium，改为遵循已有本机 Chrome 选择约定；随后发现系统剪贴板将 LF 转为 CRLF，最终用已知源码先测得系统表示，再精确比较产品 Copy 结果。两项能力用例在包含该启动失败的集合中已通过；完整预览随后独立通过。初始失败日志与截图均保留，不把失败集合描述为整体通过。

新浏览器文件最初误入 Client 编译范围，失败编译于 00:10 在源码旁生成 1092 个输出。已逐项验证未跟踪状态、生成时间、source map、源码对应与工作区路径后归档并移走，字节及清单保留。测试现由 Host aggregate 检查，Client face 明确排除；最终类型检查通过且这些生成路径未重现。先前 native 生成文件未移走。

文件引用、技能和对话记录中的文件入口仍需审查当前查看器可用性；其他能力、完整兼容/错误覆盖、变更回执、后台/原生恢复、Device Trust 及后续阶段未完成。真实浏览器、受控迟到结果、无 Key 回放和未验收的原生/设备权限分别记录。Session V3 不变，没有提交、推送或迁移用户数据。

## 文件操作能力与元数据资源恢复

[历史来源记录](artifacts/upstream-first/file-capabilities-source.json)绑定 Workspace Files 的七项独立操作声明、API Remotes 派发前准入及文件资源生命周期。元数据、列目录、文本分页、字节窗口、完整读取、关联读取与变更观察分别协商；支持一项不意味着支持另一项，也不授予文件系统权限。

Client 仅在 Host 声明 stat 能力时注册文件资源。每次连接快照替换会取消旧注册、移除旧元数据，并为仍被持有的资源重新 stat。缺少 changes 能力时只读取一次元数据，不打开变更流；能力存在时沿用共享 Session 流及 ready 顺序。等待前驱释放期间已取消的后继流不会再发送请求。保留回调与迟到结果不能作用于替代 Host。

相关测试 253 项通过，6 项 Windows 符号链接用例显式跳过。首次集合与宿主原样重试都在这六项创建符号链接时得到 EPERM；另一个旧重叠关闭预期已更新为验证取消后不再打开流。符号链接访问检查尚未在本机通过，本轮不把它们计入验收。

真实隔离 Host 浏览器用例通过：无能力和撤回期间元数据及变更流请求为零；仅元数据模式可读取文件，并在连接替换后发现断连期间的实际文件写入；恢复观察能力后收到真实写入版本。测试显式发出 fs/observed 事件，不代表 OS 文件监听或真实模型执行。最终截图确认文件预览保留已加载内容，元数据重新取得。完整 Question 回放比较原 fixture 的 22 条 Session 记录及工作区，类型、范围限定 Lint、受影响构建和文档总检 34/34 通过。

初次浏览器配置未选中用例、空 Session 没有侧栏、直接写入未发观察事件、误以为 reload 是 disabled、连接状态包含隐藏测量标签等失败日志全部保留。最终用例在已有内容的真实 Session 上点击受保护的 reload，并用请求观察确认撤回后不派发。纯声明模块的精确打包例外通过反向测试拒绝实现包与嵌套路径；配置目录更新了源码行号并确认双语配对。

文件列表、预览渲染器与关联文件入口的按能力隐藏和内容读取生命周期仍待完成。其余能力所有者、完整兼容与错误覆盖、变更回执、后台和原生恢复、Device Trust 及后续阶段继续推进；Session V3 不变，没有提交或推送。

## 目录选择能力与 Gateway 连接恢复

[历史来源记录](artifacts/upstream-first/directory-capabilities-source.json)绑定原生目录选择、目录浏览和目录创建三项独立能力。Host 根据生命周期内稳定的后端种类声明实际支持的操作；未知扩展后端不声明现有操作集。API Remotes 在派发前逐项检查，Workspace 管理能力不能替代目录能力。

原生与浏览 Client 只在对应能力存在时注册入口。浏览仍可用而创建缺失时，隐藏新建文件夹并保留已有目录选择。目录回调捕获已准入 Host 和所属注册生命周期；连接替换或注册释放会取消读取与原生请求，拒绝旧回调和迟到结果。已派发的目录创建可能已经提交，不能据此承诺回滚或变更回执。

1088 项相关单元与组装测试通过。14 项真实浏览器回归包含两个能力用例和全部 12 项 Workspace 管理用例。目录用例实际创建文件夹后替换连接，观察到待响应请求取消、磁盘目录保留、旧交互没有继续列目录或注册工作区；恢复后通过新操作显式接纳目录，并等待其 Session 被选中。原生选择的实际 OS 对话框、Device Trust 和打包桌面不属于本轮验收。

浏览器选中态断言暴露了实际的 Workspace 投影丢失：Host 已保存两个目录及各自 Session，Client 却把新 Session 显示在 Ungrouped，且丢失原有工作区。限定复测在第二次失败后停止；两个确定性 Gateway 用例在修复前失败。Gateway 现在按 ConnectionGeneration 的数字 id 约束流打开与帧交付，丢弃旧连接的 Remote/carrier 失败及迟到帧，并为新连接重置独立重试预算。同连接重试上限不变，未分类本地错误仍终止流。旧测试中持续撤回健康替代连接的 fixture 已纠正。

修复后相关测试、14 项浏览器集合及四次限定目录复测全部通过。最终录制 Question 回放比较完整 22 条 Session 记录与工作区，保持原 fixture。最终类型、范围限定 Lint、受影响 Host/Client 构建和文档总检 34/34 通过；失败截图、观察记录与修复前日志保留并绑定。

初次浏览器失败来自空工作区可编辑态等待、对已取消请求等待正常响应，以及异步查询未等待；已改为观察实际状态。重复连接辅助函数被合并为共享状态。会话中断期间的浏览器和文档检查缺少完整结果，保留了部分日志及 Windows 启动退出码；确认旧句柄和相关进程不存在后重跑，最终以明确退出结果为准。

workspaceFiles、其余能力入口、完整兼容与错误覆盖、变更回执、后台和原生恢复、设备信任及后续阶段仍未完成。先前 GUI 聚合失败和跨平台缺口保持记录；没有提交、推送、迁移用户数据、更改自启动或更改 Session V3。

## Workspace 能力与连接替换

[历史来源记录](artifacts/upstream-first/workspace-capabilities-source.json)绑定 Workspace Controller 的跟随、注册表管理和 Session 组织三项独立能力。Host 通过既有 Typert 绑定声明支持，API Remotes 在派发前检查对应操作集；Session 管理能力不能代替 Workspace 的任何一项能力。

Client 在能力未知时等待，明确缺少跟随支持时进入 unavailable 且不发送跟随请求。连接替换清除旧行、归档集合、排序依据与删除标记；六类写操作的迟到响应返回 gateway/cancelled，不覆盖新投影。Gateway 独自负责流等待与恢复，移除了连接准入时重复的领域重启。

UI 按能力撤回注册表菜单、拖拽、归档与目录接纳入口，已有 Session 仍可浏览，没有操作的行不显示空菜单。Host 快照替换关闭管理弹窗、清空目录流程并忽略旧回调与旧结果；恢复不重新打开旧交互。不可用投影不会清除已保存的工作区展开偏好。已经派发的 Host 请求不因此取消或回滚。

318 项相关测试通过；清理误生成文件和修正测试后，4 个受影响文件的 63 项测试再次通过，计数与前述集合重叠。真实浏览器验证三项能力分别撤回、缺失时无跟随请求与旧行，以及恢复后一次真实重命名。既有 Workspace 管理 12 项回归全部通过。录制 Question 恢复比较完整 22 条 Session 记录和工作区，保持原 fixture 不变。

Host/Client 类型、范围限定 Lint、受影响构建和 doc-sync 34/34 通过。文档总检先于最后的测试专用 Chrome 路径调整，最终类型与该文件 Lint 覆盖此调整。初轮 4 项跟随流失败由重复重启导致，已通过后续完整集合验证修复；源码旁四个编译产物已留存诊断副本并清除。既有浏览器回归首次因默认 Chromium 未安装而全部跳过，改用项目已有的可选 Chrome 路径后 12 项通过。所有初次失败日志保留。

能力声明为受控过滤，业务调用使用隔离真实 Host；这些证据不等于真实模型提供方、原生目录选择、打包桌面、Device Trust 或多 Host 验收。DirectoryPicker、workspaceFiles、其余能力清单、兼容与错误覆盖、变更回执及后续阶段仍未完成。原有 GUI 聚合失败和跨平台缺口不被本轮结果替代。完整目标继续进行，没有提交、推送或更改 Session V3。

## Web-search 凭据与插件卡片保存

[历史来源记录](artifacts/upstream-first/web-search-capabilities-source.json)绑定 Web-search 凭据入口和共享卡片保存生命周期。卡片只在当前命名空间已接受且元数据能力存在时读取凭据；写入能力缺失时隐藏密钥字段，提供方只读时则保留禁用字段。普通配置不依赖凭据能力，可写凭据也独立于只读 Settings 文档。缺失或被拒绝的元数据不能推出可写，已有旧密钥不能把被拒绝的写入变为成功。

Connection 替换释放旧 Web-search 控制器和观察者并清空草稿，保留回调不能写入另一个 Host。同一引用只接受最新元数据响应。共享表单在命名空间失效或销毁后停止未发出的保存步骤，迟到结果不能替换新状态；保存成功只移除本次提交的编辑，保留等待期间的新输入。已经派发的请求不能据此声称被取消或回滚，变更回执语义仍待完成。

180 项相关单测通过。实际浏览器验证 Web-search 能力组合、普通设置持久化、未提交密钥丢弃和恢复后的显式合成密钥保存；密钥只进入隔离凭据存储，没有进入 Settings、DOM、ARIA、控制台或截图。既有插件配置 7 项回归通过，启动读取预算 1 项通过；录制 Question 恢复验证完整 22 条 Session 记录及工作区保持原 fixture。搜索端点没有被调用，这些证据不代表真实提供方或设备权限验收。

插件配置首轮 3 项失败源自写死的 60000ms 默认值及其连带预期；当前 Windows PowerShell 所有者声明的是 120000ms。用例改为从首次 Host 元数据读取默认值，再验证编辑、丢弃和恢复，完整 7 项通过，原界面 golden 未改。最后该测试的类型导入从 Client 装配改为 Settings 所有者的纯类型出口，Host/Client 类型与限定 lint 通过；检查范围内没有误生成的源码旁编译产物。

受影响 Client bundle、API 目录和 doc-sync 34/34 均通过。文档总检发生在最后的浏览器默认值与类型导入调整之前，该测试调整另经最终类型和 lint 复验，没有重复总检。初始测试、类型、lint 和浏览器失败日志保留。

剩余能力所有者与入口清单、完整兼容和错误词汇、Device Trust、后台与原生恢复、变更回执及后续阶段继续进行。原有 GUI 聚合失败与打包桌面、跨平台验收缺口不因本轮结果而消失。没有提交、推送或更改 Session V3 格式。

## Models 与凭据能力控制

[历史来源记录](artifacts/upstream-first/models-capabilities-source.json)绑定 LLM 提供方目录、端点模型发现、凭据元数据及凭据写入四组能力声明。实际 Host 绑定声明支持，Gateway 派发前检查对应所有者能力；Settings 写入不能替代凭据写入，任何声明都不提供密钥读取 API，也不代替提供方权限检查。

Models 入口要求提供方目录和 Settings 读取支持。缺失凭据元数据能力时停止补充读取；缺失凭据写入或模型发现能力时分别隐藏对应控件，普通配置仍可编辑。提供方只读与 API 缺失保持区分，前者继续显示禁用控件。没有密钥输入时，页面改用中英文配置说明。

Connection 替换清除旧目录与命名空间，关闭编辑器并丢弃未提交凭据草稿。编辑器回调绑定发起时的 Host，旧回调与迟到结果不能在新 Host 上继续第二步写入；同一代次的失效通知保持草稿。没有新增连接控制器或 UI 运行时值导出。

扩展单测集合 632 项通过，唯一失败来自新 LLM 所有者测试使用错误的清理方法。改为释放实际插件句柄后，该完整文件 88 项通过，计数有重叠。早期只读 UI 预期失败促使实现恢复了既有禁用控件行为。最终浏览器集合 3/3 通过，覆盖 Models、预设及单次启动读取；另外首次引导与录制 Question 恢复各通过 1 项。完整 22 条 Session 记录和工作区保持原 fixture。草稿只使用临时合成值，截图在其清空后保存，能力用例没有发送凭据变更或端点发现请求。

最终 Host/Client 类型、Host/Client 构建与 API 目录通过。最后限定 lint 仅要求新 JSON 预期值显式标注 unknown，修正后完整浏览器文件通过复验。doc-sync 为 33/34，唯一失败是事件关系图中 LLM 源码指针从 72 行变为 73 行；重新生成英文、同步中文并通过图表和全部 824 个双语配对检查，未重复总检。初始失败日志保留。

Web-search 设置中的凭据编辑器及其他能力消费者、完整兼容与错误覆盖、Device Trust、后台和原生平台恢复仍待完成。本轮证据不能替代真实模型、真实端点、设备权限或打包桌面验收。总目标继续进行，没有提交、推送或更改 Session V3 格式。

## Settings 共享读取与跨连接状态

[历史来源记录](artifacts/upstream-first/settings-mirror-source.json)绑定共享 Settings 镜像、命名空间写入队列与配置文件入口。尚未完成 Host 发现时保持加载状态；明确缺少读取能力时不发请求并标记不可用。启动只在能力准入后发起一次共享 describe。Connection 替换清除旧文档与修订号，有效可写性同时要求 Settings 写入能力与提供方可写。

写入必须基于当前连接已接受的命名空间。初始读取前的操作被跳过，用户需显式重试；排队操作绑定发起代次，旧队列与迟到结果不能写入或更新新连接，也不能带入旧修订号。配置文件入口同时要求当前元数据与文档打开能力，恢复能力不会自动打开系统文件。

相关单测 449 项通过，另有 1 项既有预期失败。两个真实 Web 用例通过，验证能力撤回与恢复以及单次启动读取；首次引导用例验证显式确认持久化、合成凭据只写入和配置后重载，没有模型调用。录制 Question 恢复用例验证完整 22 条 Session 记录和工作区与原 fixture 一致。能力组合由测试过滤实际 Host 发现响应，原生打开由既有测试覆盖层关闭，不能据此认定原生平台已验收。

最终 Host/Client 类型、限定 lint、受影响 Client bundle 和 API 目录通过。doc-sync 总检为 33/34；唯一失败是浏览器测试的可选 Chrome 路径显式传入 undefined，不符合精确可选字段类型。修正后完整 doc-typecheck 门禁通过，未重复总检。早期 fixture、旧行为预期及类型失败日志保留；测试计数不跨轮累加。

本地主题、语言选择与非 loopback 的内存设置保持既有行为。Models 直接编辑操作、凭据能力声明与 UI、其他能力所有者、Device Trust、兼容矩阵与跨平台恢复仍待完成；完整目标继续进行。没有提交、推送或更改 Session V3 格式。

## Settings 操作能力与预设偏好控制

[历史来源记录](artifacts/upstream-first/settings-capabilities-source.json)绑定 Settings Controller 所有的读取、写入、配置文档打开及预设目录四组能力。Gateway 在派发前检查对应操作集，预设目录或管理能力不能替代 Settings 能力。共享声明放在独立纯协议模块；UI 从应用外观获取其类型，没有新增 Client 运行时值导出。

预设页面在 Settings 写入不受支持时禁用选择器策略和默认项，并显示本地化说明。保留回调不写 Settings，也不触发空白 Session 的预设同步。目录能力缺失时不查询目录打开器、不显示位置操作；支持复制的 Host 仍可复制预设，完成后不会调用缺失的目录 API。恢复后，现有 hook 更新控件。

初始相关单测集合 270 项通过；新增覆盖后的集合 272 项通过、1 项因英文 locale 下使用中文内置名称的测试选择器失败。仅修正选择器后，完整界面测试文件 41 项通过，计数有重叠。两个真实 Web 用例验证了实际 Host 声明、缺失能力组合、私有目录中的真实预设复制，以及恢复后的路径显示和默认项持久化。原生打开由既有测试覆盖层关闭，未启动系统文件管理器。额外录制 Question 用例经过实际 Host 401 后恢复，完整 22 条 Session 记录及工作区与原 fixture 一致。

最终类型、限定 lint、Host/Client bundle 及 API/slot 生成目录通过。doc-sync 总检为 33/34；唯一失败是新增 import 使配置目录源码行号从 36 变成 37。已重新生成英文并同步中文，配置目录门禁与全部 824 个双语配对复验通过；未重复整个总检。初始失败日志保留。

能力声明只表示 API 支持，不保证提供方存在、可写、原生桌面可用或设备权限；Host 具体操作继续执行原有检查。Gateway 已覆盖 Settings 声明的方法，通用 Settings、Models、配置文档和凭据等入口的能力 UI 仍未完成。Device Trust、跨平台兼容与错误词汇、后台恢复及其他阶段继续进行；本轮不提供真实模型、打包 Desktop 或原生平台验收。

## Agent Preset 能力声明与入口准入

[历史来源记录](artifacts/upstream-first/preset-capabilities-source.json)绑定预设目录、选择与管理三个独立能力。Host 通过原有 Remote 绑定声明，Client Gateway 在派发前检查共享的方法集合。新增纯协议声明模块的精确允许项，没有新增 UI Client 运行时导出，也没有放宽跨插件实现导入限制。

目录能力缺失时，Settings 入口撤回，不发送名单或目录打开器探测。目录已声明但调用失败仍报告错误。选择能力缺失时丢弃暂存选择，管理能力缺失时隐藏复制、删除并关闭待确认草稿；只读目录继续可用。连接代次变化时关闭旧查看器与管理草稿，旧响应不能恢复它们，迟到的 Settings 写入不能把预设选择带到新连接代次。历史任务继续使用已记录的预设标签。

相关单测集 232 项通过，最终受影响的管理控制器与迟到操作用例 50 项通过；两组存在重叠，不相加为独立测试总数。最终两个真实 Web 用例通过，分别验证控制发现声明下的能力组合和实际 Host 声明。额外录制 Question 用例经过实际 Host 401 与重新发现后完成，完整 22 条 Session 记录及工作区与未修改 fixture 一致。最终类型、限定 lint、相关 bundle、生成目录及 doc-sync 34/34 通过。

初始验证暴露了旧 Client bundle、测试缺少可写目录、选择器不完整以及旧查看器未随连接代次关闭的问题，失败日志均保留。新增浏览器用例最初遗漏 Client 编译排除项，导致 548 个忽略产物生成于源码旁；已核对创建时间、路径、版本控制状态与哈希，仅将这些产物移入隔离目录，并将用例归属修正为 Host 编译。相邻测试还补齐了既有 Gateway 协议归属及 Session 取消、重命名能力的过时预期。录制子进程在沙箱内因 tsx ENOMEM 失败，按同参数宿主重试通过。

本轮能力组合测试控制的是发现声明，不证明设备权限。Settings 偏好、目录操作及其他入口仍需独立能力声明；跨平台错误词汇、Device Trust、后台恢复、打包 Desktop 和原生平台矩阵仍未完成。没有真实模型验收；既有 GUI 聚合失败不被本轮结果覆盖。Phase 3、Phase 4 与总目标保持进行中。

## HTTP 拒绝语义与取消优先级

[历史来源记录](artifacts/upstream-first/http-failure-semantics-source.json)绑定一元 HTTP 请求失败的统一表达。Connection 在实际非成功响应上保留数值状态，Gateway 将 401、403、503 及其他状态分别映射为 gateway/authentication-required、gateway/permission-denied、gateway/host-not-ready 和 gateway/transport-interrupted，均含 endpoint 与 httpStatus。不会从异常消息推断状态，未分类载体异常仍为 gateway/internal，Host 业务错误继续透传。

活动 401 自身触发代际取消时，失败请求保留认证代码；调用者或贡献项取消仍优先。请求派发前和响应到达后检查取消，因此已取消请求不发送，取消后的迟到响应不成为新的认证失败。403 不推断设备撤销，单次 503 不使已就绪连接整体失效，也不触发业务请求自动重放。

185 项 Connection、Gateway 和测试运行时消费者测试通过。403/503/502 使用真实模块组合中的受控 Response 验证；三个录制浏览器场景验证实际 Host 401 下的发现、Prompt 和已完成回答恢复，完整 22 条 Session 记录及工作区与 fixture 一致。最终类型、限定 lint、目录生成、相关 bundle 和文档门禁 34/34 通过。

首次 bundle 因跨 Client 插件运行时导入被纯度门禁拒绝，最终只共享类型与结构标记，识别函数归 Gateway 本包，无新增 Client 运行时导出或规则豁免。初始构建及 lint 失败日志保留。本轮没有证明真实 Host 403/503 故障、完整跨平台错误词汇、设备授权、自然过期、打包 Desktop 或真实模型；既有 GUI 聚合失败仍保留。Phase 3、Phase 4 与总目标继续 IN_PROGRESS。

## Connection 认证中状态

[历史来源记录](artifacts/upstream-first/authenticating-phase-source.json)绑定 authenticating 状态及真实 Host 检查。Host 发现通过 Connection generation source 的进度回调，在 host/describe 检查访问权限前显示认证中，响应成功后回到首次 connecting 或重试 reconnecting，再等待事件 ready 帧。没有增加认证请求、凭据展示或第二套控制器。就绪、取消、替换之后的进度被忽略，慢握手提示不会被后续进度提前清除。

Gateway 在调用发现回调前记录本次尝试是否从首次 connecting 开始，允许初始连接等待认证；重试显示 authenticating 时仍在发送前拒绝新业务操作，恢复后不重放。状态 listener 同步停止、重连或离线的路径有定向回归。展开侧栏和收起轨道都提供本地化认证提示、无障碍说明及重连操作。

官方 Web profile 暂停前两次真实 host/describe 请求，分别观察首次与重连认证中状态，并验证首次认证前没有业务请求；随后完成原 Question，22 条完整 Session 记录和工作区与 fixture 一致。最终构建还通过原连接阶段和真实 401 回答恢复两项场景。六个定向测试文件首次 277 通过、14 失败，原因是旧 Gateway 替身缺少必需的 Connection.state；修正后 Gateway 122 项通过。最终慢握手保护及相邻 TestClient、Settings 消费方 86 项通过。类型、限定 lint、相关 bundle、目录生成和文档门禁 34/34 通过。旧类型与 lint 失败日志保留。

第 18 节仍缺有 Device Trust 生产与执行支撑的 device-revoked；统一错误语义、完整兼容与平台矩阵、后台/休眠恢复仍待完成。本轮不代表设备授权、自然过期、真实模型、打包 Desktop 或跨平台验收，也不替代既有 GUI 聚合失败。Phase 3、Phase 4 和总目标继续 IN_PROGRESS。

## 认证暂停期间的回答完成、竞争与取消

[历史来源记录](artifacts/upstream-first/authentication-resolution-source.json)绑定四项新增浏览器场景。Question 回答被 Host 接受后丢失确认并移除 Cookie，重新发现得到真实 401；另一个场景让独立认证的 Client 在原页面暂停恢复期间提交不同答案。两者重新认证后都不重发原回答，Host 保持唯一结果；竞争场景额外拒绝迟到的旧答案。两项完整 22 条 Session 记录及工作区与原 fixture 一致。

Approval 与 Question 的取消场景在首次回答得到真实 401 后，由独立 Cookie context 中的 Client 通过公开 RPC 取消原回合。重新认证后没有重发旧答案，审批副作用文件不存在，持久化终结原因是 aborted。新回合拒绝旧答案与重复旧取消，仍可提交新决定并 completed。这两项采用本地模型 fixture、持久事件断言和文件检查，不冒充完整录制 Session 比较或真实模型验收。

新增 4 项、相邻 Question 3 项和原有取消 4 项共 11 项浏览器测试通过，类型、限定 lint 与文档门禁 34/34 通过。首次旧取消筛选全跳过，修正筛选后实际运行 4 项；两处回调括号 lint 失败已修正，原日志保留。未修改运行时源码和构建产物，既有 GUI 聚合失败没有被本轮覆盖。

这批证据不覆盖自然 Cookie 到期、设备角色与撤销、OS 休眠或移动后台；也不将浏览器内存回答保留升级为持久化回执。第 18 节仍缺 authenticating 与有实际授权执行支撑的 device-revoked，统一错误语义及完整平台矩阵仍待实施。Phase 3、Phase 4 与总目标继续 IN_PROGRESS。

## 认证失效期间保留的 Question 回答

[历史来源记录](artifacts/upstream-first/answer-authentication-source.json)绑定真实 Host HTTP401 后的已完成回答恢复证据。官方 Web profile 场景在回答送达前移除浏览器 Cookie，将请求转发给真实 Host 并取得 401。客户端显示未认证并暂停恢复；重新使用启动链接认证并手动重连后，Gateway 只为 Host 再次投递的匹配 pending id 和 revision 重发内存中保留的回答。

用户只提交一次回答，HTTP 回答请求共两次，Host 最终只记录一次工具调用和一次结果；完整 22 条 Session 记录及工作区与原 fixture 一致。原有 discovery 与 Prompt 认证场景同时回归通过，Prompt 仍需显式重新提交。本轮没有修改运行时代码，类型、限定 lint 和文档门禁 34/34 通过；既有 GUI 聚合失败保留，不以本轮测试替代。

本项覆盖 Host 接受回答之前的 Cookie 缺失。接受后丢失确认、认证暂停期间取消或其他 Client 竞争、自然过期、设备撤销仍无本项证据；内存保留不跨刷新，也不是持久化回执。authenticating、设备授权执行、HTTP503 与平台兼容性矩阵仍待完成，Phase 3、Phase 4 及总目标保持 IN_PROGRESS。

## 首次连接、就绪、离线与重连

[历史来源记录](artifacts/upstream-first/connection-phases-source.json)绑定同一个 Connection controller 的 connecting、ready、offline、reconnecting 状态。首次获取 source 前发布 connecting；状态回调同步停止、重连或离线时重新检查生命周期，停止后的微任务不会获取 source。Gateway 只允许首次 connecting 等待就绪，恢复期间的新业务调用在发送前拒绝，不排队等待未来连接。Settings 的展开侧栏与窄栏均显示本地化状态及操作；不同语义标签按自身内容确定宽度，同一按钮悬停时保持尺寸。

官方 Web profile 录制场景暂停真实 ready 帧，依次观察首次连接、就绪、真实浏览器离线、恢复重连。离线推进 60 秒没有新 socket；恢复后完成原 Question 与回答丢失恢复，完整 22 条 Session 记录及工作区与未修改 fixture 一致。四种状态截图已人工查看。

292 项定向测试首次运行有 1 项旧 assembly 预期失败，修正为首次 connecting 不提前发出 workspace/follow 后，该文件 12 项通过；另补强停止后不获取 source 的回归并通过。类型、限定 lint、相关 bundle、文档门禁 34/34 通过。旧浏览器的 launcher、首次 Prompt、连接恢复 3 项通过：首次 Prompt 的旧 ARIA 依赖前序编辑器清空操作，单独筛选时会出现 paragraph 差异；恢复测试现在等待 discovery 后真实事件订阅再关闭 socket，保持精确重试次数和原有 golden。

GUI 聚合为 5549 通过、1 跳过、3 失败：Windows 符号链接 EPERM，以及两个代码高亮用例超过 5 秒。代码高亮未改实现和超时，整文件独立复跑 19 项通过；聚合仍记失败。早期错误的包过滤名和测试 lint 路径保留在日志，已补运行正确包构建和真实文件检查。

authenticating、设备撤销及其授权执行、认证失效期间已完成交互回答恢复、HTTP503 分类及完整平台兼容性矩阵仍未完成。浏览器证据使用 Windows Chrome 和录制模型数据，不代表打包 Desktop、真实模型或跨平台验收。Phase 3、Phase 4 和总目标保持 IN_PROGRESS。

## Host 就绪等待与硬期限恢复

[历史来源记录](artifacts/upstream-first/host-readiness-source.json)绑定 host-not-ready 状态及等待提示。握手达到现有告警阈值或更早的硬期限仍未收到 ready 帧时发布此状态；它不推断延迟原因。告警不取消当前尝试，同一代次仍可就绪。硬期限取消 source 后等待清理，再复用唯一重试调度替换连接。已取消 source 的迟到 ready 被忽略，状态回调可重入停止、重连或离线。

官方 Web profile 的两项录制用例暂停第一个真实 ready 帧：慢握手用例在提示出现后释放，原 socket 就绪；超时用例保留该帧，自动替换后的第二个 socket 就绪。展开侧栏和窄栏提示均有截图，进入就绪前没有业务请求。随后完成 Question，每项 22 条持久化记录及工作区与未修改 fixture 一致。

117 项定向测试、两个浏览器场景、Host/Client 类型、限定 lint、相关 bundle 和文档门禁 34/34 通过。上轮文档及 GUI 运行被中断；原日志保留，通过只读进程查询确认停止后，仅重跑未完成项。GUI 聚合实际为 5545 通过、1 跳过、2 失败：未修改的文件打开测试创建 Windows 符号链接时报 EPERM，代码高亮懒加载测试超过 5 秒。后者未改源码或超时，独立复跑通过，但这不能证明聚合稳定性或整套通过；依赖与 lockfile 不同步告警保留。

本轮没有验证 HTTP503 分类、真实模型、打包 Desktop 或跨平台行为。首次连接、认证中、ready/offline/reconnecting 的完整区分，设备撤销，认证失效中的已完成交互回答恢复，以及完整兼容性矩阵仍待完成。Phase 3、Phase 4 和总目标保持 IN_PROGRESS。

## 认证恢复结论的范围

[历史来源记录](artifacts/upstream-first/authentication-scope-source.json)明确认证恢复的“不自动补发”证据针对 Prompt。Connection 自身不重新提交失败请求；Gateway 独立拥有已完成交互回答的保留与重试。认证失效期间交互回答的恢复仍需单独验证，不能从 Prompt 场景推导。该澄清只修改三组双语文档；运行时代码、构建产物、浏览器观测与比较文件均核对为未变，文档门禁 34/34 通过。下节运行时证据保持有效。

## HTTP 401 认证失效与显式恢复

[运行时来源记录](artifacts/upstream-first/authentication-source.json)绑定 auth-expired 状态及恢复提示。浏览器 HTTP 请求在发出前捕获连接代次；真实 401 仅撤回仍活动的原代次并暂停自动恢复。旧代次或已取消请求的迟到 401 不能中断替换连接。403 不被解释为认证过期或设备撤销。UI 提示通过 Host 当前启动链接重新认证，再显式重连，不展示凭据。

两个录制场景通过官方 Web profile 与真实 Host 运行。移除 Cookie 后，重新发现的 host/describe 和提交的 session/prompt 分别返回真实 401。初次提交场景先遇到预设查询 401，观测记录保留；最终场景把已拦截的 Prompt 经清空 Cookie 的同一浏览器请求上下文发给 Host，明确断言该修改端点拒绝。新标签页执行原有认证交换，原标签页手动重连。恢复后先等待并断言 Prompt 请求数量不增加，再显式重新提交，最终 22 条完整持久化记录和工作区与原 fixture 一致。

定向 112 项测试通过，最终设置文案组件测试 24 项通过；两个最终浏览器场景通过并复核截图。Host/Client 类型、限定 lint、相关 bundle、文档门禁 34/34 及最终等义文案的双语对应检查通过。GUI 聚合为 5542 通过、1 跳过、1 失败，仍是未修改的文件打开测试创建 Windows 符号链接时 EPERM；不能称整套通过。

Cookie 移除证明统一 401 路径，不代表等待凭据自然到期、设备撤销或原生登录验收。认证前阶段、Host 未就绪及其余连接状态区分、设备权限、完整跨版本与跨平台矩阵仍待完成。Phase 3、Phase 4 与总目标继续 IN_PROGRESS。

## Host 发现失败的状态与恢复提示

[历史来源记录](artifacts/upstream-first/connection-failure-source.json)绑定 Connection 的 incompatible、fatal 状态及其界面提示。Host/Gateway 协议或发现阶段必需能力不兼容会停止自动重试并提示更新；发现信息无效、发现服务撤回会停止自动重试并提示检查配置。显式重连重新执行发现与事件就绪，不能绕过业务准入。普通业务错误不改变连接状态。调度仍由唯一 Connection 控制器负责。

展开侧栏显示本地化文字，收起轨道显示 36px 提示图标，并保留修正说明、可访问名称与手动重连。两个官方 Web profile 的录制场景注入不兼容和畸形发现版本，验证没有自动重复发现请求或就绪事件；恢复后完成原 Question，22 条完整持久化记录和工作区与未修改 fixture 一致。既有 Question 与 Approval 恢复场景也进行回归，证据记录分别绑定执行日志及截图。

定向 105 项测试、Host/Client 类型、限定 lint、相关 bundle 与 Web 构建通过；文档门禁 34/34。GUI 聚合实际为 5535 通过、1 跳过、1 失败；失败位于未修改的 ui-deliverables 文件打开测试，Windows 创建符号链接报 EPERM，不能称整套通过。tsx 的沙箱 ENOMEM 及主机重试记录保留。

本轮只补齐两个发现失败状态，不代表方案第 18 节完成。HTTP 401 认证恢复的后续实现见上节；初始连接、认证阶段、离线、重连、Host 未就绪和设备撤销的完整区分与 UX、设备权限、跨版本与跨平台矩阵仍待完成。Phase 3、Phase 4 和总目标保持 IN_PROGRESS。

## 刷新后预设名称就绪与连接状态缺口

[历史来源记录](artifacts/upstream-first/preset-reload-source.json)绑定五项 Question 恢复场景的预设名称就绪检查。对话完成与预设目录加载分别等待；全部五项通过，未复现预设名称持续丢失。失败诊断仅保留目录请求状态及 standard 预设字段，本轮未发生目录失败。产品运行时代码未改变，Host 类型、限定 lint 和 doc-sync 34/34 通过。

方案第 18 节要求认证中、离线、重连、Host 未就绪、认证过期、设备撤销、协议不兼容及致命错误等状态。该轮检查时 ConnectionState 仅有 connected、disconnected、connecting；后续 incompatible、fatal 实现与验证见上节。该缺口、本轮以外的恢复矩阵以及整个方案仍未完成。

## 回答接受前后刷新页面

[历史来源记录](artifacts/upstream-first/interaction-reload-source.json)绑定四项页面刷新场景和既有断线、竞争回答回归。Question 与 Approval 均在首次结果 HTTP 请求被暂停时刷新页面，分别覆盖 Host 接受前、接受后。刷新前的 URL 已不含启动 token，刷新返回 200，并通过新连接代次恢复，未再次使用启动凭据。

Host 尚未接受时，同一待处理交互重新出现；再次点击前只有一次已拦截回答请求，回合尚未结束。用户显式再次提交后，两个请求只有连接代次不同，id、revision 和回答内容一致。Host 已接受后再刷新时，交互不再出现，结果从对话恢复，回答请求总数仍为一。它验证 Client 内存丢失后的恢复，没有增加或承诺持久化自动重发。

四项刷新场景初次通过后，加入认证断言并统一回归全部十项场景，十项通过。Question 每场景 22 条、Approval 每场景 85 条标准化持久化 Session 记录与原 fixture 精确一致，模型脚本全部消费，独立工作区预期通过。待处理与完成截图已目视复核；待处理截图可能早于历史加载完成，最终记录和工作区比较在回合完成后执行。

Host/Client 类型、限定 lint 与 doc-sync 34/34 通过。产品运行时代码、bundle 和历史 fixture 未改变。本轮仍限 Windows/Chrome 与录制模型，后台恢复、设备权限、跨平台及变更确认语义尚未完成。Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## 取消与待发送回答、自动重试交错

[历史来源记录](artifacts/upstream-first/interaction-cancel-source.json)覆盖 Approval、Question 两种交互各自的两个顺序：首次回答被暂停后取消，以及首次回答丢失、自动重试被暂停后取消。测试通过官方 dsh --profile web 加场景 patch 启动独立进程，两个浏览器 Client 共享本地认证上下文；取消使用公开 session/cancelTurn RPC，以持久化 turn/start 序号为目标，不新增测试专用取消接口。

四个场景均通过。取消清除交互，重连的 pendingInteractionIds 为空，原回答不会再次发送。取消后和下一轮新交互期间分别提交旧回答，均得到 interaction-closed；再次发送旧回合的取消请求也不会中断新回合。每个场景只有两个工具调用和两个结果，回合结局依次为 aborted、completed；模型 fixture 收到三次请求，审批标记文件始终不存在。持久化结果和最终界面均保留旧取消结果与新一轮完成，截图已目视复核。

Approval 的取消结果为 ABORTED，Question 保留服务定义的 ASK_ABORTED；首次测试误将 Question 也写成通用码，两项因此失败，核对服务契约后修正断言并重新通过四项，没有改变产品运行时。Host/Client 类型、限定 lint 与 doc-sync 34/34 通过，产品构建文件与上一记录的 hash 相同。

这组证据使用本地模型 fixture 和调用真实 Approval/Question 服务的测试工具，验证定向持久化事件及审批文件副作用，不是完整录制 Session 回放或真实模型服务验收。公开取消 RPC 使用两个标签页共享的认证上下文，没有验证 Stop 按钮操作或不同设备身份。页面刷新恢复的后续验证见上节；设备权限、跨平台及其他恢复场景仍待处理；Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## Question 录制恢复与不同答案竞争

[历史来源记录](artifacts/upstream-first/question-retry-source.json)补齐 Question 的真实进程恢复验证。用例直接只读复用 question-composer 的 V3 录制，官方 dsh --profile web 加场景 patch 启动独立 Host，固定临时设置、技能根和凭据；同一 JSONL 同时作为模型回放输入和完整持久化日志预期。

请求未送达、Host 接受后确认丢失、另一 Client 回答胜出三个场景均通过。每个场景只在第一 Client 提交一次，22 条标准化 Session 记录逐条一致，工作区仍为空，模型回放全部消费。竞争场景中第一 Client 提交 Green 与 Discard this losing answer，其 HTTP 请求被暂停；第二 Client 提交 Blue 与 Include accessibility notes 后胜出。第一 Client 重连时清除旧回答，显式迟到提交返回 interaction-closed；日志中仅有一个工具调用、一个结果，展开后的界面仅展示胜出答案，截图已目视检查。

共享 fixture 的终结回合改为显式配置，既有三项 Approval 回放也通过。组合命令中的六个浏览器场景全部通过，但整体退出码为 1，原因是新增 snapshot adapter 未按字母顺序登记；排序修正后的三项 corpus 检查独立通过。最终可见答案断言的 Question 三项再次通过。首次竞争用例因 Playwright 单页上下文不允许再建页面而失败，修正为显式共享 context；中文段落格式和 lint 分隔符问题已修复。保留全部失败日志。

Host/Client 类型、限定 lint 和最终 doc-sync 34/34 通过。产品运行时与已构建 bundle 的 hash 均与上一记录一致，没有改写历史 fixture。证据限 Windows/Chrome 与录制模型；待发送回答期间取消的后续验证见上节；页面刷新恢复的后续验证见上文；设备授权及跨平台仍未验证。变更确认语义仍待设计，不把 Client 内存重试描述成持久化回执。Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## 已填写交互回答的断线重试

[历史来源记录](artifacts/upstream-first/interaction-retry-source.json)绑定 Gateway 的 Client 内存回答保留与 Host 待处理快照。协议 2 的 ready 帧增加可选 pendingInteractionIds；HTTP 传输失败后，Client 仅对 Host 再次投递的同 id、同 revision 交互重发已复制的回答，不再次打开监听器。成功确认、关闭、取消、业务拒绝或下一次快照缺少该 id 均清除保留内容。旧协议 1 字段保持不变；未提供快照的 Host 禁用此能力。

Gateway 相关测试 247 项通过；补充结果对象隔离断言后，Client 122 项再次通过。官方 dsh --profile web 的 keyless snapshot 通道中，正常场景、请求送达前丢失、Host 接受后确认丢失及三项 corpus 检查共 6 项通过。两个丢包场景均只点击一次审批：前者在新连接代次发出内容相同的第二次回答，后者只发送一次回答并清除已关闭的旧交互。每个场景均精确比较 85 条持久化 Session 记录、完整独立工作区，并验证重复 Tool id 的两个轨迹和 Inspect 结果。截图已目视复核，历史 fixture 未修改。

Host/Client 类型、限定 lint、Gateway bundle 和 doc-sync 34/34 通过。首次单元测试错误地构造 pending revision 2，现有协议按设计拒绝；已去除该无效用例，未放宽解析器。沙箱 tsx 的 ENOMEM 启动失败与宿主成功结果分开保留；双语配对命令的多余 -- 参数已修正。

本轮仅提供 Client 内存重试，不提供持久化 mutation receipt；页面刷新会丢失保留内容，也不能区分已关闭交互究竟由自己还是其他 Client 结算。Question 的丢包与不同答案竞争验证见上节；完整恢复矩阵、设备授权、跨平台与安装包验证仍未完成。Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## 重复调用 id 的录制 Session 回放验收

[历史来源记录](artifacts/upstream-first/tool-replay-source.json)补齐重复调用 id 修复的 keyless 录制回归。新增 authored 场景从 permission-policy-context 的 V3 记录派生，只修改第二次 write 的 7 处结构化调用 id 引用；原快照、模型文本和独立文件预期不变。浏览器通过官方 dsh --profile web 与场景 patch 启动独立进程，fixture 同时作为模型流输入和完整持久化日志预期。

正式 snapshot 通道中，新场景与三项 corpus 检查共 4 项通过。85 条标准化记录精确一致，四个回合的模型脚本全部消费；独立工作区比对确认 policy-neutral.txt 只有 POLICY_NEUTRAL_OK。Turn 4 Step 1 的写入被只读策略拒绝，Step 2 的同 id 写入获批成功。浏览器分别核对两个结果行，并从 Chat Inspect 到对应 Step 的 Result 页签。截图已目视复核。

首次完整日志比较拒绝了来自宿主的额外技能目录输入，原因是 preset 内技能根使用环境 fallback，外层配置无法覆盖。新回放和既有重启测试均固定 DSH_AGENTS_HOME、DSH_BUNDLED_SKILL_DIR；后者新增无 skill-catalog 输入断言，两项 Approval/Question 重启与 Inspect 测试再次通过。第二次尝试发现测试读取了目录选择器的父目录，修正为持久化 Session 的 cwd 后，独立文件预期通过。失败日志保留，没有增加归一化例外或覆盖历史 fixture。

Host/Client 类型、限定 lint 与 doc-sync 34/34 通过，产品 bundle 与上一来源记录逐个 hash 一致。本轮审批结果由测试插件提供；真实浏览器回答审批和问题由独立重启场景验证。证据限 Windows/Chrome，嵌套 PTC 仍以组件测试覆盖；真实模型、跨平台、安装包及完整恢复矩阵未由此完成。重复调用 id 的本地专项验收已通过，Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## Inspect 按 Turn / Step 定位工具执行

[历史来源记录](artifacts/upstream-first/tool-inspect-source.json)绑定 Chat、Trajectory、生成目录及更新后的 bundle。Chat Seat 将 root 的 Location 传给 Inspect 回调；跨视图 focus 编码 Turn、Step 和原始 call id，嵌套调用保留 root 的执行坐标。Trajectory 按同一组坐标揭示已驻留的较早历史并打开记录，不匹配的请求保持待定。检查器的源内容块跳转和所属消息链接均限制在当前 Step。

三项相关测试文件共 169 项通过，包含两个初始失败的指定执行实例回归、同 Turn 跨 Step、跨 Turn、较早历史中的根/嵌套调用、消息块跳到工具再返回所属消息，以及未匹配请求不被错误确认。Host/Client 类型、限定 lint、相关包编译打包和 doc-sync 34/34 通过。

两项真实 dsh profile 进程重启测试在 Windows Chrome 中完成四次 Inspect：每个场景先打开重启后的新调用，再打开中断的旧调用，分别核对 Turn/Step、Result 和 Schema。Question 的首次断言读取了折叠摘要，最终驱动通过 Result 页签展开三层 JSON 后核对 Fresh answer；初次失败日志保留。旧调用仍显示 TOOL_OUTCOME_UNKNOWN，新调用仍显示本次结果。最终截图经目视复核，模型为本地脚本 HTTP 服务。

此阶段验证节点、账本和导航；后续录制 Session 验收见上节。嵌套 Inspect 与内部链接仍以组件测试覆盖，真实模型、跨平台、安装包与其余恢复矩阵不由这些结果证明。

## Trajectory 账本按执行区分结果、耗时和 schema

[历史来源记录](artifacts/upstream-first/tool-ledger-source.json)绑定 Trajectory 源码、更新后的 Client bundle 及回归结果。三项初始失败回归证明：虽然节点已经独立组装，表格仍会把两次调用放入同一 Turn。当前 Builder 保留 Tool 的 Step Location；结果、开始时间、已显示调用集合、schema 和记录标识均使用执行坐标，嵌套调用继承 root 的坐标。缺少 Step 的结果保持独立，不借用同 id 的其他结果。

五个相关测试文件共 100 项通过，覆盖相同 Turn 的不同 Step、不同 Turn、嵌套调用、不同 schema、运行中同 id 调用、未定位结果及现有 View 行为。Host/Client 类型、限定 lint、Trajectory 编译与打包、doc-sync 34/34 通过。两项真实 dsh profile 进程重启测试还通过浏览器打开 Trajectory：Turn 1 保留 TOOL_OUTCOME_UNKNOWN，Turn 2 分别显示拒绝审批或 Fresh answer 的新结果；两行键不同，错误状态分别核对，截图已经目视复核。

此阶段仅证明账本配对，后续导航、schema 页签与录制 Session 验证见上文。真实模型与跨平台验收仍未完成。

## Tool 节点按 Step 区分：组装阶段证据

[历史来源记录](artifacts/upstream-first/tool-scope-source.json)绑定 Chat、Conversation、Trajectory 的源码、更新后的三个 Client bundle 及验证结果。Tool Definition 选择 Step 范围的身份，Conversation 使用 turn、step 与原始 call id 关联节点；默认 Definition 仍按 Session 关联，匹配器仍不读取历史，provider id 与 Session 日志不改写。

嵌套 PTC 缺少执行坐标的分页前缀等待已记录坐标再归属，不能跨新的 Step/Turn 开始边界推断。先加载结果、后补调用保持同一节点键；同一 Step 的重复 start 和瞬态 start 继续拒绝。针对 Chat、Conversation、Trajectory 的五个测试文件共 123 项通过，覆盖跨 Step/Turn 复用、嵌套 PTC、replace、append、prepend 及不完整前缀。

最终重新构建 ui-conversation 后，两项真实 dsh profile 子进程与 Windows Chrome 测试通过：Approval 和 Question 都能恢复并回答新交互，复用调用 id 后旧 TOOL_OUTCOME_UNKNOWN 记录仍显示一次。磁盘、迟到回答、草稿、Cookie 与无副作用断言沿用。此处模型为本地脚本 HTTP 服务；浏览器截图已经人工目视复核。Host/Client 类型、限定 lint 和 doc-sync 34/34 通过。重复测试轮次不累加为独立用例。

此阶段仅验证节点组装；表格配对、schema、Inspect 导航与独立录制 Session 回归的后续证据见上文。

### 初始缺陷证据

[历史来源记录](artifacts/upstream-first/tool-occurrence-source.json)封存两个原始失败回归：同一 Turn 的不同 Step、不同 Turn 复用 provider ToolCallId 时，ConversationNodeAssembler 报 received more than one start Match。该记录通过封存输入校验，描述修复前的状态；当前组装回归已通过，不将历史失败计作当前失败，也不将本轮局部修复计作完整 Tool UI 通过。

## Approval / Question 重启后的新交互

[历史来源记录](artifacts/upstream-first/question-restart-source.json)将真实进程回归扩展为 Approval、Question 两个场景。两者均保留原 Cookie、未发送草稿和中断历史，旧工具结果按既有逻辑修复为 TOOL_OUTCOME_UNKNOWN。Question 没有独立的持久化待答事件，没有为测试新增日志类型或请求存储。

旧交互回答在重启后、新交互创建前被拒绝；用户显式发起新 Prompt 后，再向旧 id 提交一次回答也返回 interaction-closed，新卡片保持待答。新请求拥有不同 id：Question 通过实际浏览器选择 Fresh answer 并提交，Approval 通过浏览器拒绝，随后均在同一恢复后的 Connection 上完成新回合。每个场景共三次本地脚本模型请求，未产生测试标记副作用。

磁盘中保留一次中断结果及一次新工具结果，模型下一次请求收到新结果；迟到 Question 文本没有进入新结果。中断审批没有伪造决定，新审批仅记录真实的 rejected。最终两项浏览器用例、Host/Client 类型、限定 lint 与 doc-sync 34/34 通过；初轮两项与最终运行重叠，不相加为唯一用例数。沿用官方服务和恢复实现，产品运行时代码未变。

此证据仍限 Windows/Chrome、同一隔离 home 和端口、保持打开的页面及无排队输入的 Session。真实模型、OS 休眠唤醒、浏览器死亡、移动后台、其他执行队列、设备权限和持久化回执仍未由这些测试覆盖。Phase 4 与总目标保持 IN_PROGRESS。

截图复核发现脚本模型两次工具调用复用 mock-call-1；完成新回合后，旧工具行的展示与恢复截图不同。磁盘断言区分两次事件并通过，但重复调用 id 与 Client 展示的关系尚待专项检查，不将本轮结果视为完整 Tool UI 验收。

## 真实 Host 进程重启与中断 Session 修复

[历史来源记录](artifacts/upstream-first/host-restart-source.json)绑定新增的真实进程 Web 回归及既有恢复实现。测试通过正式 source dsh --profile 启动独立 Node Host，使用本地脚本 HTTP 模型进入真实工具与审批流程。先输入未发送草稿，再等待审批请求落盘，随后强制结束进程；读取持久化数据确认只有一次工具调用和审批请求，没有工具结果、审批决定或回合结束。

重启保留同一隔离 Harness home 和端口，浏览器保持打开并沿用原 Cookie，不再次交换启动 token。新连接清除旧审批卡、保留草稿，并向旧事件 id 的允许请求返回 interaction-closed。实际 Session follow 快照将工具标记为 TOOL_OUTCOME_UNKNOWN，并以 interrupted 结束原回合。重连未触发新的模型请求或测试标记写入。

用户显式提交下一条消息后，第二次模型请求携带既有的“不要盲目重试”修复文本并完成新回合。Agent 空闲后读取磁盘，确认两条用户来源消息、一次工具调用、一个结果未知的修复结果、两个结束回合，且没有伪造 approval/decided。最终浏览器场景、Host/Client 类型、限定 lint 与 doc-sync 34/34 通过；初始测试夹具及观察失败均保留。未修改产品运行时代码或新增 Session 事件。

这是中断 Session 的安全收敛，不是恢复待审批 JavaScript 续体。证据限于 Windows、已安装 Chrome、保持打开的浏览器和无排队输入的 Session；没有真实模型服务、外部工具副作用、Question 进程重启、浏览器死亡、OS 休眠唤醒、移动端或跨平台验收。依赖未同步警告及原 Windows symlink EPERM 未解决；Phase 3、Phase 4 与总目标继续执行。

## Host 持有的可选交互期限

[历史来源记录](artifacts/upstream-first/interaction-expiry-source.json)绑定 Gateway 的按类型过期配置、定时器、协议字段及浏览器验证。interactionTimeoutMs.approval 和 question 可分别配置期限，未配置的类型不自动过期。Gateway 创建待处理记录时设置 Host expiresAt 和可清理的经过时长定时器；Client 重连沿用同一时间戳，无人连接时仍计时。

Host 在重放和接受回答前也检查截止时间，避免休眠后的迟到回答赶在定时回调前获得授权；时钟回拨不延长已经启动的计时。结算或取消清理定时器。过期以 interaction-expired 拒绝事件源，协议 2 下发 expired / revision 2 终结记录，协议 1 保持原取消字段；迟到回答返回 interaction-closed。Approval 沿用 unavailable 的失败关闭结果，Question 传播过期错误。本地回答方不受该转发期限限制。

Gateway/Remotes 回归 429 项通过，补充到期后不得向新连接重放的回归后，流测试 42 项通过（含重复场景，不相加为唯一测试数）。真实 Web Loader 与两个 Chrome Client 通过测试专用的 10 秒配置验证审批、问答到期、实际连接代次更换后原期限不变、两端卡片关闭及迟到允许请求被拒绝。原有默认无期限的竞争回答与版本恢复场景也通过。初始 Playwright close 事件计数失败已改为检查新的 Host clientId 与同一记录重放，失败日志保留。

Host/Client 类型、限定 lint、Gateway 双端构建及 doc-sync 34/34 通过。通用 Typert 生成探针因 Gateway 不导出 ./typert 被拒绝，未写入文件，不作为构建证据。时钟测试使用受控时钟，不代表实际 OS 休眠唤醒验证；浏览器不调用模型或执行真实 Tool。过期状态仍只在内存中，未新增 Session 事件、专用 UI 过期提示、设备授权、持久化回执或重启恢复。无新增完整 GUI、安装、原生、跨平台或发布验收，整体目标继续执行。

## 交互回答版本与协议一致性

[历史来源记录](artifacts/upstream-first/interaction-revision-source.json)通过封存输入绑定 Gateway 的 Host/Client 回答链路、校验及真实浏览器恢复验证。协议 2 的应用交互结果、委托和拒绝均回传 interactionRevision。Host 在移除投递或结算调用方前同步检查待处理记录版本与活动投递协议：缺少版本或降级协议返回 gateway/input-invalid，版本不匹配返回 revision-conflict。失败保留待处理交互；已关闭投递仍优先返回 interaction-closed。

Gateway/Remotes 回归 407 项通过，补充 Client 回归 111 项通过（含重复场景，不相加为唯一测试数）。真实 Web Loader 与两个已安装 Chrome Client 验证错误版本、缺失版本和协议降级均不产生决定；第一端实际收到 revision-conflict 后重连一次，重现相同 requestId、创建时间和 revision，再正确回答只记录一次。第二端的迟到回答返回 interaction-closed，随后仍在原连接回答下一条请求。用户决定与交互帧序列匹配更新的预期文件。

Host/Client 类型、限定 lint、Gateway 双端构建及 doc-sync 34/34 通过。初始混用连接与回答协议的夹具、缩进及 Mock 异步类型错误日志保留。业务监听器不接收协议元数据。浏览器使用真实 Approval/Agent/Session 服务和受控 HTTP/取消帧，不调用模型，也不执行真实 Tool 副作用。

待处理记录仍为 revision 1，终结记录为 revision 2，没有修改待处理内容的路径。协议 1 保留原有字段且不做版本比较；该机制也不授予设备权限、不实现过期、持久化变更回执或重启恢复。无新增完整 GUI、安装、原生、跨平台或发布验收；已知 Windows symlink EPERM 未重跑或解决。总目标与 Phase 4 继续执行。

## 条件重命名与编辑版本

[历史来源记录](artifacts/upstream-first/rename-revision-source.json)通过封存输入绑定标题服务、Session Controller、新能力及工作区编辑流程。session.rename-at.v1 使用 titleRevision 中的持久化标题事件序号；Host 在标题服务内按配置规范化并同步比较、追加。版本变化返回 session/revision-conflict；相同的用户固定标题返回原事件，不重复写入。旧 checkpoint 缺少该投影时从日志重建，不把全局流游标当成标题版本。

Client 在打开重命名对话框时捕获版本，重复保存保留同一基线；缺少版本时不发送。冲突保留草稿并显示中英文提示，重新打开才捕获当前版本。旧 Host 和直接 rename 调用（包括分叉后的程序命名）保留无条件语义。本增量没有新增 Session 事件、独立存储或通用 clientMutationId 回执账本。

定向回归 283 项通过，后续中文冲突与旧 checkpoint 补充回归 11 项通过（含重复场景，不相加为唯一测试数）。真实 Web Loader 与两个已安装 Chrome Client 验证旧编辑冲突、草稿保留、重新打开保存、重复 HTTP 请求不追加事件以及后续标题变化后旧请求失败；用户标题事实与界面文案匹配新增预期文件。另两项浏览器回归通过：原有规范化 Prompt Session 比较，以及能力撤回后恢复真实重命名。重命名夹具不调用模型，Prompt 使用 keyless replay。

Host/Client 类型、Remote 声明、限定 lint 和受影响包构建通过；目录生成器回归 40 项通过。doc-sync 初次 33 项通过、1 项 Cordis inspect 目录过期；重建后对应新鲜度检查及九组双语配对通过。初始测试清理、自动标题夹具、Client 替身、行宽及浏览器工作区选择失败均保留。未重跑或解决上一增量的 Windows symlink EPERM；无新增崩溃、完整 GUI、安装、跨平台、原生或发布验收。整体目标继续执行。

## 按回合目标取消

[历史来源记录](artifacts/upstream-first/cancel-target-source.json)通过封存输入绑定 Session Controller 的 activeTurnStart 投影、新 cancelTurn Remote、Client 调用及验证。session.cancel-turn.v1 声明支持按持久化 turn/start 序号取消。Host 只在目标仍是当前开放回合时同步请求取消；已结束、已更换或显式 null 的目标不影响后续工作。Client 每次点击捕获一次目标，投影未就绪时返回失败。旧 Host 使用原 cancel 调用，子代理仍走父级中断路径。

定向回归 81 项通过。真实 Web Loader 与两个已安装 Chrome Client 验证：第一端停止回合 1 后延迟接收回执，第二端启动回合 2；重放旧取消请求时回合 2 仍运行，第二端可用新目标独立停止它。另一个浏览器回归比较原有规范化 Prompt Session，最终两项通过。模型采用 keyless replay/hang，不代表真实模型服务验收。

Host/Client 类型、限定 lint、显式生成的 Remote 声明、Controller/Remotes/tool-cordis 构建及目录预期输出 3 项通过。扩展回归在宿主为 811 项通过、1 项失败、1 项跳过；失败是 media-references 的 Windows symlink EPERM，在 sandbox 与宿主均存在，整组不能记为全绿。初始夹具、生成声明和文档类型归属错误均保留日志。

doc-sync 初次 32 项通过、2 项生成引用过期；更新事件关系图和持久化目录后，两项新鲜度检查及六组双语配对通过，未重跑其余门禁。本增量复用 Session 日志与现有投影，不新增 Session 事件或回执注册表；原 cancel 与子代理中断不具备本次目标语义，answer、rename 等操作的通用去重仍未完成。无新增完整安装、跨平台、原生或发布验收。

## Prompt 重试与持久化 inbox 接受记录

[历史来源记录](artifacts/upstream-first/prompt-idempotency-source.json)通过封存输入绑定 Session Controller 修复、测试、浏览器场景及复用的录制 Session。沿用 requestId/rpcId，异步附件准入结束后，在同步插入 inbox 前重新检查；持久化 agent/inbox/spliced 的插入记录在消息被领取或移除后仍能证明已接受，避免正文尚未记录时重复入队或恢复已删除输入。未发生插入的失败仍允许沿用同一身份重试。

修复前 4 个新增回归场景失败；修复后的 Session Controller 定向回归 109 项通过。真实 Web Loader 与已安装 Chrome 场景通过：两次并发请求和领取后的一次请求均获接受回执，但只插入一条 Prompt。录制模型响应被消费一次，规范化后的完整 Session 与原有 live-interactions 记录一致，未更新 golden。该场景未独立固定系统提示词或工具 schema 内容。

Host/Client 类型、Session Controller 构建、限定 lint 及 doc-sync 34/34 通过。浏览器初始运行受到宿主 sandbox 的用户目录 realpath EPERM 阻挡，宿主重跑后通过；产品 sandbox 保持原有行为。测试类型、Lint 和把框架上下文误计为用户输入的失败证据均保留。

本增量没有新增变更注册表或协议字段，不代表 answer、cancel、rename 或设备变更已经具备通用 clientMutationId 语义。已接受身份代表原始插入，不能提交替换内容；并发附件准备可能留下无引用对象。无崩溃注入、真实模型服务、完整 GUI、原生、跨平台或发布验收，整体目标继续执行。

## Host 交互记录与协议兼容

[历史来源记录](artifacts/upstream-first/interaction-record-source.json)通过封存输入绑定 Host 交互记录、协议投递、目录产物及验证。API Remotes 明确声明 Approval/Question 类型、Session 和所需回答权限；Gateway 复用现有 pending 记录分配 requestId、createdAt、status 和 revision。协议 2 下发记录，协议 1 保持原有帧字段。断线重连保持同一待处理身份、创建时间和 revision 1；其余投递收到 revision 2 的终结记录。

Gateway/API Remotes 回归 387 项通过，覆盖严格字段校验、混合协议客户端、重连重放、完成及取消。真实 Web Loader 与两个已安装 Chrome Client 的场景通过：两端收到相同记录，竞争回答只记一次决定，另一端收到 interaction-closed 与关闭记录，随后仍在原连接处理下一次请求。浏览器预期输出已更新；测试控制 HTTP 回答与取消帧时序，不调用模型或执行真实 Tool 副作用。

Host/Client 类型、Gateway/Remotes 构建及限定 lint 通过。doc-sync 初次 32 项通过、2 项生成目录过期；重新生成 Cordis API 与配置目录后，两项新鲜度检查及四组双语配对通过，未重跑其余门禁。目录预期输出测试 3 项通过，tool-cordis 产物已重建。初始夹具、Lint、命令参数及工作目录错误记录保留，不作为通过证据。

requiredPermission 目前是描述字段，不执行设备授权；记录只由内存中的 Host 待处理调用持有，尚无过期、重启恢复、回答 revision 比较、设备撤销或 clientMutationId。Client 校验元数据，不向业务请求添加字段。无新增完整 GUI、原生、发布、跨平台或干净依赖安装验收，Phase 4 与整体目标均未完成。

## Interaction 竞争回答与显式关闭结果

[历史来源记录](artifacts/upstream-first/interaction-closed-source.json)通过封存输入绑定 Gateway 的 Host/Client 关闭结果及两客户端验收。复用上游 Host 持有的 pending waterfall，已完成、已取消、已委托或已撤回 Client 连接代次的回答返回 interaction-closed，不再次结算。Client 把关闭结果视为该交互已完成，不因此重连整个 Connection；其他失败行为保留。

Gateway/API Remotes 回归 360 项通过，含协议 1/2 的多客户端竞争、Host 取消和断线后的迟到回答。真实 Web Loader 与两个已安装 Chrome Client 的场景通过：同一 Approval 只接受一个回答，另一端收到 interaction-closed，随后在原连接完成下一条拒绝请求。测试控制迟到 HTTP 请求与取消帧的时序，业务回答由真实 Gateway/Approval 处理；未调用模型或执行真实 Tool 副作用。

该历史增量的 Host/Client 双编译面、Gateway 构建、限定 lint 及 doc-sync 34/34 通过。初始把新增浏览器测试放入 Client 程序的失败记录保留，最终已归入 Host 测试清单。该增量未包含交互记录、过期、设备授权、重启恢复或变更去重；后续记录实现与仍缺少的验收见上节。

## Workspace 到 Session 的组合准入

[历史来源记录](artifacts/upstream-first/workspace-admission-source.json)通过封存输入绑定组合导航、共享流及验证。Workspace 选择（含空会话复用）、创建与分叉在建立导航意图前检查 session.manage.v1，异步完成后再次检查，能力撤回时不搬移草稿或切换到返回的 Session。Host 已完成的变更保留；已有 Session 仍可直接打开。首次自动选择等待管理能力，工作区选择器随撤回关闭，恢复后不自动重开。

真实浏览器暴露 Workspace 流在初始 Connection 就绪前终止为 gateway/connection-unavailable。共享 RemoteStream 已统一在每次 opener 前等待已准入 Host 与可选能力谓词，继续使用 Connection 的就绪来源。本轮没有添加 Workspace 专属重连循环。

Workspace/Conversation 回归 599 项通过；共享修复后的 Gateway、Workspace Controller、Session 传输回归 604 项通过；最终真实 Web Loader 与已安装 Chrome 全组 9 项通过。首次能力缺失不创建，恢复后只创建一次；撤回关闭选择器并保留草稿，恢复后复用原空会话。能力缺失通过真实 Host 发现响应的受控投影构造，不调用模型。

Client/Web 类型、相关包构建与限定 lint 通过。doc-sync 初次 33 项通过、1 项 Cordis API 目录过期；重新生成后对应新鲜度检查及目录测试 3 项通过，未重复其余门禁。599 项 UI 回归在共享就绪修复前，604 项 API 与 9 项浏览器验证在其后。失败诊断日志和截图保留，但不是通过证据。无新增完整 GUI、原生、发布及跨平台验收。

## Session 历史可用性与视图分页

[历史来源记录](artifacts/upstream-first/session-follow-ui-source.json)通过封存输入绑定 Conversation 外壳、Chat/Trajectory、生成的 Client 目录和浏览器预期输出。外壳向选中 View 传入 historyAvailable；缺少 session.follow.v1 时显示本地化提示，保留历史和草稿。Chat 隐藏远端分页及未加载轮次导航；Trajectory 保留本地缓存分页。空会话仍不挂载 View。

定向组件回归 930 项通过，最终空会话修正另通过 24 项；真实 Web Loader 与已安装 Chrome 的完整 Host 能力回归 8 项通过。实际断连后，能力缺失期间没有 follow/page 请求；Host 期间追加的记录在恢复后显示，原历史和草稿保留。能力撤回通过真实 Host 发现响应的受控投影构造，不调用模型。

Client/Web 类型、受影响包构建及限定 lint 通过。doc-sync 初次 33 项通过、1 项 Client 目录过期；重新生成后目录新鲜度检查和生成器 18 项测试通过，未重复其余已通过门禁。空会话修正在浏览器全组之后，由最终组件回归和类型检查覆盖。无新增完整 GUI、原生、发布或跨平台验收，依赖未做干净安装验证。

## Session 历史流能力等待

[历史来源记录](artifacts/upstream-first/session-follow-source.json)通过封存输入绑定传输层源码和验证。Session journal 在首次打开及重连时等待 session.follow.v1；缺失期间不自动发起 follow，保留已有历史窗口，恢复后追赶新事件。销毁取消等待并释放订阅，继续由既有 Connection 管理连接生命周期。

定向回归 334 项通过；Client runtime 测试 98 项通过、1 项预期失败。Client 类型检查、Gateway/Session 打包、限定 lint 和 doc-sync 34/34 通过。较大 Session 测试执行保留 Windows 文件符号链接 EPERM 失败；两处旧请求夹具的未处理拒绝已修正等待时序，并纳入最终定向回归。

该历史增量仅确认传输层。界面与浏览器证据见上节；整体目标仍在执行。

## 工作区行与预设会话管理入口

[历史来源记录](artifacts/upstream-first/workspace-management-source.json)通过封存输入绑定该阶段源码、产物、日志、预期输出和截图。Workspace 行的创建按钮、分组与单列表的 Session 重命名/分叉，以及预设 Settings 的 Creator 会话入口要求 session.manage.v1。撤回能力会关闭已打开的 Session 菜单和重命名对话框，恢复后不自动重开旧对话框。保留的创建、分叉和预设创作回调重新检查当前能力，避免导航或预置模板；归档及普通预设管理仍由独立功能负责。

定向源码测试 323 项通过，真实 Web Loader 与已安装 Chrome 的 7 项测试通过。浏览器验证能力撤回、对话框关闭、菜单与预设入口隐藏、实际断连恢复，并在恢复后通过真实 Remote 完成一次重命名；能力缺失期间没有发出创建、重命名或分叉请求。会话夹具在 Client 准入前准备为已结束状态，不调用模型。失败的夹具尝试与诊断截图保留，不作为产品通过证据。

Client/Web 类型检查、受影响插件打包、lint 及 doc-sync 34/34 通过，锁文件未变。能力缺失仍通过真实 Host 发现响应的受控投影构造。工作区选择到新会话的组合流程、Session 读取能力及其余业务准入、兼容诊断、幂等和平台验证仍待完成；没有新增全 GUI、原生或发布通过结论。Phase 3 与总目标保持 IN_PROGRESS。

## 侧栏会话创建入口（历史验证）

[历史来源记录](artifacts/upstream-first/sidebar-management-source.json)通过封存输入绑定该阶段源码、产物、预期输出、截图与日志。侧栏的新建按钮及展开态品牌快捷入口要求 session.manage.v1；能力缺失时保留非交互品牌、普通光标和导航控件，折叠轨道隐藏创建按钮。保留的创建回调也检查当前能力，恢复后重新显示入口。

侧栏定向测试 43 项通过，真实 Web Loader 与已安装 Chrome 的 6 项测试通过，覆盖同一页面实际断连、能力撤回、折叠切换与恢复，且未发出创建、重命名或分叉请求。缺少能力通过发现响应投影构造，不等同于卸载 Host 方法。Client 类型检查、插件打包、lint 和 doc-sync 34/34 通过。锁文件相对上一增量仅新增三行工作区依赖；没有外部依赖升级。pnpm 检查保留依赖状态警告并禁止隐式安装，未验证全新依赖安装。

本轮只补齐全局侧栏入口；Workspace 行、预设菜单、会话读取入口及兼容诊断仍未完成。未新增完整 GUI 通过结论，上一轮失败记录继续保留。Phase 3 和总目标保持 IN_PROGRESS。

## Session 操作能力与控制流恢复（历史验证）

[历史来源记录](artifacts/upstream-first/session-capability-source.json)通过封存输入绑定该阶段源码、构建产物、日志、预期输出及截图。Session 所有者共享声明跟随、控制、管理和模型选择能力；Gateway 在传输前拒绝缺少能力的操作，单次拒绝不影响其他允许的操作。策略尚未覆盖所有命名空间。

控制流在 session.control.v1 缺失时等待，不发送打开帧；恢复后重新打开。连接代次结束归类为载体中断，调用方主动取消仍保留原语义。输入栏保留草稿、禁止 Enter 提交并隐藏发送、停止及队列操作；恢复能力后重新启用。该逻辑复用现有 Connection、RemoteStream 和 renderer hook。

最终定向回归 475 项通过，真实 Web Loader 与已安装 Chrome 的 5 项测试通过，包含实际 WebSocket 断连、受控能力撤回与恢复、控制流帧和草稿检查。能力缺失通过发现响应投影构造，不等同于卸载 Host 方法。类型检查、打包及定向 lint 通过。

完整 GUI 重跑 5486 通过、2 失败、1 跳过；未改动的 Windows 文件符号链接测试仍报 EPERM，高亮超时隔离重跑 19 项通过。完整 GUI 在最后的代次取消分类修复前执行，该修复由最终定向回归和浏览器测试覆盖。doc-sync 为 31/34，三份过期目录重新生成后分别复核通过；失败记录保留，不宣称完整 GUI 或最终 doc-sync 全绿。Phase 3 和总目标保持 IN_PROGRESS。

## 模型选择能力准入（历史验证）

[历史来源记录](artifacts/upstream-first/model-capability-source.json)通过封存输入绑定该阶段源码、UI 产物、用户可见预期输出与截图。输入栏模型选择和 /model 入口只在已准入 Host 公布 model.select.v1 时显示；发现前或能力缺失时不读取模型目录，保留的选择回调与目录执行方法也拒绝发送请求。现有 renderer hook 订阅 Host 代际，不维护第二份能力存储。

连接代际丢失会清除旧目录与路由阻塞，关闭旧命令弹窗且不移动键盘焦点。恢复能力后只加载一次当前目录。定向模型/命令测试 89 项通过；真实 Web Loader 与已安装 Chrome 的 4 项测试通过，包含普通 Host、受控缩减能力声明、同一页面的实际 WebSocket 断连与恢复。缺少能力的场景通过受控发现响应构造，不能称作所有后端均实测支持该状态。截图分别记录[能力存在](.artifacts/model-capability-browser/supported.png)与[能力缺失](.artifacts/model-capability-browser/absent.png)。

类型构建、插件打包与最终定向 lint 通过。完整 GUI 回归 5482 通过、3 失败、1 跳过；隔离复查 47 通过、1 失败，两项高亮超时不再复现，未改动的文件符号链接测试仍报 Windows EPERM。doc-sync 首次 33/34，唯一过期 slot 目录已重新生成并单独校验通过。不得将这些结果表述为完整 GUI 或完整固定浏览器矩阵通过。

本轮完成模型选择这一业务入口的能力准入；其他功能入口、诊断/升级 UI、幂等、数据转换、原生客户端与发布仍未完成，Phase 3 和总目标保持 IN_PROGRESS。

## 应用协议协商（历史验证）

[历史来源记录](artifacts/upstream-first/application-negotiation-source.json)通过封存输入绑定该阶段源码、公开声明、构建产物和日志；当前源码由工作区管理入口来源记录直接校验。host.describe 保持协议 1 发现表示并公布可用版本；Client 通过同一 Remote namespace 的 host.negotiate 选择最高共同版本 2 或 1，验证 Host 身份和结果。缺少协商元数据的旧 Host 显式选择协议 1；元数据矛盾、无共同版本、身份变化或协商失败均拒绝准入，不静默降级。

已选编解码器由 Connection 代际持有，统一编码业务一元调用、业务流、事件流与事件回复。Gateway 是协议版本及请求语法的所有者；Host-description 的旧协议入口及其四个生成文件已归档移除。协议编号不授予权限，不新增重试或连接状态所有者。

源码协商与 Client 回归 142 项通过，补充代际/事件回复定向测试 9 项通过。公开声明检查与三组真实 HTTP API 互通共 4 项通过：新 Client / 新 Host 选择 2，新 Client / 封存 Host 及封存 Client / 新 Host 选择 1。封存清单和产物摘要逐项核验；共享 workspace 依赖未冻结为整套历史安装包。真实 Web Loader 与已安装 Chrome 的 2 项测试确认协商响应未放行时无事件流或业务请求，之后事件流携带协议 2。

正式 Host/Client 构建和最终定向 lint 通过。doc-sync 首次 32/34，失败的文档类型检查和 Cordis 目录检查修复后单独通过，六组配对通过；失败日志保留，不宣称完整门禁重新执行通过。N-2 Diagnostics、能力 UI、专用升级界面、原生消费方、幂等操作、迁移与平台发布仍待实施；Phase 3 和总目标保持 IN_PROGRESS。

## Remote 请求协议入口（历史验证）

[历史来源记录](artifacts/upstream-first/protocol-envelope-source.json)通过封存输入校验该阶段源码与产物；当前应用协商另行直接校验。Gateway 支持不带版本字段的协议 1 请求，以及显式协议 1/2 请求。未知或格式错误的显式版本在业务方法、业务流、事件 Client 注册和事件结果处理前被拒绝，额外参数仍严格校验。

本轮 77 项源码/真实 HTTP 路由测试、Gateway 两个编译面、定向 lint、打包和普通 Node 公共导出检查通过。doc-sync 首次 30/34：配置目录过期与 CRLF 引发四项失败；修复后 test:docs 15/16，唯一剩余配置目录配对已修复并通过三组具名配对检查，配置目录检查也通过。保留所有失败日志，不将补验表述为一次完整 doc-sync PASS。

该阶段仅提供 API 1 应用准入与请求编解码器；应用协商和封存 v1 互通由上节补齐。Phase 3 和总目标保持 IN_PROGRESS。

## Client 强制发现与同代准入（历史验证）

[历史来源记录](artifacts/upstream-first/client-admission-source.json)通过封存输入校验该阶段源码、公开声明、浏览器产物与验证日志。API Remotes 在暴露业务 namespace 前安装发现回调；每次 Connection 尝试先经现有认证载体请求 host.describe，检查 API 代际并用生成编解码器校验结果，再打开事件流。事件就绪后才放行业务调用，HostDescriptor 随现有连接代际发布和清除。

初次等待的调用可以独立取消；连接失效取消已放行调用。断连和重连期间的新业务调用立即返回 gateway/connection-unavailable，不会排队后自动执行写操作。未知 API 代际、损坏响应、缺少发现能力和发现失败均拒绝准入。公开 facade 同时导出描述字段及错误码的声明合并；独立 NodeNext 消费程序先复现缺失，再验证修复。Gateway 的通用独立组合仍不承担应用策略，官方应用通过 API Remotes 强制接入。

最终源码测试 145/145、公开类型与打包 HTTP smoke 2/2、真实 Web Loader 和已安装 Chrome 的认证/调用顺序检查 2/2 通过。官方 Host/Client 构建通过，最终声明与三个受影响 Client 包另行重建；最终 lint 和 doc-sync 34/34 通过，浏览器测试清理调整后再次通过定向检查。失败编译产生的四个已确认生成文件及首次类型测试留下的三个临时目录均已核验归档。仓库固定 Chromium 下载失败，因此不宣称完整固定浏览器矩阵通过。

该阶段仅支持初始 API 同代准入，尚未完成 N/N-1 协商、能力驱动 UI、专用升级界面、原生 DTO 消费方、幂等操作或旧数据转换。未重新打包 Desktop、执行系统安装/登录、迁移用户数据、调用真实模型、提交或发布。Host 发现与 Client 准入输入已封存，不能替代当前直接源码校验；Phase 3 与总目标保持 IN_PROGRESS。

## Host 发现与能力声明（历史验证）

[本轮来源记录](artifacts/upstream-first/host-description-source.json)直接绑定 Host 发现源码、组合配置、生成产物、文档与验证日志。host.describe 通过现有认证 Typert Remote 返回持久 Host 身份、独立的产品/API/Session 版本、Host 进程信息、声明的载体和显式能力。首次并发启动共用一个持久身份；损坏或不可访问的文件拒绝启动。Gateway 从现有活跃 Remote 绑定读取能力，必需方法撤回后不再广告对应能力。Web 使用 HTTP/WebSocket，Desktop 声明 desktop-pipe。

owner 定向测试 79/79、生成器测试 40/40、正式 Host/Client 构建后的真实 Web Loader 测试 3/3 通过；匿名发现返回 401，认证发现与隔离目录内的持久身份一致。三项行为故障对照均被拒绝。完整 lint:contracts-ready 与 doc-sync 34/34 通过；Windows NodeNext 消费检查覆盖 278 个包，完整公共导出损坏也被拒绝，临时 junction 清理保留目标目录。

完整 hygiene 的历史执行为 14 通过、2 失败；其中 NodeNext 已修复并单独验证，ACP 文件符号链接在当前 Windows 检出为目标文本的问题仍未修复，因此不宣称完整 hygiene 通过。失败的 Client 编译产生的 1048 个已确认生成文件已归档并移除；依赖恢复仅保留新增包及两个 workspace 引用，没有无关版本升级。

该阶段只完成发现接口基础；Client 强制发现和同代准入由上节补齐。N/N-1、能力 UI、原生 DTO、完整统一错误、幂等操作及数据转换继续待实施。此前的 unsigned Desktop 安装包不包含后续 Storage/Host/Client 修改。没有新安装包、签名、安装/更新、系统登录、macOS/真机或真实模型验收，Phase 3 保持 IN_PROGRESS。

## Storage owner 关闭顺序

[该阶段来源记录](artifacts/upstream-first/storage-owner-source.json)绑定验收时的 Storage 源码、文档、构建库及验证日志；后续改变的共享输入由封存副本保存。JSON/SQLite 通过 KvFacet.open 的 owner 回调先停止并排空领域工作，再关闭单元和介质；初始化与关闭并发时，有效的初始化以 closed 拒绝，不能返回迟到句柄。独立 owner 全部结束后才报告清理失败，初始化清理错误同时传给正在等待的关闭调用方。未增加另一套生命周期 registry、Session 事件或存储代际。

四个 Storage owner 的定向测试 109/109 通过；最终标量断言调整后，领域测试 38/38 与定向 lint 再次通过。正式 Host 构建后的 Web Loader 录制会话通过 2/2，覆盖等待日志 flush 时关闭真实 JSON 后端，并核对最终标题、序号、身份及完整 Session 日志。三项行为故障对照均被拒绝；返回句柄对照最初遇到对象格式化错误，改成标量结果后确认两个场景均因断言失败而被拒绝。完整 lint:contracts-ready、doc-sync 34/34 和 git diff --check 通过。

历史 checkpoint 及 Storage 输入保留在有摘要校验的归档中；归档不能满足本轮 Host 发现的当前源码校验。Storage 变更未进入此前的 Desktop 安装包，也未验证真实模型或其他平台。Host 发现基础由上节补齐，Client 协商、幂等操作、旧数据转换及其余 Phase 继续待完成，Phase 3 保持 IN_PROGRESS。

## Checkpoint 写入顺序

[本轮来源记录](artifacts/upstream-first/checkpoint-order-source.json)绑定两个存储 owner 的修复与 Web 录制会话。原实现中，较早的 checkpoint 可在较晚的 flush 完成后才入队，最终用旧值覆盖较新的持久化记录；回归已直接复现该旧值落盘。现在 KvTable.put 先占据队列位置，再执行该位置的日志持久化前置操作；失败时不写入、不发事件，后续写入仍可继续，Domain.close 等待已接受的操作完成。

保留上游的投影深复制、formatVersion、isSeeded、inheritedEventCount、旧缓存读取和 Session 日志格式。两套 owner 测试 71/71，真实 Web Loader 组合的 [authored Session 回放](snapshots/web/checkpoint-order/session.v3.jsonl)通过 1/1，逐项比较了标题和恢复产生的权限/sandbox/审批事件。语料门禁 3/3；恢复队列外等待、跳过前置操作两项对照均被拒绝。扫描排除无关的 Python 临时缓存后，新增未登记源码快照也仍被拒绝。Host 构建、完整 lint:contracts-ready 与 doc-sync 34/34 通过。

该阶段来源记录中的后端直接卸载缺口由上节 Storage owner 修复补齐。HostDescriptor、Capability/Version/Error、幂等操作和旧数据转换没有因此完成；当前没有调用真实模型或重建 Desktop/SEA/wheel，之前的产物保持各自来源与验收范围。Phase 3 尚不能据此晋级 Architecture/Contract Gate。

## Windows Desktop 原生运行时与打包应用

[Desktop 打包来源记录](artifacts/upstream-first/desktop-package-source.json)绑定打包前 163 个候选文件及补丁。移除已不属于生产依赖的 fs-ext 检查、安装许可和复制特例；保留当前 Koffi、Sharp、HTML、PTY 原生执行，并通过实际外部插件验证 JSONL 同会话的并发写入拒绝、持有期间读取和释放后接管。Session 实现及存储格式未改变。定向测试 29/29、两项行为拒绝对照、doc-sync 34/34 与完整 lint 通过。

官方 Windows x64 unsigned 命令已生成 0.1.5-rc.2 NSIS 安装包，包含 Node 24.17.0 和 pnpm 11.7.0；包内原生操作、真实 Host 与 Session lease smoke 通过。[产物核验](artifacts/upstream-first/desktop-packaged-output.json)确认候选源码与打包前快照一致、ASAR 的 10 个 Shell/renderer 文件匹配及官方 runtime-tree 完整性。应用 EXE 和安装包的 Authenticode 状态均为 NotSigned；没有执行安装或发布。

[实际打包应用回执](artifacts/upstream-first/desktop-packaged-final.json)记录从 app.asar 和包内独立 Node 启动，加载 51 个 Client 入口，并完成真实页面设置、[浅色](artifacts/upstream-first/desktop-packaged-settings-light.png)/[深色](artifacts/upstream-first/desktop-packaged-settings-dark.png)、托盘隐藏、第二实例恢复、关闭偏好还原及[插件管理页](artifacts/upstream-first/desktop-packaged-plugins.png)只读检查。Shell 退出码为零，已观察的 Host 和子进程均退出。私有数据目录没有模型密钥，未安装 registry 插件、迁移用户数据或注册系统登录。

沙箱启动曾因 GPU 子进程崩溃退出，相同 EXE/参数在主机完成验证。两个 UI 探针分别错用插件页路径、在窗口异步关闭完成前计数；按实际路径和关闭状态补验，原始失败回执保持不变。构建内生成插件的 Loader 验证不等同于公开插件安装；旧 SEA/wheel 的 pnpm junction 拒绝仍未解决。安装、签名、更新、系统登录、macOS、真实模型及完整视觉矩阵仍待验收，Phase 2 保持 IN_PROGRESS。

## HTML 注入查找

共享 Web/Desktop index 渲染器已迁入已审查的线性查找修复：重复且未闭合的 head/body 前缀不再导致反复扫描。保留大小写、空白、带引号属性、注释、缺失标签的文本匹配行为，以及逐字节输出和注入顺序。修复前两项大输入回归触发子进程超时；修复后源码/Loader 组合 34/34、构建后公共导出 30/30、doc-sync 34/34 和 lint:contracts-ready 通过。

[源码记录](artifacts/upstream-first/web-injection-source.json)绑定源码、库产物、回执和检查日志；[构建后验证](artifacts/upstream-first/web-injection-built-smoke.json)使用普通 Node 加载公共导出。后续已在同一源码上运行 Windows Desktop 命令验收，见下节；exe/wheel 尚未重新构建，打包及原生界面结果仍限定于各自记录。

## Desktop Node Host 工具执行

通过官方开发启动器和新建数据目录运行真实 Windows Desktop；标准 Session 使用真实 loop、受限 PowerShell、文件操作和进程管理，仅模型返回由脚本提供。[验收回执](artifacts/upstream-first/desktop-execution-smoke.json)记录正确工作目录、中文文件字节、stdout/stderr、敏感变量过滤、受管 DSH 变量及退出码 37。用户取消后，PowerShell、Node 和孙进程均已退出，日志记录 ABORTED；原生退出后 Shell、Host 与启动器正常结束。

受限孙进程的 Node 管道式 stdio 返回 EPERM，与上游已记录的限制一致；继承 stdio 的进程树取消通过，不表示管道捕获可用。[该次源码与产物记录](artifacts/upstream-first/desktop-execution-source.json)绑定实际模块入口、模型请求和执行回执；缺少 Desktop 场景说明的观察保留为历史，后续补齐见下节。没有调用真实模型、验证 macOS/Bash、安装包或系统登录注册。

## Desktop 模型上下文

官方私有 Desktop Host 通过现有 SystemPrompt 注册说明：当前窗口与 Session 位于同一机器，命令和文件工具使用 Session 工作区及其声明的执行环境，窗口不会隐式提供 DOM、路由或截图，另启 Web server 不会更新当前窗口。完整 persona 会抑制这段说明，移除后恢复；沿用现有 system/message 日志，无新增协议或旧 Desktop bundle。

[Desktop 上下文源码记录](artifacts/upstream-first/desktop-context-source.json)绑定 4/4 行为测试、源码与构建模式各一次 keyless 会话回放、doc-sync 34/34、lint 与实际 Host 构建。[Windows 开发应用验收](artifacts/upstream-first/desktop-context-smoke.json)的默认、完整 persona、恢复三次模型请求均与组装提示和最新日志一致；退出后的磁盘日志含三条匹配提示，Shell、Host 和启动器正常退出。快照为现有 PONG 记录的 authored 派生，应用使用脚本模型；未验证真实模型、macOS/Bash、安装包或系统登录，exe/wheel 未重建。后续工具包修复有独立记录，未重跑完整 Desktop 应用。

## 原子写锁与路径处理

已迁入锁释放检查竞态与路径末尾分隔符线性扫描：EPERM 后检查得到 ENOENT 时立即重试一次独占创建，持续错误仍抛出；长串内部斜杠不再被后缀正则反复扫描。保留上游 Windows rename 重试、路径分隔符和文件地址 API。当前消费者均写字符串，原始字节 API 留待诊断导出存在实际消费者时再审。

[工具包源码记录](artifacts/upstream-first/helper-fixes-source.json)保留修复前的竞态失败与路径子进程超时，以及修复后 81/82 项目标测试结果；剩余符号链接用例在 Windows 主机创建 fixture 时被 EPERM 拒绝，未运行到产品代码。最终锁用例 6/6、doc-sync 34/34 与完整 lint 通过。[普通 Node 构建后验证](artifacts/upstream-first/helper-built-smoke.json)通过 7 个路径用例和 4 个真实文件写入者的并发更新、锁清理。未改变地址语法或模型文本；这些库验证不构成完整应用、安装包或其他平台验收。

## 官方 Windows 进程管理

采用当前 upstream 的 WindowsJobRunner、WindowsJobOwner 与共享 Win32 process 实现，没有迁入旧 bootstrap 或第二个 Job wrapper。[源码与场景记录](artifacts/upstream-first/windows-runtime-review-source.json)映射挂起创建、加入 Job 后恢复线程、失败清理、stdio、直接退出与整个 Job 清空的区别，以及取消和 Host 退出回收。真实 Windows Job 用例 4/4、测试 Host 退出用例 4/4、共享失败路径 26/26 通过。另一个契约套件通过 53 项，两个原有 fixture 符号链接创建受 Windows 权限限制，两个 POSIX 场景在各自套件按原规则跳过；不把这些限制记为完整套件通过。

该记录还收窄了旧 CLI 参数版 wheel 的插件安装故障：[六条入口对照](artifacts/upstream-first/installed-chain-probe.json)证明绕过 Python 入口仍可复现；[同字节独立目录副本](artifacts/upstream-first/runtime-location-current.json)也无法让其 Node 子进程创建 junction。已检查的环境字段、token 组、受限组、权限、完整性级别和默认 DACL 在对照中一致，两个原 exe 没有额外 NTFS 数据流。原生 Python junction 探针在安装入口链中超时，安全属性读取则能完成。根因仍未确认，没有修改 ACL、token、兼容层或系统策略，也没有重新宣布真实 pnpm 安装通过。

安装入口的[原生 junction 分步记录](artifacts/upstream-first/junction-steps-source.json)进一步确认：直接 Python 和仓库 runtime 能创建并读回链接；安装后的同字节 runtime 可以打开私有目录，但 DeviceIoControl 的 FSCTL_SET_REPARSE_POINT 返回 Win32 错误 5（拒绝访问），随后关闭 handle。该次 wrapper 也超过 20 秒观察期限，taskkill 返回 128；这些结果分别保留，不把最终退出码当作未超时。该探针针对已有 CLI 参数版产物，未重建当前源码，也未验证真实插件安装成功；拒绝来源仍未确认。

## Windows 原生目录选择

采用上游 Koffi 指针地址 buffer 与 str16 解码，保留 NUL 终止、Unicode 和长字符串读取；没有恢复旧的固定外部 buffer 或 Win32 字节复制。补齐解码抛错时的 COM 路径释放，既有 item、dialog 和 apartment 清理保持有效。修复前释放回归失败；修复后包测试 53 项通过、1 项按平台跳过，doc-sync 34/34 与完整 lint 通过，见[源码记录](artifacts/upstream-first/picker-source.json)。

[实际 Windows Desktop 验收](artifacts/upstream-first/picker-desktop-smoke.json)通过官方开发启动器、新建数据目录和当前构建 Node worker，经 live Host capability 打开真实 COM 对话框。中文及 emoji 目录精确返回，用户取消返回 null，Abort 在对话框可见后触发并拒绝；三个 worker 均退出，Shell、Host 和启动器正常结束。此证据未覆盖 renderer 的完整工作区选择流程、安装包或其他平台；解码异常时的释放来自单元回归，未进行原生分配器的泄漏测量。此前 exe/wheel 与其他 Desktop 场景保留各自来源记录。

## 测试观察与入口审查

[当前测试记录](artifacts/upstream-first/fixture-observation-source.json)绑定三处测试修改：React 计时器刷新等待 act，文件搜索通过 rename 发布已填充的恢复目录，凭据重载同时核对不同的保留值和已删除项，避免把空文档或旧值当成替换完成。最终三个文件通过 95 项、2 项按原规则跳过；另一个 3 项定向测试进程与其重叠运行通过，doc-sync 34/34 与完整 lint 通过。修改前的三个目标用例也通过，本机没有复现原间歇失败；相关产品源码、运行时超时、CI 路由与会话预期未变。

保留上游显式 Linux/WSL 内核 fixture 及新版 PowerShell held-command/scrollback 观察，不迁入旧超时增大；Linux /dev/tty 输出和初始提示保留仍待平台审查。HMR 入口维持官方 vendor：source/built dsh 和 Desktop Host 以文件启动，锁定的 pkg SEA bootstrap 在载入应用前设置 argv[1]。源码审查没有增加安装包、外部 CLI 或其他平台的运行验收。

## 内置 profile 组合检查

[组合检查记录](artifacts/upstream-first/profile-composition-source.json)绑定实际 CLI profile 清单、Desktop core bundle 顺序与私有 patch，并复用官方解析和组合函数。检查会拒绝最终 Loader 树中的重复 id，以及最终 Host 配置与内置 preset 的重复活跃条目；合法覆盖、独立 profile 复用 id、禁用祖先及未执行的表达式有对应测试。目标测试 34/34、doc-sync 34/34 与完整 lint 通过；没有加入旧 Desktop bundle 或另一套 patch 合并器。

正式命令的前后对照分别证明：重复 headless-runner 和 Desktop 重新启用 command-goal 由接受变为拒绝。最终回执记录实际脚本 SHA；正确配置 fixture 的 155 份配置通过。原 Windows 工作区的完整命令仍失败，因为 ACP 的 Git mode 120000 配置被检出为链接路径文本。验收只临时物化已核实的仓库内目标并恢复原始字节，不改变检出设置、ACL 或源文件；不能将 fixture 通过记为原工作区或安装包通过。来源记录保留该失败日志，平台与插件安装任务仍未完成。

## LSP 请求取消与传输错误

[LSP 源码记录](artifacts/upstream-first/lsp-observation-source.json)绑定请求到达 marker、请求与取消 id 核对、取消后同一实例再次查询，以及真实子进程 stdin 错误在进程关闭前拒绝当前和后续请求。忽略取消的场景先观察子进程结束，再接受查询拒绝。保留上游 LSP 产品源码、生产超时和协议，仅迁入测试观察。

最终两套测试 46/46 通过，同时运行的 6 项定向测试通过；恢复固定等待和移除 stdin 错误传播的两项对照均触发预期失败，原字节已恢复。doc-sync 34/34 与完整 lint 通过。沙箱运行曾在 stdin 用例和退出清理超时，核实并清理本次进程树后，相同测试在主机通过；超时根因未单独确认，失败日志保留。此记录不构成已安装语言服务器、真实外部 CLI、安装包或其他平台验收，相关测试迁移仍有剩余工作。

## Codex 命令完成观察

[Codex fixture 记录](artifacts/upstream-first/codex-fixture-source.json)绑定独立 call id、最新命令结果归属和 yielded session 轮询。只有工具元数据明确给出退出码零才完成；无关或重复结果、非零退出、缺少轮询工具及命令自身打印的成功文本均不能冒充完成。重复 call id 在修复前已复现失败，两项受控漏检也被最终测试拒绝。

本地 HTTP fixture 17 项和真实 Codex 0.153.4 的 Windows 用例 8 项全部通过，另一个进程的 2 项命令测试重叠运行通过。yielded 命令由私有文件屏障保持运行，观察到轮询后才释放；最终核对文件内容及受管进程退出。doc-sync 34/34 与完整 lint 通过，provider 源码、固定依赖、权限模式和生产超时不变。实际 CLI 使用脚本模型，此证据不代表真实模型、安装包或其他平台验收；临时目录别名、PowerShell snapshot 和 featured-plugin 预热警告保留在日志中。

## SDK 与 Claude 等待策略

[当前源码审查](artifacts/upstream-first/sdk-claude-review-source.json)保留上游 SDK 请求观察和 Claude 清理预算。旧 SDK 补丁将轮询放宽至 5 秒，旧 Claude 补丁为 afterEach 固定 60 秒；本机的 SDK 对应测试通过 1 项，Claude Agent SDK 0.3.263 / CLI 2.1.263 的实际 Windows 进程场景通过 8 项，没有迁入两项超时增大。版本、Session projection 和其他上游架构保持不变。

Claude 测试通过本地 Messages fixture 验证设置继承、并发实例、进程失败、拒绝写入、显式 bypass、plan 与取消后进程退出。此记录为源码审查和本机运行证据，不证明 CI 负载下的时序，也不提供真实模型、安装包或 macOS 资格；未修改测试、产品源码或主机设置。

## Windows 产物验证

[Python 入口历史记录](artifacts/upstream-first/windows-wheel-source.json)保留该次源码、exe、sidecar、wheel 与执行回执；最新 CLI/运行时见下节。Windows Python entry 的等待、继承 stdio、复杂 argv 和 DWORD exit 验证完成：21/21 定向测试及四个真实 native ExitProcess 状态通过。smoke 的显式 UTF-8 修复通过 47/47；profile 安装的 pnpm 工作区根目录许可通过 2/2，许可仅作用于本次调用。

保留的 exe 已在 CLI 参数修复后按官方流程完整构建并重新打包，尚未包含本次 HTML 查找修复。[该产物的仓库外 Web 验收](artifacts/upstream-first/packaged-argv-web-smoke.json)验证认证、53 个插件入口、Session RPC、真实 Chrome 设置/明暗切换及退出清理。Windows shutdown 使用测试标记在进程内发出 SIGTERM，没有验证原生系统信号。

[当前已安装 wheel 验收](artifacts/upstream-first/installed-wheel-argv-temp-smoke.json)在 checkout 外安装非 editable SDK/runtime，未设置 PYTHONPATH 或 DSH_RUNTIME_MODE：11/12 通过，sdk-profile-plugin 失败。[非 Temp 对照](artifacts/upstream-first/installed-wheel-argv-normal-smoke.json)只执行该插件场景，同样在 pnpm junction 创建处失败。两者均选择 pnpm 11.7.0 和独立 store；pnpm 10.2.1 忽略 profile 工作区设置属于另一个已发现限制。所检查的进程权限标志一致，但不证明完整 token/ACL 等价，根因尚未确认。未修改全局 ACL、Developer Mode、注册表或 pnpm 配置。

## Windows 插件参数

`dsh plugin` 通过已有的 execa 运行依赖保留字面 argv，避免 Windows shell 拼接导致路径拆分和元字符执行。普通全局 shim 和 node_modules/.bin shim 的真实回归在修复前均失败；修复后 CLI 8/8、源码启动 2/2 和 Python smoke 47/47 通过。官方插件 smoke 的目录现在包含空格、中文和 &，现有预期输出保持不变。

[已安装入口验证](artifacts/upstream-first/installed-wheel-literal-argv.json)证明新 wheel 的公共 dsh.exe 在两种 shim 下均完整传递参数，且没有执行命令标记副作用。该验证使用记录参数的 fixture shim，不代表真实 pnpm 安装成功。新 exe 与两个 wheel 已由官方流程构建并校验；[源码/产物绑定](artifacts/upstream-first/cli-argv-source.json)记录完整构建、安装、Web、参数和失败证据。

## Desktop 旧设置导入

官方 Shell 的原生菜单支持选择旧 JSON/YAML 文件并预览，默认取消；确认后只迁入关闭行为。解析拒绝未知版本、错误字段、重复字段、无效 UTF-8 和超过 1 MiB 的文件；确认时重新验证源摘要。登录偏好仅作提示，系统登录仍由原生菜单与 OS 管理。原文件及其他 namespace 保留，现有托盘和原子写入 owner 保证失败时不覆盖偏好。

[本轮源码/产物记录](artifacts/upstream-first/desktop-import-source.json)绑定 Shell 构建、73/73 定向测试、最终 main 25/25 和双语文档检查。[真实 Windows 回执](artifacts/upstream-first/desktop-import-smoke.json)与[原生预览截图](artifacts/upstream-first/desktop-import-preview.png)记录生成文件的选择、确认、取消、关闭隐藏、恢复、撤销以及 Shell/Host 退出。控件通过 UI Automation 操作；激活恢复通过原生事件回调验证。没有读取旧用户文件、调用模型或注册系统登录。退出时 renderer 记录一条 control-stream network error，两进程均正常退出。

Desktop 导入的源码、Shell 构建与原生回执保持原摘要；后续 CLI 参数修复有独立的新 runtime/wheel 记录。两者都不构成 Desktop 安装包或系统登录验收。

## 历史证据与未完成范围

官方 Desktop 的真实开发页面、设置/主题、独立 Node Host 和退出验证见[初始回执](artifacts/upstream-first/desktop-smoke.json)；真实托盘隐藏、第二实例恢复和退出见[托盘回执](artifacts/upstream-first/desktop-tray-smoke.json)。早期 packaged 和 profile recovery 记录保持原摘要，分别对应当时源码与产物；不以当前文件替换历史证据。具体定向测试保留在[机器回执](artifacts/upstream-first/evidence.json)。

旧 Desktop settings 的关闭偏好已通过原生选择与确认显式导入；Host settings 的完整格式转换及真实用户数据迁移未实施。完整视觉矩阵、真实模型、原生系统信号、Desktop 安装/更新/系统自启动、macOS/Linux 产物及移动真机均未验收。

## 执行入口

继续在 `agents/upstream-first` 和 `.worktrees/upstream-first` 执行[实施计划](docs/plans/2026-09-14-upstream-first.md)。未 commit、push、发布、修改其他工作树或迁移用户数据。

## 文档与审计校验

审计一致性校验通过，准入和任务状态回归 13/13；各次源码/记录/回执篡改拒绝检查与 Desktop 历史绑定拒绝检查通过。其来源文件和命令见机器回执。HTML 修复后的 doc-sync 34/34 与 lint:contracts-ready 已通过；上一轮 CLI 的 test:docs 16/16 保留为该次记录。初次 Windows 文件符号链接权限失败已通过等价 junction fixture 修复，仍断言 realpath 指向仓库外并拒绝复制；定向重跑 69/69 通过。审计源码校验将这项尚未提交的测试改动记录为独立 SHA-256，不把带工作区改动的测试等同于纯 upstream 提交。初次中英目录锚点问题也已修复。

规格依据：[按初始 SHA 恢复的原文](artifacts/upstream-first/original-specification.md)与[完整追踪记录](artifacts/upstream-first/specification-traceability.json)。追踪覆盖不替代逐项验收，未完成范围不因局部测试通过而缩减。
