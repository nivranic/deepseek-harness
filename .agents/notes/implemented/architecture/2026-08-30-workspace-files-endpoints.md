# Agent Note: Read-only workspaceFiles Remote endpoints

Status: implemented

English | [中文](2026-08-30-workspace-files-endpoints.zh.md)

## Problem

The companion's Files/Diff surface (nativization plan chapter 54) needs host-side read-only browse and read verbs, but the remote allowlist carried no file endpoints and nothing decoded a file-entry vocabulary natively. Chapter 54 mandates workspace authorization, path normalization, root containment, path traversal rejection, size limits, mime detection, a binary guard, and range reads — and says to reuse the existing workspace controller and its APIs rather than invent a parallel file service.

## Decision

`dsh-api-workspace-controller` gained a third Remote owner: `WorkspaceFiles` (`ctx.workspaceFiles`, namespace `workspaceFiles`) mounted as a child of the workspace controller like the directory-picking child, pending until a filesystem backend is composed — the shipped desktop composition already satisfies it because `dsh-fs-sandbox` registers `ctx.fs`. Two verbs, `list` and `read`, take flat wire parameters (the gateway maps method parameters to args fields one-to-one, the directory-picker's shape — a single request-object parameter would demand a nested `{request}` wrapper on the wire). Containment is canonical, not textual: the controller resolves the registered Workspace root and the normalized relative path through the fs capability and requires `fs.contains(root, target)`, so string-level `..` normalization is only a convenience filter while a directory junction (the Windows-traversable analogue of an escaping symlink) pointing outside the root is rejected after resolution — proven by a junction test that runs unprivileged everywhere. Reads are text-only with the backend's `FS_NOT_TEXT` binary rejection surfaced as `file-binary`; the byte cap (`maxReadBytes`, a schemastery plugin config defaulting to 256 KiB) applies to the unbounded read and the returned range, while an explicitly bounded page may read a file larger than the cap — paging is how a companion reads big files, a distinction the host spec forced by failing the first cap design. Ranges are UTF-16 code units (`offset`/`limit`, `truncated`, total `size`), which Swift and Kotlin both count natively. Media types come from a compact extension map with `text/plain` as the decoded-text fallback. The remote allowlist carries `workspaceFiles/list` and `workspaceFiles/read` at observer level, and `dsh-link-contracts` models `LinkFileEntryType`/`LinkFileEntry`/`LinkFileListValue`/`LinkFileReadValue` with fixtures pinned to the real controller types, riding the existing drift gate.

## Consequences

A paired device can browse and read any registered Workspace's text tree read-only; nothing else about the filesystem is remote (no listing outside registered roots, no writes, no raw bytes). The desktop-composition e2e now proves the verbs answer through the shipped bundle's gateway bridge — including the traversal rejection over the wire — and that e2e boots the built `lib/`, so contract changes there need `build:lib:host` before e2e runs (the src-running unit spec alone hid a stale-lib 404). The host spec covers containment (textual and canonical), normalization, kinds, ranges, cap semantics, the binary guard, and wire-boundary validation over the real local backend. Files beyond text (image preview, artifact download) remain future endpoints; the Diff surface reads whole files through `read` ranges.

## Alternatives considered

A dedicated `files` namespace package was rejected — chapter 61 says to extend the existing owner, and the controller package already hosts multiple Remote owners behind capability-gated children. Textual containment (string prefix checks on normalized paths) was rejected: only canonical resolution plus `contains` catches links and case/separator aliasing. A request-object parameter (the `workspace/create` shape) was rejected for these verbs because the flat form matches the picking verbs and the companion's arg-building style; the generated registry's `{request}` wire shape stays with the mutation verbs that already use it.
