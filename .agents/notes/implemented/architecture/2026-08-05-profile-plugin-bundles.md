# Agent Note: Profile plugin bundles replace the fixed surface overlays

Status: implemented

English | [中文](2026-08-05-profile-plugin-bundles.zh.md)

## Problem

The `dsh` launcher hardcoded its compositions: `base.cordis.yml` + `web.cordis.yml` shipped inside `apps/cli`, three bespoke entry modes (`--config`, `web`, `-p`) each with its own layer stack, and a single global personal overlay (`$DSH_HOME/config.yaml`). There was no way to install an out-of-tree plugin (a TUI, a provider pack) into a shipped surface without editing the repository, and no place where a third-party package could contribute a default composition.

## Decision

Everything becomes a **profile**: a directory `$DSH_HOME/profiles/<name>` with a `package.json` (pnpm-managed out-of-tree plugin `dependencies` plus the profile manifest `dsh.profile` with its ordered `bundles` layer list) and a user `cordis.patch.yml`. A **bundle** is an npm package declaring `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; the two manifest kinds live under distinct `dsh.profile` / `dsh.bundle` keys so a package.json states which role it plays. The tree composes over an empty root by applying each bundle's patch in `dsh.profile.bundles` order, then the user layer and `--patch` overlays — one `applyEntryPatches` call shared by boot and `--dump-config`. App invocation values later moved from launcher-derived patches to startup services in the [app-owned command-line decision](../../archived/architecture/2026-08-06-app-owned-command-line.md).

The default Profile templates use `@deepseek-ai/dsh-base` as the shared core for `web`, `headless`, `sdk`, and `acp`, with one mode bundle above it. The [standalone `sdk-minimal` profile](../../../../packages/bundle/sdk-minimal/README.md) instead lists one bundle that owns its complete explicit tree. Generic `dsh --profile <name>` hands its remaining arguments to that profile's command-line startup row: Web owns its flag family, headless owns its task positional, and the protocol profiles accept no app options. Patch overlays use launcher-owned `--patch`. A new, non-shipped target can use `--from-default-profile <template>` to copy one default template's bundle list and patch-reload policy before boot or config dump. This creates an independent profile with empty dependencies and an empty user patch: it neither reads a local profile named by the template nor records an inheritance relationship. The launcher claims the complete target directory exclusively, so existing state and concurrent creators fail without modification. `dsh plugin --profile <name> <args...>` is a thin pnpm forwarder that initializes a base-backed profile and reconciles `dsh.profile.bundles` with installed bundle declarations; a package without a bundle declaration remains a plain dependency. [Headless as a direct core entry point](../../archived/architecture/2026-08-09-headless-direct-core-entry-point.md) owns the headless composition contract.

`initProfile` incrementally creates the three profile files with exclusive filesystem creation. An existence check followed by an ordinary write would truncate a file published between those operations. Only an existing-entry error is treated as success; permission and storage errors propagate. This protects each existing entry without promising that concurrent readers see a complete directory or that interrupted writes are repaired.

`dsh plugin` permits dependency changes at the profile's pnpm workspace root through a per-invocation option. The profile directory is the intended package target, so pnpm's workspace-root guard must admit that write without requiring callers to add a package-manager flag or changing persistent pnpm settings.

The forwarder uses the existing `execa` dependency for platform command resolution and literal argv transport through Windows pnpm shims. Building a command string with Node's `shell: true` splits path arguments and interprets metacharacters; maintaining custom cmd.exe escaping would duplicate the process library. The caller's argument vector, inherited stdio, missing-command diagnostic, and child exit status remain the CLI's obligations.

Bundle names resolve from the dsh installation first, then the profile directory, so in-box bundles use the running installation. Bare plugin names resolve through the profile directory into `$DSH_HOME/profiles/node_modules`. Plain Node heals symlinks there; packaged executables write ESM proxies to virtual module URLs. Packaged dependency lookup stays within the deployed installation, because build-machine ancestor records can exist in pkg without deployable module content. Ordinary Node retains its parent-directory resolution.

Windows creates a junction directory before attaching its reparse point, so an interrupted create can leave an empty directory at a dsh-owned fallback path. Healing removes only that empty directory with nonrecursive `rmdirSync` and retries link creation. Foreign files and nonempty unmanaged directories still reject startup; pnpm-managed profile entries are outside this recovery. Removing the whole path recursively would lose that content protection.

Two supporting refactors: the webserver's built-in static dist serving became the single-owner **fallback seat** (`registerFallback`/`applyIndexTaps`), with the SPA server extracted to `@deepseek-ai/dsh-host-frontend-static` so the web bundle owns its dist as composition, not launcher code; and the personal-overlay machinery of the [dsh CLI personal-config decision](../../archived/feature/2026-07-20-dsh-cli-personal-config.md) (`loadPersonalPatches`, `$DSH_HOME/config.yaml`) was retargeted to the per-profile and home-level `cordis.patch.yml` layers (`loadOptionalPatches`, `watchUserPatches` taking a filename), superseding that note's entry modes and file location while keeping its Harness-home root, patch semantics, and fail-loud parsing.

## Alternatives considered

- **Dependency-scan plus partial `patchOrder`** (the original sketch): scanning `dependencies` for bundles and ordering unlisted ones alphabetically has two sources of truth and an implicit tie-break; one explicit ordered `dsh.profile.bundles` list is smaller and fully deterministic. A raw `pnpm add` inside the profile installs a library without activating any patch — explicit, no spooky scan.
- **`link:` entries for in-box bundles**: pnpm cannot version, install, or update a `link:` into the installation, it embeds a machine path in a user file, and it breaks when the installation moves. The two-anchor resolution plus healed symlink fallback gives the same guarantee ("bundles come from the installation") without ceremony.
- **A pre-boot `context` module in the bundle manifest** for boot-time values (dist path, flag facts): rejected in favor of pure plugins — the glue is ordinary rows and app-owned startup services, so the composition stays fully dumpable and the manifest stays data-only. The launcher-provided host slots (`ctx.cmdlineArgs`, `ctx.appExit`, and the environment snapshot) are provided in `boot()`'s `prepare` hook, before any config-tree entry mounts.
- **Transitive bundle auto-application**: only direct `dsh.profile.bundles` entries contribute layers; a meta-bundle wanting to re-export another bundle's patch must do so explicitly in its own patch file.
- **Dynamic template inheritance or cloning a local profile**: recording a parent would require merge and upgrade rules for bundle membership, dependencies, and user patches, while copying local state would duplicate machine-specific choices. Template-based creation copies only installation-owned defaults once.

## Consequences

- New composition surfaces (a TUI, provider packs) ship as ordinary npm packages installable per profile, without a repository row for every deployment shape.
- Users can start an independent custom profile from any shipped application template without copying machine-local profile state.
- `apps/cli` shrank to argv parsing, profile machinery consumption, and the pnpm forwarder; `AppCLIEntry` and the per-surface boot paths are gone.
- The keyless web e2e scaffold boots the same bundle layers over the same empty-root shape as production, including the profiles module fallback, so composition drift between test and product fails loudly.
- Under the pre-release stance, backends carry no compatibility behavior for old on-disk configuration; `$DSH_HOME/config.yaml` is ignored.
