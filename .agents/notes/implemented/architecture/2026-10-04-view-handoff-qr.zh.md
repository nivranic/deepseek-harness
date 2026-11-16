# Agent Note：Web 交接动作把查看位置链接渲染为 QR 码

状态：已实现

[English](2026-10-04-view-handoff-qr.md) | 中文

## 问题

§26 Web 生成端已交付链接复制，但跨设备投递仍需人把链接粘贴进某个消息通道。规格把「QR 渲染与真实跨设备投放通道」留作外壳工作；其中 QR 一半可本地交付——手机相机是不需要消息往返的投递通道，且仓库已为设备配对面板引入 `qrcode.react`。

## 决策

在同一次点击打开的锚定弹层中，把被复制的同一条交接链接渲染为 QR 码：

- `qrcode.react@^4.2.0` 进入本包 `devDependencies`（浏览器第三方构建输入；tsdown 内联进 `lib/client.js`），以 `QRCodeSVG` 渲染，`size` 200、`marginSize` 4，与配对面板一致。零新供应链面：该库已是仓库依赖。
- 弹层逐字沿用仓库锚定面板配方（`ui-schedule` ScheduleCatalogAction / `ui-conversation` HeaderOverflowMenu）：`useAnchoredPosition` 向下锚定带隐藏量测过程、`useDismissOnOutsidePointer` 把 portal 面板计为内部、Escape 关闭并把焦点归还触发器、面板 portal 到 `document.body` 并用共享卡片配方（fixed、z-100、`--dsw-specific-menu`、圆角 20、海拔变量）。
- 触发器保持原行为——编码、置链接、复制、状态——并额外打开弹层；QR 编码的正是被复制的链接，扫描投递与复制完全一致。剪贴板拒绝时的 title 降级回退不变，仍是 portal 不可用时的路径。
- 无障碍：触发器 `aria-haspopup="dialog"` + `aria-expanded`（这是自由内容弹层而非条目菜单），面板以本地化 `scan` 键标注，该键同时作为 SVG 的 title（配对面板的测试钩子先例）。

## 备选方案

- **canvas 或 data URL 渲染**：弃——`QRCodeSVG` 是纯 SVG，jsdom 无需 canvas 桩即可断言（否则要引入 pdf 车道那类 canvas 工厂假件）。
- **第二交互（单独的「显示 QR」按钮）**：弃——一次点击同时复制+展示贴合该动作单一安静的 affordance；QR 内容与剪贴板字符串永无差别。
- **新 QR 库（`uqr`、`qrcode-generator`）**：弃——`qrcode.react` 已在树内、ISC 许可、自带类型、零运行时依赖；第二个 QR 实现只增加面不删除自有代码。

## 后果

- 车道新增三例（QR 以本地化 title portal 渲染、Escape 关闭并还焦、外部指针关闭）；既有五例不变通过。
- `react-dom` 与 `@types/react-dom` 进入 `devDependencies`（本包此前没有 `createPortal` 消费者）。
- `THIRD_PARTY_NOTICES.md` 无需新行（qrcode.react 的 ISC 行已存在）；lockfile 只记录 workspace 链接。
- 深链接与平台分享路由仍是 §26 开放的外壳工作；本次只交付 QR 渲染子句。无模型可见表面变化。

## 开放跟进

- 深链接（原生平台的 `#dsh-view=` 接入）与平台分享路由仍属 §26 延后工作。
- 真实物理设备扫描验收仍属 §26 设备矩阵。
