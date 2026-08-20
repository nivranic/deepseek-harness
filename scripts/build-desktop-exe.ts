/**
 * Stage the desktop app closure and package the Windows exe. The staged
 * closure is symlink-free (pnpm deploy over the app's production graph), the
 * N-API PTY prebuilds load without a rebuild, and electron-builder emits
 * NSIS + portable targets over a real-directory (no-asar) app tree. Mirrors
 * the single-exe precedent of build-exe-for-python-sdk.ts: staging owns
 * closure shape, the packager only consumes the stage.
 */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { officialClientBuildEnvironment, readClientBuildRecord } from './client-build-environment.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The stage lives OUTSIDE the repository tree: inside it, electron-builder's
// package-manager detection walks up to the pnpm workspace root and runs
// `pnpm install --production` there instead of packing the staged closure.
const STAGE_DIR = join(tmpdir(), 'dsh-desktop-stage')
const OUT_DIR = join(root, 'dist-desktop', 'out')
const DESKTOP_APP = '@deepseek-ai/dsh-desktop'

// Electron runtime and builder-toolchain downloads default to a mirror for
// constrained networks; an explicit environment value always wins.
process.env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= 'https://npmmirror.com/mirrors/electron-builder-binaries/'

/** Spawn a child process and resolve with its exit code, streaming stdio. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
  shell = process.platform === 'win32',
): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: 'inherit',
      shell,
      env: { ...process.env, ...env },
    })
    child.on('error', reject)
    child.on('exit', (code) => { resolveExit(code ?? 1) })
  })
}

function fail(message: string): never {
  console.error(`build-desktop-exe: ${message}`)
  process.exit(1)
}

/** Read one JSON file, failing loud on absence (a missing build artifact). */
async function readJson<T>(path: string, hint: string): Promise<T> {
  if (!existsSync(path)) fail(`${hint} not found at ${path}; run \`pnpm run build\` first`)
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function main(): Promise<void> {
  // Build artifacts the stage consumes; their absence means an unbuilt tree,
  // not a packaging condition.
  if (!existsSync(join(root, 'apps', 'desktop', 'lib', 'main.js'))) {
    fail('apps/desktop/lib/main.js not found; run `pnpm run build` first')
  }
  if (!existsSync(join(root, 'apps', 'web', 'dist', 'index.html'))) {
    fail('apps/web/dist/index.html not found; run `pnpm run build` first')
  }
  if (!existsSync(join(root, 'apps', 'cli', 'lib', 'profile-boot.js'))) {
    fail('apps/cli/lib/profile-boot.js not found; run `pnpm run build` first')
  }
  // The packaged exe is a public artifact: its client bundles must embed the
  // official profile (brand wordmark, window title), and the record's digest
  // check also rejects stale dist trees from a plain `pnpm run build`.
  readClientBuildRecord(root, officialClientBuildEnvironment(root))
  const electronManifest = await readJson<{ version: string }>(
    join(root, 'apps', 'desktop', 'node_modules', 'electron', 'package.json'),
    'the Electron runtime',
  )
  const electronVersion = electronManifest.version

  // Fresh stage: the deployed closure replaces any previous attempt whole.
  await rm(STAGE_DIR, { recursive: true, force: true })
  await mkdir(dirname(STAGE_DIR), { recursive: true })
  console.log(`build-desktop-exe: deploying the ${DESKTOP_APP} production closure to ${STAGE_DIR}`)
  const deployCode = await run('pnpm', ['deploy', '--legacy', `--filter=${DESKTOP_APP}`, '--prod', STAGE_DIR], root, {
    npm_config_verify_deps_before_run: 'false',
  })
  if (deployCode !== 0) fail(`pnpm deploy exited ${String(deployCode)}`)

  // The shell's bundled entries ride beside the closure's package.json; a
  // files-filtered deploy may omit them, so always lay them down.
  cpSync(join(root, 'apps', 'desktop', 'lib'), join(STAGE_DIR, 'lib'), { recursive: true, force: true })

  // Materialize every link that escapes the stage: file-linked workspace
  // packages land in the closure as junctions back into the repository, and
  // the packager refuses files whose real path leaves the app directory. The
  // copy omits each target's own node_modules — those dependencies already
  // sit as sibling links inside the same virtual-store directory.
  await materializeEscapingLinks(STAGE_DIR, STAGE_DIR)

  // The pruned deploy graph drops some peerDependency sibling links (peers
  // resolve per importer in the full workspace). Backfill every missing peer
  // from the closure so runtime ESM resolution finds them beside each
  // consumer, exactly where pnpm would have linked them.
  await completeMissingPeers(STAGE_DIR)

  // The packaged tree's top-level packages lose their virtual-store sibling
  // context: Node's upward resolution from their files only ever sees the
  // top-level node_modules. Hoist every closure package there (npm-style)
  // so every import resolves regardless of which directory it starts in.
  await hoistClosureToTopLevel(STAGE_DIR)

  // The prod-pruned deploy drops workspace packages that reach the runtime
  // only through peer edges (vendored cordis plugins, invariants, the prompt
  // registry). Supplement every dependency any staged manifest names but the
  // closure lacks, copying the built workspace package from the repository.
  await supplementMissingWorkspacePackages(STAGE_DIR, root)

  // electron-builder reads the Electron version from the app manifest's
  // devDependencies; the stage ships none, so record the resolved runtime.
  const stageManifestPath = join(STAGE_DIR, 'package.json')
  const stageManifest = await readJson<Record<string, unknown>>(stageManifestPath, 'the staged manifest')
  stageManifest.devDependencies = { ...(stageManifest.devDependencies as Record<string, string> | undefined), electron: electronVersion }
  await writeFile(stageManifestPath, `${JSON.stringify(stageManifest, undefined, 2)}\n`)

  // node-pty ships N-API prebuilds (prebuilds/win32-x64/*.node) that load
  // under the Electron runtime without an ABI rebuild; the desktop smoke
  // boot fails loud if the terminal row cannot load them. install-app-deps
  // is deliberately NOT run here: against a staged closure it reinstalls the
  // whole workspace from the registry instead of rebuilding in place.

  // The deployed closure keeps pnpm's junction layout, which is packable as
  // is; the pnpm marker would instead make the builder purge node_modules and
  // `pnpm install --production` inside the stage — impossible for workspace
  // specifiers outside the workspace. The builder walks junctions and packs
  // the closure directly.
  await unlink(join(STAGE_DIR, 'node_modules', '.modules.yaml')).catch(() => {})

  // Package from the stage; the builder's own Electron download honors the
  // mirror environments for constrained networks. The config lands in the
  // stage so its output directory stays absolute.
  const builderConfig = [
    'appId: com.deepseek.dsh',
    'productName: DeepSeek Harness',
    'publish: null',
    // node-pty ships N-API prebuilds that load under Electron unchanged; a
    // node-gyp rebuild would demand a native toolchain the packaging host
    // does not need.
    'npmRebuild: false',
    'directories:',
    `  output: ${JSON.stringify(OUT_DIR)}`,
    'files:',
    '  - lib/**/*.js',
    '  - package.json',
    // The packaged tree must stay real directories: at boot the launcher
    // heals the shared $DSH_HOME/profiles/node_modules fallback into
    // junctions targeting the installation's packages, and Node's CJS
    // resolution from those junctions cannot enter an asar archive — an
    // asar-packed app silently served an empty browser boot graph through
    // them (ClientModuleRegistry negative-caches unresolvable packages).
    'asar: false',
    'win:',
    '  target:',
    '    - nsis',
    '    - portable',
    // Unsigned build: resource editing pulls the winCodeSign archive, whose
    // extraction needs symlink privileges this environment lacks.
    '  signAndEditExecutable: false',
    'nsis:',
    '  oneClick: false',
    '  allowToChangeInstallationDirectory: true',
    '',
  ].join('\n')
  await writeFile(join(STAGE_DIR, 'electron-builder.yml'), builderConfig)
  console.log('build-desktop-exe: running electron-builder (win)')
  // Invoke the builder CLI through node directly: `pnpm exec` runs its own
  // dependency-status install first, which cannot work while packaging.
  const builderCli = join(root, 'apps', 'desktop', 'node_modules', 'electron-builder', 'cli.js')
  const builderCode = await run(
    process.execPath,
    [builderCli, '--win', '--x64', '--project', STAGE_DIR],
    join(root, 'apps', 'desktop'),
    { CI: 'true', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    false,
  )
  if (builderCode !== 0) fail(`electron-builder exited ${String(builderCode)}`)
  console.log(`build-desktop-exe: artifacts in ${OUT_DIR}`)
}

/**
 * Replace links whose target lies outside the stage with physical copies so
 * the packaged closure is self-contained. The copy skips each target's own
 * node_modules: the pnpm virtual store already provides those dependencies
 * as siblings of the link being replaced.
 * @param dir - current walk directory inside the stage.
 * @param stageRoot - the stage root every real path must stay under.
 */
async function materializeEscapingLinks(dir: string, stageRoot: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      const target = realpathSync(full)
      if (target === stageRoot || target.startsWith(stageRoot + sep)) continue
      rmSync(full, { force: true })
      cpSync(target, full, {
        recursive: true,
        force: true,
        filter: source => !source.endsWith(`${sep}node_modules`),
      })
    } else if (entry.isDirectory()) {
      await materializeEscapingLinks(full, stageRoot)
    }
  }
}

/**
 * Backfill peerDependencies that the pruned deploy left unlinked. Each
 * virtual-store package whose manifest names a peer missing from its sibling
 * set receives a physical copy of that peer from wherever the closure
 * provides it, so Node's upward resolution finds it beside the consumer.
 * @param stageRoot - the stage root containing node_modules/.pnpm.
 */
async function completeMissingPeers(stageRoot: string): Promise<void> {
  const pnpmDir = join(stageRoot, 'node_modules', '.pnpm')
  const providers = new Map<string, string>()
  for (const entry of await readdir(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nm = join(pnpmDir, entry.name, 'node_modules')
    if (!existsSync(nm)) continue
    for (const inner of await readdir(nm, { withFileTypes: true })) {
      if (inner.name.startsWith('.')) continue
      if (inner.name.startsWith('@')) {
        for (const scoped of await readdir(join(nm, inner.name), { withFileTypes: true })) {
          if (scoped.isDirectory()) providers.set(`${inner.name}/${scoped.name}`, join(nm, inner.name, scoped.name))
        }
      } else if (inner.isDirectory()) {
        providers.set(inner.name, join(nm, inner.name))
      }
    }
  }
  let backfilled = 0
  for (const dir of providers.values()) {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { peerDependencies?: Record<string, string> }
    const peers = Object.keys(manifest.peerDependencies ?? {})
    if (peers.length === 0) continue
    const siblings = dirname(dir)
    for (const peer of peers) {
      const sibling = join(siblings, ...peer.split('/'))
      if (existsSync(sibling)) continue
      const provider = providers.get(peer)
      if (provider === undefined) continue // not in the closure: a truly absent optional peer
      mkdirSync(dirname(sibling), { recursive: true })
      cpSync(provider, sibling, { recursive: true, force: true })
      backfilled++
    }
  }
  console.log(`build-desktop-exe: backfilled ${String(backfilled)} missing peer link(s)`)
}

/**
 * Hoist every virtual-store package into the top-level node_modules so the
 * packaged app's flat top level answers upward resolution from any packaged
 * file.
 * Existing top-level entries win; duplicate versions keep the first provider
 * encountered (the closure is the workspace's consistent single-version
 * resolution, so collisions are the exception, not the layout).
 * @param stageRoot - the stage root containing node_modules/.pnpm.
 */
async function hoistClosureToTopLevel(stageRoot: string): Promise<void> {
  const top = join(stageRoot, 'node_modules')
  const pnpmDir = join(top, '.pnpm')
  let hoisted = 0
  for (const entry of await readdir(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nm = join(pnpmDir, entry.name, 'node_modules')
    if (!existsSync(nm)) continue
    for (const inner of await readdir(nm, { withFileTypes: true })) {
      if (inner.name.startsWith('.')) continue
      const sources: Array<{ name: string; dir: string }> = []
      if (inner.name.startsWith('@')) {
        for (const scoped of await readdir(join(nm, inner.name), { withFileTypes: true })) {
          if (scoped.isDirectory()) sources.push({ name: `${inner.name}/${scoped.name}`, dir: join(nm, inner.name, scoped.name) })
        }
      } else if (inner.isDirectory()) {
        sources.push({ name: inner.name, dir: join(nm, inner.name) })
      }
      for (const source of sources) {
        const dest = join(top, ...source.name.split('/'))
        if (existsSync(dest)) continue
        mkdirSync(dirname(dest), { recursive: true })
        cpSync(source.dir, dest, { recursive: true, force: true })
        hoisted++
      }
    }
  }
  console.log(`build-desktop-exe: hoisted ${String(hoisted)} package(s) to the top-level node_modules`)
}

/**
 * Copy one workspace package's runtime surface (manifest, built lib, config,
 * bundle patch) into the stage top level.
 * @param sourceDir - the package directory inside the repository.
 * @param destDir - the top-level destination inside the stage.
 */
function copyWorkspacePackage(sourceDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  cpSync(join(sourceDir, 'package.json'), join(destDir, 'package.json'))
  for (const part of ['lib', 'config', 'styles', 'cordis.patch.yml']) {
    const from = join(sourceDir, part)
    if (existsSync(from)) cpSync(from, join(destDir, part), { recursive: true, force: true })
  }
}

/**
 * Supplement workspace packages the prod-pruned closure lacks. Every staged
 * manifest's dependencies and peerDependencies name the runtime requirement
 * set; a name absent from the stage top level but present in the repository
 * (packages, vendor, apps) lands at the top level as a built copy.
 * @param stageRoot - the stage root containing node_modules.
 * @param repoRoot - the repository root supplying missing workspace packages.
 */
async function supplementMissingWorkspacePackages(stageRoot: string, repoRoot: string): Promise<void> {
  // Repository package index by name.
  const repoIndex = new Map<string, string>()
  for (const group of ['packages', 'vendor', 'apps']) {
    const base = join(repoRoot, group)
    if (!existsSync(base)) continue
    for (const first of await readdir(base, { withFileTypes: true })) {
      if (!first.isDirectory()) continue
      const candidates = group === 'packages'
        ? (await readdir(join(base, first.name), { withFileTypes: true }))
          .filter(d => d.isDirectory()).map(d => join(base, first.name, d.name))
        : [join(base, first.name)]
      for (const dir of candidates) {
        const manifestPath = join(dir, 'package.json')
        if (!existsSync(manifestPath)) continue
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string }
        if (typeof manifest.name === 'string') repoIndex.set(manifest.name, dir)
      }
    }
  }
  // Requirement set: every staged manifest's dependencies + peerDependencies.
  const top = join(stageRoot, 'node_modules')
  const required = new Set<string>()
  const scanManifest = async (manifestPath: string): Promise<void> => {
    if (!existsSync(manifestPath)) return
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) required.add(name)
    for (const name of Object.keys(manifest.peerDependencies ?? {})) required.add(name)
  }
  await scanManifest(join(stageRoot, 'package.json'))
  for (const entry of await readdir(top, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(join(top, entry.name), { withFileTypes: true })) {
        // existsSync follows junctions: deployed top-level packages are links
        // into the virtual store whose manifests still name requirements.
        await scanManifest(join(top, entry.name, scoped.name, 'package.json'))
      }
    } else {
      await scanManifest(join(top, entry.name, 'package.json'))
    }
  }
  let supplemented = 0
  const supplementedNames: string[] = []
  for (const name of required) {
    const dest = join(top, ...name.split('/'))
    if (existsSync(dest)) continue
    const source = repoIndex.get(name)
    if (source === undefined) continue // registry package genuinely absent: an optional edge
    copyWorkspacePackage(source, dest)
    supplementedNames.push(name)
    supplemented++
  }
  // electron-builder collects the packaged node_modules from the manifest
  // dependency graph: a package only referenced through peer edges is never
  // packed. Declare every supplemented package as a stage dependency so the
  // packaged app physically contains it.
  if (supplementedNames.length > 0) {
    const manifestPath = join(stageRoot, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
    manifest.dependencies = { ...(manifest.dependencies ?? {}) }
    for (const name of supplementedNames) manifest.dependencies[name] ??= '*'
    await writeFile(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  }
  console.log(`build-desktop-exe: supplemented ${String(supplemented)} workspace package(s) missing from the closure`)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
