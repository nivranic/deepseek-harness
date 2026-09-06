/**
 * Stage the desktop app closure and package the Windows exe. The staged
 * closure is symlink-free (pnpm deploy over the app's production graph), the
 * N-API PTY prebuilds load without a rebuild, and electron-builder emits
 * NSIS + portable targets over a real-directory (no-asar) app tree. Mirrors
 * the single-exe precedent of build-exe-for-python-sdk.ts: staging owns
 * closure shape, the packager only consumes the stage.
 */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { officialClientBuildEnvironment, readClientBuildRecord } from './client-build-environment.ts'
import { readProductIdentity, staleProductIdentityFiles } from './release/product-files.ts'
import { withDesktopStage } from './desktop-stage.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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
  throw new Error(`build-desktop-exe: ${message}`)
}

/** Read one JSON file, failing loud on absence (a missing build artifact). */
async function readJson<T>(path: string, hint: string): Promise<T> {
  if (!existsSync(path)) fail(`${hint} not found at ${path}; run \`pnpm run build\` first`)
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function main(stageDir: string): Promise<void> {
  const identity = readProductIdentity(root)
  const stale = staleProductIdentityFiles(root, identity)
  if (stale.length !== 0) fail(`product version inputs are stale: ${stale.join(', ')}; run pnpm run gen-product-identity`)
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

  console.log(`build-desktop-exe: deploying the ${DESKTOP_APP} production closure to ${stageDir}`)
  const deployCode = await run('pnpm', ['deploy', '--legacy', `--filter=${DESKTOP_APP}`, '--prod', stageDir], root, {
    npm_config_verify_deps_before_run: 'false',
  })
  if (deployCode !== 0) fail(`pnpm deploy exited ${String(deployCode)}`)

  // The shell's bundled entries and static resources ride beside the
  // closure's package.json; a files-filtered deploy may omit them, so always
  // lay them down.
  cpSync(join(root, 'apps', 'desktop', 'lib'), join(stageDir, 'lib'), { recursive: true, force: true })
  cpSync(join(root, 'apps', 'desktop', 'resources'), join(stageDir, 'resources'), { recursive: true, force: true })

  // Materialize every link that escapes the stage: file-linked workspace
  // packages land in the closure as junctions back into the repository, and
  // the packager refuses files whose real path leaves the app directory. The
  // copy omits each target's own node_modules — those dependencies already
  // sit as sibling links inside the same virtual-store directory.
  await materializeEscapingLinks(stageDir, stageDir)

  // The pruned deploy graph drops some peerDependency sibling links (peers
  // resolve per importer in the full workspace). Backfill every missing peer
  // from the closure so runtime ESM resolution finds them beside each
  // consumer, exactly where pnpm would have linked them.
  await completeMissingPeers(stageDir)

  // The packaged tree's top-level packages lose their virtual-store sibling
  // context: Node's upward resolution from their files only ever sees the
  // top-level node_modules. Hoist every closure package there (npm-style)
  // so every import resolves regardless of which directory it starts in.
  await hoistClosureToTopLevel(stageDir)

  // The prod-pruned deploy drops workspace packages that reach the runtime
  // only through peer edges (vendored cordis plugins, invariants, the prompt
  // registry). Supplement every dependency any staged manifest names but the
  // closure lacks, copying the built workspace package from the repository.
  await supplementMissingWorkspacePackages(stageDir, root)

  // electron-builder reads the Electron version from the app manifest's
  // devDependencies; the stage ships none, so record the resolved runtime.
  const stageManifestPath = join(stageDir, 'package.json')
  const stageManifest = await readJson<Record<string, unknown>>(stageManifestPath, 'the staged manifest')
  if (stageManifest.version !== identity.version) fail('staged desktop version differs from package.json')
  stageManifest.dshProduct = { buildNumber: identity.buildNumber, channel: identity.channel }
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
  await unlink(join(stageDir, 'node_modules', '.modules.yaml')).catch(() => {})

  // Package from the stage; the builder's own Electron download honors the
  // mirror environments for constrained networks. The config lands in the
  // stage so its output directory stays absolute.
  const builderConfig = [
    'appId: com.deepseek.dsh',
    'productName: DeepSeek Harness',
    `buildVersion: ${identity.windowsFileVersion}`,
    'publish: null',
    // node-pty ships N-API prebuilds that load under Electron unchanged; a
    // node-gyp rebuild would demand a native toolchain the packaging host
    // does not need.
    'npmRebuild: false',
    'directories:',
    `  output: ${JSON.stringify(OUT_DIR)}`,
    'files:',
    '  - lib/**/*.js',
    '  - resources/**',
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
  await writeFile(join(stageDir, 'electron-builder.yml'), builderConfig)
  console.log('build-desktop-exe: running electron-builder (win)')
  // Invoke the builder CLI through node directly: `pnpm exec` runs its own
  // dependency-status install first, which cannot work while packaging.
  const builderCli = join(root, 'apps', 'desktop', 'node_modules', 'electron-builder', 'cli.js')
  const builderCode = await run(
    process.execPath,
    [builderCli, '--win', '--x64', '--project', stageDir],
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

interface VirtualStorePackageSource {
  readonly name: string
  readonly dir: string
}

/**
 * List packages nested in a pnpm virtual store in directory iteration order.
 * @param pnpmDir - `.pnpm` directory whose package entries are scanned.
 * @returns package names and their physical source directories.
 */
async function listVirtualStorePackageSources(pnpmDir: string): Promise<VirtualStorePackageSource[]> {
  const sources: VirtualStorePackageSource[] = []
  for (const entry of await readdir(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nm = join(pnpmDir, entry.name, 'node_modules')
    if (!existsSync(nm)) continue
    for (const inner of await readdir(nm, { withFileTypes: true })) {
      if (inner.name.startsWith('.')) continue
      if (inner.name.startsWith('@')) {
        for (const scoped of await readdir(join(nm, inner.name), { withFileTypes: true })) {
          if (scoped.isDirectory()) sources.push({ name: `${inner.name}/${scoped.name}`, dir: join(nm, inner.name, scoped.name) })
        }
      } else if (inner.isDirectory()) {
        sources.push({ name: inner.name, dir: join(nm, inner.name) })
      }
    }
  }
  return sources
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
  for (const source of await listVirtualStorePackageSources(pnpmDir)) {
    providers.set(source.name, source.dir)
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
  for (const source of await listVirtualStorePackageSources(pnpmDir)) {
    const dest = join(top, ...source.name.split('/'))
    if (existsSync(dest)) continue
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(source.dir, dest, { recursive: true, force: true })
    hoisted++
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
 * set; a name the packer's graph cannot reach lands at the top level and in
 * the stage manifest's dependencies. electron-builder collects the packaged
 * node_modules from that dependency graph, and peer edges are not collected,
 * so a package present on disk (hoisted from the deploy store) but referenced
 * only as a peer is dropped from the packaged app unless the stage manifest
 * itself declares it.
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
  const stageManifestPath = join(stageRoot, 'package.json')
  await scanManifest(stageManifestPath)
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
  // Packed set: the transitive dependencies the stage manifest reaches over
  // the flat top level — the graph electron-builder collects. Peer edges are
  // deliberately not traversed; that is exactly the gap being supplemented.
  const dependenciesOf = (manifestPath: string): string[] => {
    if (!existsSync(manifestPath)) return []
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
    return Object.keys(manifest.dependencies ?? {})
  }
  const packed = new Set<string>()
  const queue = dependenciesOf(stageManifestPath)
  while (queue.length > 0) {
    const name = queue.pop() as string
    if (packed.has(name)) continue
    packed.add(name)
    queue.push(...dependenciesOf(join(top, ...name.split('/'), 'package.json')))
  }
  const supplementedNames: string[] = []
  const declaredNames: string[] = []
  for (const name of required) {
    if (packed.has(name)) continue
    const dest = join(top, ...name.split('/'))
    if (existsSync(dest)) {
      // Hoisted from the deploy store, reachable only through peer edges.
      // Registry packages (react, typescript, …) stay undeclared on purpose:
      // the app bundles what it needs and never ships a toolchain. Only a
      // workspace package is loader-entry territory the runtime imports.
      if (repoIndex.has(name)) declaredNames.push(name)
      continue
    }
    const source = repoIndex.get(name)
    if (source === undefined) continue // registry package genuinely absent: an optional edge
    copyWorkspacePackage(source, dest)
    supplementedNames.push(name)
  }
  // electron-builder collects the packaged node_modules from the manifest
  // dependency graph: a package only referenced through peer edges is never
  // packed. Declare every supplemented or peer-only package as a stage
  // dependency so the packaged app physically contains it.
  if (supplementedNames.length > 0 || declaredNames.length > 0) {
    const manifest = JSON.parse(await readFile(stageManifestPath, 'utf8')) as { dependencies?: Record<string, string> }
    manifest.dependencies = { ...(manifest.dependencies ?? {}) }
    for (const name of [...supplementedNames, ...declaredNames]) manifest.dependencies[name] ??= '*'
    await writeFile(stageManifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  }
  console.log(
    `build-desktop-exe: supplemented ${String(supplementedNames.length)} workspace package(s) `
    + `and declared ${String(declaredNames.length)} peer-only package(s) for the packer graph`,
  )
}

void withDesktopStage(main).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
