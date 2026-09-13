# Agent Note: Apple Companion archive evidence

Status: implemented

English | [中文](2026-09-07-apple-companion-archives.zh.md)

## Problem

A successful simulator build does not identify the device executable offered for distribution. A Direct Host candidate requires separate runtime embedding and native acceptance; archiving its bare Xcode shell cannot establish a Full runtime candidate.

## Decision

The [archive workflow](../../../../.github/workflows/apple-archives.yml) selects an exact clean commit and archives the existing iOS device and universal macOS Companion schemes in Release configuration. Xcode signing is disabled and embedded provisioning profiles are rejected. Repository-owned product identity, archive metadata, executable platform load commands and architecture sets must agree. The retained ZIP is extracted and its regular-file bytes, Unix permissions and internal symbolic links must match the original archive inventory.

ZIP encoding excludes resource forks, extended attributes and ACL metadata. macOS extraction can consume AppleDouble members as filesystem metadata, making an unlisted member invisible to a subsequent regular-file inventory. The [serialized-member verifier](../../../../scripts/release/apple_archive_zip.py) therefore compares every encoded member with the inventory before extraction, including bytes, permissions and internal link values. The filesystem round trip still checks the resulting archive.

The archive report binds source, producer inputs, toolchain and file digests, but it is deliberately distinct from a validated [RC platform receipt](2026-09-06-candidate-artifact-integrity.md). Startup, distribution export and Full runtime production remain absent from this report. An iOS simulator cannot substitute for startup of the device archive. These checks extend [application release identity](2026-09-05-product-release-identity.md) and the [Xcode shell assembly](../architecture/2026-08-30-xcode-app-shells.md); those decisions retain their separate ownership. The [Direct Host isolation decision](../architecture/2026-08-31-macos-direct-host.md) still governs its target.

## Alternatives considered

Python's standard-library `plistlib` reads XML and binary archive metadata, including dates that JSON cannot represent. Only `ApplicationProperties` is projected into JSON; the original plist bytes remain in the archive inventory. The reader does not convert the entire archive plist through `plutil`.

- Reusing the simulator app as a device archive would bind acceptance to a different executable platform.
- Including the Direct Host shell as a Full artifact would assert runtime functionality that its target does not contain.
- Adding signing credentials to obtain archives couples build verification to an external production operation. Archive generation needs neither signing secrets nor store access; a linker-created ad hoc code signature is not a production signature.

## Consequences

The standalone workflow can expose archive failures while runtime supervision, signed installation and the complete RC producers remain separate work. Its read-only GitHub permission and successful-build upload condition do not grant distribution authority. Actual archive acceptance depends on macOS/Xcode execution; parser and filesystem rejection tests run on other hosts, with POSIX symbolic links verified on Linux and macOS. SBOM ownership, signed device startup and the Full runtime are outside this archive inventory's claims.
