# Agent Note：手机层将侧边栏呈现为悬浮抽屉

Status: implemented

[English](2026-09-20-phone-tier-overlay-drawer.md) | 中文

## 问题

规格 §7 要求视口低于 600px 时侧边栏不再占据网格轨道：对话区横向占满，导航以悬浮抽屉形式触达用户。而框架此前在所有层都保留 56px 折叠轨道，375px 视口下对话区只剩约 319px，轨道永久钉在左缘，展开侧边栏还会进一步挤压内容。

## 当前上游边界

对实际交付的 Web UI 做一次 chrome-devtools 实测矩阵（375/720/960/1440 四层加 599/600 边界；日志与截图在 `.artifacts/responsive-matrix/`）即 §6/§7 布局行为的验收记录。jsdom 组件测试无法充当该记录：它们断言组件自身状态而非真实网格布局——下文的轨道滑移缺陷正是这样在全绿测试下存活下来的。

## 决策

- `ui-layout`：低于 `SIDEBAR_OVERLAY_MAX`（600）时框架不再保留侧边栏轨道。侧边栏列整体脱离文档流（absolute、280px、带阴影），打开时滑入并压在遮罩之下；点击遮罩与 Escape 都经同一个 `toggleSidebar` 动作关闭。三根框架列显式声明 `grid-column: 1/2/3`：脱离文档流的子元素不再占用轨道，若不显式定位，自动布局会把中栏滑进侧边栏的零宽轨道（首轮实测中栏宽度为 0——jsdom 不可见，真实浏览器一目了然）。
- `ui-sidebar`：向输入框的 `conversation.input.left` 列表席位注册 `PhoneDrawerButton`（32px 面板图标按钮，仅由 `max-width: 599.5px` 媒体查询显示），id 为 `sidebar.phoneDrawer`。输入框是唯一在所有状态下都挂载的框架元素，因此空白首页与活动会话都能触达抽屉。
- `ui-conversation`：`conversation.input.left` 从 `session` 放宽为 `session-maybe` 作用域，并与 `conversation.input.attachments` 一样无条件渲染，占用方在无 Session 时也存在。slot catalog 由契约重新生成（`pnpm run gen-client-catalog`）。

## 备选方案

手机宽度保留轨道并收窄抽屉被否决：§7 明确要求对话区占满全宽。把开关放进会话头部的 corner 席位会复制 ui-sidebar-right `ExpandButton` 的模式，但该席位只在有 Session 时存在——空白首页这个手机最常见的入口状态将完全没有开关。为抽屉打开状态引入 store 则没有必要：布局 store 的 `narrowExpanded` 覆盖值本就服务于 1024 以下折叠层，抽屉直接复用它。

## 后果

低于 600px：侧边栏轨道 0px、中栏全宽、无横向溢出；抽屉在遮罩之上展开为 280px，中栏与输入框宽度不变；遮罩点击与 Escape 关闭。恰为 600px 时回到轨道层。高于 599.5px 时抽屉开关 `display:none`。`PhoneDrawerButton` 不持有 store；框架持有几何，侧边栏插件持有交互入口。输入框左侧输入区现为 session-maybe 且在无 Session 状态渲染，后续占用方必须容忍 `sessionId === undefined`（与 `conversation.input.attachments` 的占用方相同的容忍度）。
