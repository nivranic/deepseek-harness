# Agent Note：打包 Electron 运行时下 Win32 文件夹对话框的结果读取会致命失败

Status: implemented

[English](2026-08-19-win32-dialog-result-reader-fatal.md) | 中文

## Problem

[2026-08-19-electron-exe-node-children](2026-08-19-electron-exe-node-children.zh.md) 让对话框 worker 在打包 exe 下以 Node 模式启动之后，**完成一次文件夹选择**仍会杀死 worker：用户确认目录的瞬间应用报 "win32 folder dialog worker exited before reporting a result"，而取消路径一直正常，同一份代码在纯 Node 开发启动下也从不复现。死亡点是 `readUtf16`——取消路径永远不会执行它：`koffi.view(address, 32768)` 在原生内存上创建 external ArrayBuffer，而打包应用以 Electron-as-Node 运行时，N-API 层对这种创建直接致命拒绝（立即 `napi_fatal_error`、退出码 134——没有 JS 异常、没有 IPC 消息，驱动只能看到退出）。同一调用还有两个事实：固定 32 KB 的物化在 `view` 可用的运行时里也会越界读 CoTaskMem 的小字符串分配；koffi 的 `_Out_ void **` 出参数组在成功时确实会回填原生指针（两种运行时均已实证），所以周边的出参代码从来不是缺陷所在。

## Decision

[`readNativeUtf16`](../../../../packages/host/directory-picker-native/src/win32-dialog-bindings.ts) 取代基于 view 的读取器：`kernel32!lstrlenW` 量出精确字节长度，`kernel32!RtlMoveMemory` 把 `(length + 1) * 2` 字节拷进自有 Buffer，字符串从这份拷贝解码。两个函数都是文档化的 Win32 ABI，worker 运行的每类 Windows 宿主都可达，且拷贝只触及字符串自己的分配。koffi 表面移除 `view` 入口；fake-koffi 测试世界对任何 `view` 调用直接抛错，在单元层钉死回归；win32-only 的真实 COM 测试用真实的 `IShellItem::GetDisplayName(SIGDN_FILESYSPATH)` 结果地址走一遍读取器并断言路径——正是打包应用里死掉的那个原生状态。

## Alternatives considered

**`koffi.decode(address, 'str16')`（两参与三参形式）。** 依证据否决：对裸出参地址，纯 Node 与 Electron-as-Node 下同样段错误。

**按精确长度限界的 `koffi.view(address, exactBytes)`。** 依证据否决：external ArrayBuffer 的创建本身就是致命面——Electron-as-Node 下无论请求多长都会死。

**升级 koffi。** 否决：在原生内存上创建 external ArrayBuffer 是被移除的 V8 表面，不是我们能用版本钉住的 koffi 缺陷；基于拷贝的读取器拥有自己的全部机制。

## Consequences

打包 exe 的选择/添加工作区流程能重新完成真实选择；用用户的出错路径（`E:\Mix\project\AllTestInOne`）以完全相同的读取器代码，在纯 Node 与安装版 exe 的 Electron-as-Node 运行时下各验证六轮，再经重建的安装版复核。真实 COM 回归测试在每台 win32 宿主、以测试进程自身的任意堆运行，读取器因此持续受钉——尽管这个打包专属的失败模式无法在 vitest 里无密钥地断言。`Koffi` 现在是导出的结构化接口，因为该测试要用它为真实 koffi 模块定型。
