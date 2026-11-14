# Agent Note: 第 10 节手机档 header 溢出菜单

Status: implemented

[English](2026-10-03-header-overflow.md) | 中文

## 问题

第 10 节手机线框的顶栏以 ⋮ affordance 收尾。手机顶栏增量交付了 leading 座位、返回会话控件与运行位置 chip 的状态圆点，但溢出菜单保持开放，理由是「其条目取决于尚不存在的工具栏集合」——如实不预造。该阻塞经查是自造指称：81 节规格任何地方都没有定义 ⋮ 条目，线框只画了 affordance 本身。

## 决策

- 条目问题以聚合解决、不以预造解决：⋮ 菜单承载 header 既有的两个次要列表——`conversation.session.header.actions` 与 `conversation.session.header.utilities`——这是唯一有真实控件清单支撑的读法（今日占用：actions 里是 agent preset、jobs、schedule；utilities 里是 open-in-app）。
- ⋮ 是 strict header 自有的手机档布局决策而非新座位：`ConversationSessionHeader` 经 `usePhoneTier()`（`matchMedia('(max-width: 599.5px)')` 订阅——与既有全部手机档 affordance 同档，如 leading 返回钮与抽屉开关）决定两列表渲染在内联（宽档，标记与之前逐字节一致）还是 `HeaderOverflowMenu` 内（手机档）。每个列表恰好在唯一容器里渲染一次，无重复挂载。
- 位置裁定：运行位置 chip 留在栏内（第 10 节强制醒目显示运行位置、线框中 `Host ●` 即内联），最右 corner 保持其单座位占用者（右侧栏 ExpandButton）——⋮ 触发器位于 utilities 行末端、与 chip 相邻，正合线框 `Host ● ⋮` 的画法。挤走 corner 占用者或把 chip 埋进菜单两个方向都被否决。
- 触发器在手机档 header 渲染时即渲染（线框无条件画出它）；portal 面板沿用 `ScheduleCatalogAction` 配方（`useAnchoredPosition` + `useDismissOnOutsidePointer` + Escape 关闭并把焦点还给触发器），两列表皆空时显示本地化空态行。
- 一个新手写字形（`IconOverflowVertical16`）按既有手写产品字形惯例进入 primitives 图标集；两个 locale 键（`session.overflow.aria` / `session.overflow.empty`）双语落地。

## 备选方案

- **等待真实的「工具栏集合」：** 该指称不指向任何节、没有任何控件清单，等它等于无限期搁置线框 affordance。
- **新增 `header.overflow` 座位：** 溢出是 header 属主的布局决策，不是新的控件注册点；既有座位保持各自属主。
- **纯 CSS 折叠：** 媒体查询无法在容器间移动已挂载元素，而把两列表渲染两份（内联+面板）会让有状态占用者双重挂载。

## 后果

- 手机档用户在固定位置获得全部 header 控件；宽档标记与之前逐字节一致（`matchMedia` 缺席时默认宽档，如 node e2e 启动）。
- 两列表的占用者无需任何改动即渲染进 portal 面板；`ui-conversation` 与图标集之外零改动。

## 开放工作

- 完整尺寸/主题/状态/访问性矩阵、iOS/Android 真机输入、后台与原生附件验收对第 10 节仍开放；⋮ 面板在触屏设备上的指针体验仅由共享锚定面板机制覆盖，无设备车道。
