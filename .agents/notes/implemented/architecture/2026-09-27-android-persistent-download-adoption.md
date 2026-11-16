# Agent Note: Android adopts persistent downloads within the selected Host model

Status: implemented

English | [中文](2026-09-27-android-persistent-download-adoption.zh.md)

## Problem

A complete file can exceed the preview's memory budget. Encrypted transfer progress alone does not establish which application model may continue it, how disk use stays bounded, or whether a pending system-picker result can outlive its resource. The application needs explicit transfer controls and complete-file export while preserving the selected Host grant and cancellation rules.

## Decision

`CompanionRuntime` constructs `NativeDownloadFiles` from the current verified `CompanionInputPrincipal` and the separate `AndroidKeystoreCipher("dsh-native-downloads")`. The application-private `native-downloads` directory retains downloads for their bound Host identity, pinned fingerprint, device grant, Session and resource path. A different grant cannot adopt those bytes. The [checkpoint decision](2026-09-27-android-download-checkpoints.md) remains the authority for encrypted frames, atomic checkpoints, version validation and crash recovery.

`CompanionModelSet` owns `NativeDownloadsModel` alongside its resource observations. Selecting a resource restores only an existing local cache; an absent cache creates neither download files nor a key. Restoration sends no download request. Explicit download or continuation obtains the descriptor through that model's wire and accepts only matching-version windows. Replacing the resource or retiring the Host cancels and awaits network reads, disk work and document export before releasing the store lease. Cancellation during store adoption retains ownership until cleanup completes.

The application uses 64 KiB windows and a 1 GiB content limit per file. `NativeDownloadQuota` caps the shared cache across principals at 2 GiB of stored encrypted files and 128 retained downloads. Admission reserves checkpoint space: 128 KiB for a new transfer, and 64 KiB beyond each encrypted frame during append. A quota failure preserves committed progress and requires capacity to be freed before retry; the application does not evict another download automatically.

Files and Artifact previews present download, pause, continue, completed-download save and confirmed local removal through Chinese Android string resources. Returning to a resource restores local progress without resuming network work. A changed Host version cannot append to the retained prefix. Confirmed removal cancels active work and deletes only that principal's selected cached bytes, progress and temporary checkpoints; it can remove unreadable storage without decrypting it. The Host file and previously exported documents remain intact.

## Complete-file export

`NativeResourceSaver` accepts a complete content source copied in bounded chunks. Its existing preview entry still copies a complete in-memory observation before opening the picker. `NativeDownloadController.prepareSave` instead captures the complete disk checkpoint and copies authenticated windows without another Host read or a whole-file allocation. Disk exports use `application/octet-stream`; the system picker receives a sanitized basename and the user chooses the destination.

Picker approval remains memory-only and is consumed once. Resource replacement, Host retirement or download removal invalidates it. Cancellation, expired results and failed writes discard only the newly created destination; cleanup failure retains its separate outcome. Retirement waits for output I/O and cleanup before the source lease closes. The [snapshot-save decision](2026-09-27-android-complete-resource-save.md) retains ownership of picker lifetime and cleanup, the [resource-reading decision](2026-09-27-android-current-resource-reading.md) retains preview validation and limits, and the [saved-Host decision](2026-09-26-android-saved-host-catalog.md) retains principal adoption. These independent decisions remain active.

## Alternatives considered

**Extend the in-memory preview to hold complete large files.** File size would determine retained heap and process loss would discard progress. The existing bounded preview remains useful independently of a persistent download.

**Restore and continue every saved transfer automatically.** Saved progress is not network approval. Opening a resource restores only its local state; download and continuation require an explicit user action.

**Give each screen or Host switch an independent downloader.** Concurrent owners could retain stale request authority or contend for the same encrypted store. The Host model serializes resource selection and awaits retirement before ownership changes.

**Use DownloadManager or a fixed public destination.** A generic URL download does not preserve signed Native Gateway admission and descriptor checks. The system picker supplies an explicit destination for complete authenticated content.

## Consequences

Core coverage pins local-only restoration, principal isolation, bounded disk export, refusal of stale picker results, awaited transfer and export retirement, cancelled selection and removal, corrupt-cache removal, and byte/entry quotas. Snapshot-save coverage remains applicable to its in-memory entry.

The [installed download scenario](../../../../apps/web/tests/android-download-adoption.e2e.ts) passes against a real Host on an Android emulator. It terminates the process during a 9 MiB download, restores exactly 256 KiB as paused progress, and verifies explicit continuation from the first missing byte. Large and empty files saved through the system picker have independent destination SHA-256 values matching Host bytes. Changed versions cannot append, and confirmed local removal preserves the Host file and exported document.

The [two-Host scenario](../../../../apps/web/tests/android-download-host-isolation.e2e.ts) passes with different 9 MiB contents under the same Session id and relative path. Host B starts at byte zero without inheriting Host A's progress. Returning to Host A restores its 128 KiB prefix as PAUSED; opening either resource reads only its 256-byte preview, and download continuation remains explicit. The scenario checks preview content, committed progress and every requested byte range, including no further byte reads from the other Host. It does not independently export and hash both Hosts' complete content.

The [snapshot-save scenario](../../../../apps/web/tests/android-resource-save.e2e.ts) passes against the installed emulator application. The three [installed picker tests](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeResourceSavePickerTest.kt) also pass, covering picker intent and callback ownership. These results qualify the tested emulator and system document provider; they do not establish physical-device or third-party-provider acceptance.

The [acceptance driver](../../../../apps/web/tests/android-companion-ui-driver.ts) requires explicit installation of both the application and instrumentation APKs. Before starting instrumentation, it compares each installed APK's SHA-256 with the current build artifact and refuses a mismatch. Both APKs were explicitly installed and hash-matched for the passing Host scenarios. An earlier real-Host run used stale installed APKs and did not qualify the current build; explicit installation, hash matching and a successful rerun corrected that evidence. The two [APK admission rejection tests](../../../../apps/web/tests/android-apk-admission.e2e.ts) confirm that a mismatched application or instrumentation APK prevents launch and releases the driver lease.

This integration adds no background scheduler or automatic cache eviction. Power-loss durability, rollback resistance, hardware key failure, physical devices, third-party document providers and all-platform File/Artifact descriptor acceptance remain unqualified.
