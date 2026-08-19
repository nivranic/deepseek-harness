/**
 * One-shot desktop release build: dependency resync → workspace build → exe
 * packaging → packaged-app smoke → final resync. One command, artifacts under
 * dist-desktop/out:
 *
 *   node --import tsx/esm scripts/build-desktop-release.ts
 *
 * Wraps the individual steps (scripts/build-desktop-exe.ts among them) without
 * duplicating them. The leading resync repairs the dependency-status drift a
 * merge or a previous packaging run leaves behind — without it the next
 * pnpm-wrapped command attempts `pnpm install --production` in the repository
 * root. The trailing resync cures the same drift the packaging run itself
 * introduces (`pnpm deploy` dirties the root status fingerprint). The
 * pre-clean kills a still-running packaged app, whose exe file would otherwise
 * lock the output directory and fail the builder's empty-dir step.
 * @module build-desktop-release
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(root, 'dist-desktop', 'out')
const APP_EXE = join(OUT_DIR, 'win-unpacked', 'DeepSeek Harness.exe')
const SMOKE_SHOT = join(root, 'dist-desktop', 'smoke.png')
const APP_PROCESS = 'DeepSeek Harness.exe'

// Constrained-network defaults; an explicit environment value always wins.
process.env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= 'https://npmmirror.com/mirrors/electron-builder-binaries/'

function fail(message: string): never {
  console.error(`build-desktop-release: ${message}`)
  process.exit(1)
}

/** Print one step line under the shared prefix. */
const log = (message: string): void => { console.log(`build-desktop-release: ${message}`) }

/**
 * Run one step to completion; the process fails loud on a nonzero exit.
 * @param command - executable name resolvable through the shell (or absolute path).
 * @param args - arguments; none may contain shell metacharacters.
 * @param label - step name for the failure message.
 * @param shell - false for absolute-path executables (pnpm needs the .cmd shim).
 */
function run(
  command: string,
  args: readonly string[],
  label: string,
  shell: boolean,
): Promise<void> {
  return new Promise((resolveStep, reject) => {
    const child = spawn(command, [...args], {
      cwd: root,
      stdio: 'inherit',
      shell,
      env: { ...process.env, CI: 'true' },
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolveStep()
        return
      }
      fail(`${label} exited ${String(code ?? 1)}`)
    })
  })
}

/** Kill a still-running packaged app so its exe file stops locking the output. */
function killRunningApp(): void {
  if (process.platform !== 'win32') return
  const result = spawnSync('taskkill', ['/F', '/IM', APP_PROCESS], { shell: true, stdio: 'ignore' })
  // 128 is "no such process" — the ordinary nothing-running case.
  if (result.status === 0) log(`closed a running ${APP_PROCESS} before rebuilding`)
}

/** Empty the output directory; a locked leftover means the build cannot start. */
function cleanOutputDir(): void {
  if (!existsSync(OUT_DIR)) return
  try {
    rmSync(OUT_DIR, { recursive: true, force: true })
  } catch (error: unknown) {
    fail(`cannot clear ${OUT_DIR} (${String(error)}); close any process holding it (or reboot) and retry`)
  }
}

/**
 * Launch the packaged exe under the built-in smoke-shot hook and await the
 * capture. The screenshot is the verdict: the failed-boot page captures ~20 KB
 * while a settled real UI is several times that, so an undersized shot fails
 * the build and names the file to inspect.
 */
async function smoke(): Promise<void> {
  rmSync(SMOKE_SHOT, { force: true })
  if (!existsSync(APP_EXE)) fail(`packaged exe missing at ${APP_EXE}`)
  const child = spawn(APP_EXE, ['--enable-logging'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    shell: false,
    env: { ...process.env, DSH_DESKTOP_SMOKE_SHOT: SMOKE_SHOT },
  })
  child.unref()
  log(`smoke: launched pid ${String(child.pid)}, awaiting the settled-UI capture`)
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise((resolveTick) => { setTimeout(resolveTick, 3000) })
    if (!existsSync(SMOKE_SHOT)) continue
    const size = statSync(SMOKE_SHOT).size
    if (size < 40_000) {
      fail(`smoke shot is only ${String(size)} bytes (a failed boot captures ~20 KB); inspect ${SMOKE_SHOT}`)
    }
    log(`smoke: settled UI captured (${String(size)} bytes) at ${SMOKE_SHOT}`)
    return
  }
  fail(`no smoke shot after 90 s; run the app manually to inspect: ${APP_EXE}`)
}

/** Print the artifact inventory with sizes. */
function reportArtifacts(): void {
  const names = [...readdirSync(OUT_DIR).filter(name => name.endsWith('.exe')), APP_EXE]
  log('artifacts:')
  for (const path of names) {
    log(`  ${String(statSync(path).size).padStart(10)} bytes  ${path}`)
  }
}

async function main(): Promise<void> {
  killRunningApp()
  cleanOutputDir()
  log('resyncing dependencies (repairs status drift from merges and prior runs)')
  await run('pnpm', ['install'], 'pnpm install', true)
  log('building the workspace (tsc emits + tsdown bundles + web dist)')
  await run('pnpm', ['run', 'build'], 'pnpm run build', true)
  log('packaging the exe (fresh stage + electron-builder)')
  await run(process.execPath, ['--import', 'tsx/esm', 'scripts/build-desktop-exe.ts'], 'build-desktop-exe', false)
  await smoke()
  reportArtifacts()
  log('resyncing dependencies again (packaging dirties the root status fingerprint)')
  await run('pnpm', ['install'], 'final pnpm install', true)
  log('done')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
