# Agent Note: CompanionUI files browser

Status: implemented

English | [中文](2026-08-30-companion-files-view.zh.md)

## Problem

The host had just shipped the read-only `workspaceFiles` endpoints with their contract models, but the companion had no surface consuming them: nothing listed registered Workspaces, browsed a tree, or read text with the host's paging semantics, and the host's failure vocabulary (file-too-large, file-binary, path-outside-workspace) had no native presentation. The interaction view model also still referenced a summary helper the domain-state refactor had removed — a live break masked by the absent compile lane.

## Decision

`FilesViewModel` owns three wire surfaces: the observer-allowlisted `workspace/follow` stream seeds and maintains the Workspace picker (baseline plus upsert/remove; order and archive frames do not affect which Workspaces are browsable and are ignored), `workspaceFiles/list` browses one Workspace's tree with root-relative paths the model threads itself, and `workspaceFiles/read` reads text. The reader consumes the generated `LinkFileListValue`/`LinkFileReadValue`/`LinkFileEntry` models through the `ContractCodec` bridge. Paging rides the host's own semantics: an unbounded read the host refuses with `file-too-large` is retried automatically as an explicit page (`offset 0`, `limit 65_536` UTF-16 units), `loadMore` appends the next page and tracks `loadedUnits`/`totalUnits`, and the refusals render as Chinese reader state (`file-binary` as 二进制文件，无法预览, `path-outside-workspace` as 路径越出工作区根, plus not-found/kind/workspace cases). `FilesView` is the fifth tab: workspace menu, directory list with kinds and sizes, go-up navigation, and the inline reader with its page counter and media type. The interaction view model's dead reference became a local `detailText` probe. FakeWire grew sequential per-method answers (`stubSequence`), which is what paging tests need — one wire method answering differently across calls.

## Consequences

The Files module of plan chapter 50 is now a full native surface over the host's read-only endpoints, and the cap-retry behavior means a large-but-browsable file never dead-ends. The view model tests cover registry following, root listing with argument shapes, nested navigation and go-up, whole-file reads, the too-large → page → loadMore sequence with exact wire arguments, and both failure presentations; Swift remains authored-not-compiled on this host (standing macOS-lane caveat), with the contract models and fixture bytes carrying decode correctness. Upload attachment and artifact download remain the plan's future endpoints; this surface deliberately exposes no mutation.

## Alternatives considered

Parsing the file-too-large message for sizes was rejected — `refused` carries code and message only, and the page size is the client's own policy. A dedicated page-size wire parameter was rejected — the host already accepts an explicit bounded limit above its cap; that is the paging contract. Presenting the reader as a sheet was rejected for now — an inline section keeps the list context (siblings stay visible) without a second navigation stack.
