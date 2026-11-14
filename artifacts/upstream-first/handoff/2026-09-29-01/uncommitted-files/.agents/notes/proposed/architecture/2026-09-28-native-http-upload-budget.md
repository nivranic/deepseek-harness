# Agent Note: Native file uploads use the receiving listener's complete HTTP body budget

Status: proposed

English | [中文](2026-09-28-native-http-upload-budget.zh.md)

## Problem

Android bounds file bytes and encoded upload arguments locally, but the Native HTTPS listener rejects the complete buffered HTTP body. RPC metadata and signed admission consume bytes outside the arguments. A file can satisfy Android's local limits while its actual request exceeds the listener's limit. Raising the local limit or estimating envelope overhead does not resolve that mismatch.

A device adapter that captures the original Gateway service receiver can dispatch an isolated Native listener's calls through another Cordis context while that listener enforces its own HTTP limit. Publishing a budget without preserving the calling context could report another listener's value, including when the only Native listener exists in the isolated context.

## Proposal

Replace the shared device adapter with the ordinary service method `createDeviceConnection(): TypertGatewayDeviceConnection`. Each Native listener calls the factory through its own context; the returned RPC and stream closures retain that calling receiver. The factory is not a Remote method. Signed admission, pairing's sole unsigned exception, permissions, revocation and stream cleanup remain in the existing Gateway dispatch. The factory does not clone Gateway state or expose decoded trusted-local invocation as a native transport.

Expose `nativeRemote/httpRequestBudget` with the independent `native-remote.http-request-budget.v1` capability and `view` permission. Its `NativeHttpRequestBudget.maxRequestBodyBytes` value comes from the same validated configuration used by the receiving Native listener. It describes an inclusive complete UTF-8 JSON body limit, including RPC metadata and signed device admission, and excludes HTTP headers, TLS and chunk framing. Listener unavailability fails instead of returning a guessed value. Administrative listener metadata retains its `device.admin` requirement.

For each explicit `fileUploads/upload`, Android first admits the known file-upload and budget capabilities, reads the budget from the same verified Native client, and validates a positive safe integer. It then creates one RPC identity, one fresh admission and one final UTF-8 byte array. The client rejects an oversized body before creating the HTTP call; an admitted request sends those exact checked bytes. No budget cache, second serialization, automatic retry or default Host limit is introduced.

The budget observation neither reserves capacity nor grants upload permission. The Host still enforces its actual byte limit and current device authorization. A lower proxy limit or a changed Host configuration can still reject a request that passed the local check. Invalid or failed budget discovery preserves its existing failure category; only an observed local body excess maps to the attachment model's `REQUEST_TOO_LARGE` issue.

The local 512 KiB source, 1 MiB encoded-arguments and eight-attachment limits remain independent constraints. The transport check covers every `fileUploads/upload` caller, including file shares. Image uploads keep their separate path. Failed queries or uploads cannot replace a pending intent or partially adopt a shared batch; explicitly selecting a new source is the recovery action.

## Alternatives considered

**Advertise one global Host budget or count listeners.** A global value does not identify the listener that received this request. Listener count cannot prove correct dispatch when only an isolated listener exists.

**Call trusted-local `invoke()` or `stream()` from a replacement adapter.** Those methods do not perform native signed admission. Reusing them would change the authorization path instead of correcting the caller context.

**Estimate base64 overhead, compare string length or replace the source-file limit with the Host budget.** JSON escaping, non-ASCII text, metadata and admission all contribute to the actual body. A body limit is not a source-file size or an allocation target.

**Cache a successful budget or retry a rejected mutation automatically.** Cached observations can outlive their listener or principal, and transport failure can leave an ambiguous upload result. A fresh read and an explicit upload keep those lifetimes separate.

## Acceptance criteria

Gateway tests must distinguish retained root and isolated adapters for both RPC and streams, including signed admission, permission refusal, revocation and cancellation. Real TLS listeners with different limits must report the receiving listener's metadata and budget; isolated-listener-only composition and sibling disposal must preserve the same ownership rule.

Host tests must admit actual signed encoded-file bodies at B−1 and B bytes and reject B+1 before upload or storage admission. Android tests must measure the complete body, exercise direct calls without UI admission, and reject invalid budgets, missing or unknown capabilities, and late results after Host replacement. File-share failures must preserve atomic local adoption.

Installed SAF evidence must show a real local budget refusal without a file POST or prompt, followed by explicit smaller-file selection, verified Host bytes and one accepted message. Budget reads are counted separately. Existing Files, receipt recovery and share behaviors require focused regression evidence. Test results remain pending until their owners execute and inspect them.

## Risks

This proposal depends on the context-bound factory proof; a passing single-listener budget example cannot replace it. The retained [Native transport decision](../../implemented/architecture/2026-09-25-native-remote-connection-source.md), [device-admission decision](../../implemented/feature/2026-09-21-per-request-device-admission.md), [Files decision](../../implemented/architecture/2026-09-27-android-file-attachments.md) and [Share decision](../../implemented/architecture/2026-09-28-android-share-intake.md) continue to own their separate security, source and input lifetimes. This work does not establish streaming, resumable or image-body budgeting, physical-device behavior, Swift adoption or complete Mobile Release acceptance.
