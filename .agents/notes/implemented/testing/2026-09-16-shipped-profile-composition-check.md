# Agent Note: Check the composed profile before application boot

Status: implemented

English | [中文](2026-09-16-shipped-profile-composition-check.zh.md)

## Problem

Valid individual bundle patches can insert the same Loader id when composed. The Loader rejects repeated ids at startup, after configuration metadata and package-resolution checks have passed. An id is also the patch lookup key across nested groups, so duplicate ids make later overrides ambiguous. A separate Host/preset overlap can mount a registry contributor twice or shadow a Host provider with a Session-local one. Inspecting only the Web patch misses a Desktop patch that re-enables a preset-owned row.

## Decision

The existing [Cordis configuration check](../../../../scripts/verify-cordis-config.ts) uses [profile composition analysis](../../../../scripts/verify-profile-compositions.ts) for every declared CLI profile and the private Desktop patch. TypeScript syntax supplies the ordered bundle names from `PROFILE_TEMPLATES` and `DESKTOP_PROFILE_BUNDLES`; workspace manifests supply the patch files. Missing, empty, or dynamically constructed rosters fail explicitly. The check uses the launcher's `loadOverlayPatches` and `composeEntries`, preserving id overrides, whole-config replacement, and unevaluated plugin expressions.

Repeated ids are rejected within each composed Loader tree, including nested groups and disabled rows. Separate profiles may reuse ids. Ordinary plugin configuration arrays are not entry lists. A Host that mounts `dsh-agent-presets` is compared with every shipped preset using the final composed Host rows; statically disabled ancestors suppress their descendants, while expression-controlled rows remain potentially active. An empty preset corpus fails instead of dropping this comparison.

The [profile/bundle decision](../architecture/2026-08-05-profile-plugin-bundles.md) retains ownership of ordering and activation. This check does not introduce a Desktop bundle, infer composition from npm dependencies, change Loader behavior, or validate user-installed profiles. Tests exercise malformed declarations, duplicate insertions, legitimate later overrides, Desktop-only overlap, disabled groups, and unevaluated expressions. The existing `verify-cordis-config` command remains in the repository gate aggregates.

## Alternatives considered

**Compare every base-dependent bundle with the base patch.** npm dependencies establish availability, not activation order. This misses conflicts between mode layers and private Desktop overrides and can reject bundles that never compose together.

**Maintain another patch merger or a fixed profile table.** Either can diverge from application boot. Reading the owned declarations and using the production composition functions keeps the check on the same inputs and semantics.

**Rely only on application startup.** Startup still owns runtime validation, but a shipped, statically visible duplicate or Host/preset overlap can be rejected before an application or package is launched.

## Consequences

The check covers statically declared shipped compositions without executing plugin code. Changes to the roster declaration syntax must update its reader and rejection cases. Conditional configuration, arbitrary third-party profiles, and runtime service relationships still require their own tests. Windows checkouts that materialize Git symlinks as text can independently fail Loader YAML validation; source-fixture materialization is distinct from validating such a checkout as usable.
