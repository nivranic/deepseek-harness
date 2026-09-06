# Application release identity

English | [中文](product-release-identity.zh.md)

## Summary

Application packaging reads one SemVer from the [root manifest](../../package.json) and a build number and channel from [release metadata](../../release/product.json). Generated platform inputs preserve that identity without changing Link protocol, contract, or Session format versions. This reference covers identity validation; signing, distribution, and release promotion require their own artifact evidence.

## Table of Contents

- [Version ownership](#version-ownership)
- [Distribution channels](#distribution-channels)
- [Generation and validation](#generation-and-validation)
- [Platform consumers](#platform-consumers)
- [Dev Note](#dev-note)

-----

<a id="version-ownership"></a>
## Version ownership

The root `package.json.version` is the application SemVer owner. `release/product.json` accepts exactly `schemaVersion: 1`, `buildNumber`, and `channel`. Build numbers are explicit integers from 1 to 65535. A new distributed candidate must advance the previous distributed build number across versions and channels; retrying the same artifact retains its identity. The comparison belongs to candidate distribution, while the parser validates each individual identity.

The release sequence accepts canonical SemVer without build metadata. Numeric version components fit Windows unsigned 16-bit file-version fields. The generated marketing version removes the prerelease suffix; the full SemVer remains available in embedded metadata. Source SHA and artifact digests belong in the candidate manifest, avoiding a self-reference in committed generated files.

-----

<a id="distribution-channels"></a>
## Distribution channels

| Channel | Accepted application version | Distribution meaning |
|---|---|---|
| `dev` | Any accepted version | Development artifact |
| `canary` | Prerelease required | Explicit prerelease audience |
| `beta` | Prerelease beginning with `beta` or `rc` | Beta candidate |
| `stable` | No prerelease | Stable candidate |

Channel metadata grants no publishing authority, enables no capability, and does not select a runtime composition. Upload and promotion controls remain the responsibility of the release workflow.

-----

<a id="generation-and-validation"></a>
## Generation and validation

Run from the repository root after editing the version or release metadata:

```sh
pnpm run gen-product-identity
pnpm run verify-product-identity
```

The generator writes [the common JSON](../../release/product.generated.json), [Android properties](../../apps/android/product-version.properties), and [Apple xcconfig](../../apps/apple/Config/Product.xcconfig). Repeated generation is byte-identical. The verifier reports stale or missing files without repairing them and participates in static and hygiene checks. Malformed metadata, unknown fields, invalid versions, and incompatible channel/version pairs fail before generation.

The dsh release planner validates the requested version against release metadata before writing manifests, then includes generated native inputs in its normal version commit. Vendor version planning remains independent. `release:dsh --dry-run` prints the plan without modifying manifests, generated files, or Git history; it does not distribute an artifact or prove a release is ready.

-----

<a id="platform-consumers"></a>
## Platform consumers

| Consumer | Version representation | Embedded channel |
|---|---|---|
| Android | Full SemVer `versionName`; integer `versionCode` | `ai.deepseek.dsh.distributionChannel` |
| Apple applications | Numeric `MARKETING_VERSION`; three-part `CURRENT_PROJECT_VERSION` | `DSHDistributionChannel` |
| Windows candidates | Full SemVer package and PE product version; four-part numeric file/product version | Staged package `dshProduct.channel` |

Apple build numbers map monotonically to `1 + floor(n / 10000)`, `floor(n / 100) % 100`, and `n % 100`; Windows uses `<major>.<minor>.<patch>.<n>`. Thus build 12345 maps to Apple `2.23.45`. Apple metadata also retains `DSHProductVersion` and `DSHBuildNumber`.

Android consumes the generated properties during Gradle configuration. All three Apple app schemes consume the generated xcconfig; the [Apple workflow](../../.github/workflows/apple-swift.yml) compares resolved Debug settings and built Info.plist fields using [the artifact verifier](../../scripts/verify-apple-product.ts). Windows staging refuses stale generated inputs and a staged package version that differs from the root. The [Windows candidate producer](../../scripts/desktop-packaging.ts) rewrites every main-executable PE version resource in `afterPack`, before NSIS and portable targets collect the executable. Numeric file/product versions include the build number; localized `ProductVersion` strings retain the full SemVer. Malformed, signed, and missing-version inputs fail. The producer disables publishing and certificate-backed signing. Signed packages, installer behavior, and Release archives require separate platform validation.

-----

<a id="dev-note"></a>
## Dev Note

The [application identity decision](../../.agents/notes/implemented/process/2026-09-05-product-release-identity.md) preserves version ownership and platform limits. The [npm release sequences](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md) continue to own package publication.
