/**
 * One-shot desktop release build: dependency resync → workspace build → exe
 * packaging → fixed-location install → packaged-app smoke → desktop shortcut →
 * final resync. One command, artifacts under dist-desktop/out:
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
 * lock the output directory and fail the builder's empty-dir step. The fixed
 * install at F:\deepseek-harness plus the desktop shortcut pointing into it
 * keep working across rebuilds: the output directory is emptied every run,
 * the install location and exe name never change.
 * @module build-desktop-release
 */

import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_PROCESS = 'DeepSeek Harness.exe'
const OUT_DIR = join(root, 'dist-desktop', 'out')
const WIN_UNPACKED = join(OUT_DIR, 'win-unpacked')
const APP_EXE = join(WIN_UNPACKED, APP_PROCESS)
const SMOKE_SHOT = join(root, 'dist-desktop', 'smoke.png')
const SMOKE_LOG = join(root, 'dist-desktop', 'smoke.log')

// Fixed per-user install on a data drive, off the system disk; robocopy
// creates the directory on first use.
const STABLE_DIR = 'F:\\deepseek-harness'
const STABLE_EXE = join(STABLE_DIR, APP_PROCESS)
const SHORTCUT_NAME = 'DeepSeek Harness.lnk'

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
 * Mirror the freshly packaged win-unpacked tree into the fixed per-user
 * install directory, replacing the previous release whole (robocopy /MIR; exit
 * codes below 8 are its success range, 1 = files copied). The leading app kill
 * freed the files; anything still locked fails loud here.
 */
function syncStableInstall(): void {
  if (!existsSync(APP_EXE)) fail(`packaged exe missing at ${APP_EXE}`)
  log(`installing the new build to the fixed location ${STABLE_DIR}`)
  const result = spawnSync(
    'robocopy',
    [WIN_UNPACKED, STABLE_DIR, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1'],
    { stdio: 'ignore' },
  )
  const code = result.status ?? 1
  if (code >= 8) fail(`robocopy exited ${String(code)} syncing ${STABLE_DIR}; close any process holding it and retry`)
  if (!existsSync(STABLE_EXE)) fail(`stable install incomplete: ${STABLE_EXE} missing after robocopy`)
}

/**
 * Create or refresh the desktop shortcut pointing at the fixed install.
 * Best effort: on failure the run still succeeds and the fallback is manual —
 * right-click the exe → Send to → Desktop (create shortcut).
 */
function ensureDesktopShortcut(): void {
  if (process.platform !== 'win32') return
  // PowerShell single-quoted literal: no interpolation, embedded quotes doubled.
  const psLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`
  // One argv element through spawn (no shell quoting on the Node side).
  const script = [
    '$desktop = [Environment]::GetFolderPath("Desktop")',
    '$shell = New-Object -ComObject WScript.Shell',
    `$link = $shell.CreateShortcut((Join-Path $desktop ${psLiteral(SHORTCUT_NAME)}))`,
    `$link.TargetPath = ${psLiteral(STABLE_EXE)}`,
    `$link.WorkingDirectory = ${psLiteral(STABLE_DIR)}`,
    '$link.Save()',
    'Write-Output $desktop',
  ].join('; ')
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    log(`warning: desktop shortcut not created automatically; make one by hand from ${STABLE_EXE}`)
    return
  }
  log(`desktop shortcut ready at ${join(result.stdout.trim(), SHORTCUT_NAME)}`)
}

/**
 * Launch the FIXED install under the built-in smoke-shot hook and await the
 * capture, so the verdict covers exactly what the desktop shortcut launches.
 * The screenshot is the decision: the failed-boot page captures ~20 KB while a
 * settled real UI is several times that. App output lands in smoke.log and a
 * failed attempt prints its tail — without it a broken launch leaves nothing
 * to diagnose. One retry absorbs the first-launch transient of a freshly
 * synced install (real-time antivirus scanning the new files); the retried
 * attempt must still clear the full settled-UI bar.
 */
async function smoke(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(SMOKE_SHOT, { force: true })
      if (!existsSync(STABLE_EXE)) fail(`stable install exe missing at ${STABLE_EXE}`)
      const logFd = openSync(SMOKE_LOG, 'w')
      try {
        const child = spawn(STABLE_EXE, ['--enable-logging'], {
          cwd: root,
          detached: true,
          stdio: ['ignore', logFd, logFd],
          shell: false,
          env: { ...process.env, DSH_DESKTOP_SMOKE_SHOT: SMOKE_SHOT },
        })
        child.unref()
        log(`smoke: launched pid ${String(child.pid)} (attempt ${String(attempt)}), awaiting the settled-UI capture; app output: ${SMOKE_LOG}`)
        const deadline = Date.now() + 90_000
        while (Date.now() < deadline) {
          await new Promise((resolveTick) => { setTimeout(resolveTick, 3000) })
          if (!existsSync(SMOKE_SHOT)) continue
          const size = statSync(SMOKE_SHOT).size
          if (size >= 40_000) {
            log(`smoke: settled UI captured (${String(size)} bytes) at ${SMOKE_SHOT}`)
            return
          }
          throw new Error(`smoke shot is only ${String(size)} bytes (a failed boot captures ~20 KB); inspect ${SMOKE_SHOT}`)
        }
        throw new Error(`no smoke shot after 90 s; run the app manually to inspect: ${STABLE_EXE}`)
      } finally {
        closeSync(logFd)
      }
    } catch (error: unknown) {
      printSmokeLogTail()
      if (attempt >= 2) fail(String(error))
      log('smoke: retrying once after a cool-down')
      // A timeout leaves the app running; free its files before relaunching.
      spawnSync('taskkill', ['/F', '/IM', APP_PROCESS], { shell: true, stdio: 'ignore' })
      await new Promise((resolveTick) => { setTimeout(resolveTick, 15_000) })
    }
  }
}

/** Print the tail of the captured app output so a failed attempt names its cause. */
function printSmokeLogTail(): void {
  try {
    const lines = readFileSync(SMOKE_LOG, 'utf8').trim().split('\n')
    if (lines.length === 0) return
    log('smoke.log tail:')
    for (const line of lines.slice(-30)) console.log(`  | ${line}`)
  } catch {
    // The app wrote no output before the failure; the screenshot is the evidence.
  }
}

/** Print the artifact inventory with sizes, the fixed install first. */
function reportArtifacts(): void {
  const paths = [
    STABLE_EXE,
    ...readdirSync(OUT_DIR).filter(name => name.endsWith('.exe')).map(name => join(OUT_DIR, name)),
  ]
  log('artifacts:')
  for (const path of paths) {
    log(`  ${String(statSync(path).size).padStart(10)} bytes  ${path}`)
  }
}

async function main(): Promise<void> {
  killRunningApp()
  cleanOutputDir()
  log('resyncing dependencies (repairs status drift from merges and prior runs)')
  await run('pnpm', ['install'], 'pnpm install', true)
  log('building the workspace (tsc emits + tsdown bundles + web dist, official client profile)')
  await run('pnpm', ['run', 'build:official'], 'pnpm run build:official', true)
  log('packaging the exe (fresh stage + electron-builder)')
  await run(process.execPath, ['--import', 'tsx/esm', 'scripts/build-desktop-exe.ts'], 'build-desktop-exe', false)
  syncStableInstall()
  await smoke()
  ensureDesktopShortcut()
  reportArtifacts()
  log('resyncing dependencies again (packaging dirties the root status fingerprint)')
  await run('pnpm', ['install'], 'final pnpm install', true)
  log('done')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
