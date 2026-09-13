# Product diagnostic records

English | [中文](product-diagnostics.zh.md)

## Summary

Product diagnostics correlate fixed error categories with version, build number, source commit, platform and runtime class. The [collector](../../scripts/collect-product-diagnostics.ts) projects existing native reports without copying exception messages, paths, module names, stack frames or business content. Collection completeness and release acceptance remain separate facts.

## Table of Contents

- [Collection](#collection)
- [Record format](#record-format)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

-----

## Collection

Windows collects a record after installer acceptance fails. Mac Host collects one when its native test interval produced a crash-report result; a missing interval produces no record. Both workflows require the exact clean candidate checkout and current generated [product identity](product-release-identity.md). They retain `product-diagnostics.json` beside the native report in the corresponding artifacts.

The collector requires `--platform windows` or `--platform macos`, `--directory` and a positive `--max-input-bytes`; workflows supply 4194304 bytes. It reads the platform's fixed report filename through the [artifact reader](../../scripts/release/rc-files.ts), verifies its bytes and metadata, and refuses to replace existing output. The producer must keep the report directory and its ancestors exclusive and quiescent. Collection failures emit a fixed message and stage without rejected input: `arguments`, `source-metadata`, `source-clean`, `source-candidate`, `product-identity`, `product-freshness` or `native-report`. The workflow remains failed; the stage identifies the failing check, not the underlying cause.

## Record format

The [parser](../../scripts/release/product-diagnostics.ts) owns schema version 1. Records contain `version`, `buildNumber`, `channel`, `sourceSha`, `platform`, `runtimeClass`, `status`, `collectionErrors` and `errors`. An error row contains only a fixed `errorClass` and positive `count`; categories cannot repeat. Missing or extra serialized fields, invalid release identity and contradictory collection facts fail. Mobile records cannot claim Full Host; ANR belongs only to Android.

| Status | Required facts |
|---|---|
| `OBSERVED` | Recorded errors and no known collection failure |
| `NO_REPORT` | No recorded errors or known collection failure |
| `UNAVAILABLE` | No recorded errors; collection failed |
| `INCOMPLETE` | Collection failed; observed errors may remain |

Native adapters aggregate reports as `native-crash`. The format also admits `anr`, `startup`, `health`, `connection`, `protocol`, `storage`, `update` and `permission` for their respective producers. A failed installer can have `NO_REPORT` when Windows supplies no matching Application Error event; the installation failure remains unresolved.

## Limitations

Only Windows and macOS native collectors are connected. iOS, Android ANR and runtime operational producers remain unimplemented. These records do not implement a Support Bundle, upload, retention policy or telemetry consent. A complete Support Bundle also needs approved health, connection, protocol, role, capability and update facts plus secret scanning. Source fields are correlation metadata; artifact digests and provenance require independent verification.

## Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
