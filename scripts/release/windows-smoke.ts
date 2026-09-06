/** Real packaged desktop interaction, restricted to disposable GitHub-hosted Windows runners. */
import { execFile, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright-core'
import { hashRcOutput } from './rc-output.ts'
import { withRcCleanup } from './rc-lifecycle.ts'

const execute = promisify(execFile)

/**
 * Join the owned child process, including a process that has already exited.
 * @param child - child returned by the launcher.
 * @param timeoutMs - maximum wait before reporting incomplete shutdown.
 * @returns exit code, or null for a signal exit; timeout does not claim process termination.
 */
export function waitForRcProcessExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolveExit, rejectExit) => {
    const finished = (code: number | null): void => { clearTimeout(deadline); resolveExit(code) }
    const deadline = setTimeout(() => {
      child.off('exit', finished)
      rejectExit(new Error('Windows candidate process did not exit before its shutdown deadline'))
    }, timeoutMs)
    child.once('exit', finished)
  })
}

/**
 * Remove ambient credentials and development launch hooks from candidate subprocesses.
 * @param environment - parent environment.
 * @returns string-valued process variables needed for ordinary native startup.
 */
export function windowsCandidateEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] =>
    entry[1] !== undefined && !/KEY|SECRET|TOKEN|PASSWORD/i.test(entry[0])
    && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'DSH_DESKTOP_SMOKE_SHOT'].includes(entry[0].toUpperCase())))
}

/**
 * Prevent accidental installation or desktop startup on a developer's persistent machine.
 * @param platform - Node platform of the executing process.
 * @param environment - runner environment; these markers prevent mistakes, not malicious spoofing.
 */
export function requireHostedWindows(platform: string, environment: NodeJS.ProcessEnv): void {
  if (platform !== 'win32' || environment.GITHUB_ACTIONS !== 'true'
    || environment.RUNNER_ENVIRONMENT !== 'github-hosted' || environment.RUNNER_OS !== 'Windows') {
    throw new Error('Windows installation and GUI smoke require a disposable GitHub-hosted Windows runner')
  }
}

/**
 * Install one unsigned NSIS candidate into its test-owned directory without auto-launching it.
 * @param installer - verified candidate installer executable.
 * @param directory - absolute, fresh path beneath the caller's disposable run directory.
 */
export async function installWindowsCandidate(installer: string, directory: string): Promise<void> {
  requireHostedWindows(process.platform, process.env)
  if (/\s/.test(directory)) throw new Error('NSIS silent destination must not require argument quoting')
  await execute(installer, ['/S', '/currentuser', `/D=${directory}`], {
    windowsHide: true, timeout: 120_000, env: windowsCandidateEnvironment(process.env),
  })
}

/**
 * Open the packaged app, dismiss first-run dialogs, open the provider form and exit normally.
 * @param executable - installed main executable or the actual portable launcher.
 * @param directory - fresh test-owned state directory; it must remain separate for each launcher.
 * @param screenshot - destination for the rendered Settings view after interaction succeeds.
 * @param portable - use the NSIS child endpoint adapter and allow time for extraction.
 * @returns the observed startup facts; no model API call or configured credential is required.
 */
export async function smokeWindowsCandidate(executable: string, directory: string, screenshot: string, portable = false): Promise<{
  settingsOpened: true
  providerFormOpened: true
  pageErrors: number
  exitCode: number
  applicationVersion: string
  executableSha256: string
}> {
  requireHostedWindows(process.platform, process.env)
  const appData = join(directory, 'roaming'), localData = join(directory, 'local')
  await mkdir(appData, { recursive: true })
  await mkdir(localData, { recursive: true })
  const environment = Object.fromEntries(Object.entries(windowsCandidateEnvironment(process.env))
    .filter(([key]) => !['DSH_HOME', 'APPDATA', 'LOCALAPPDATA'].includes(key.toUpperCase())))
  const browserData = join(directory, 'browser')
  const application = await electron.launch({
    executablePath: portable ? join(import.meta.dirname, 'windows-portable-launch.cmd') : executable,
    locale: 'en-US', timeout: portable ? 240_000 : 90_000,
    cwd: directory, args: [`--user-data-dir=${browserData}`],
    env: { ...environment, DSH_HOME: join(directory, 'home'), APPDATA: appData, LOCALAPPDATA: localData,
      ...(portable ? { DSH_RC_NODE: process.execPath, DSH_RC_TSX_HOOK: import.meta.resolve('tsx/esm'), DSH_RC_PORTABLE_EXECUTABLE: executable } : {}),
    },
  })
  const child = application.process()
  console.log('Windows candidate: Electron inspector connected')
  return await withRcCleanup(async () => {
    const observedData = await application.evaluate(({ app }) => app.getPath('userData'))
    if (resolve(observedData).toLowerCase() !== resolve(browserData).toLowerCase()) {
      throw new Error('Windows candidate did not use its isolated browser data directory')
    }
    const page = await application.firstWindow({ timeout: 90_000 })
    console.log('Windows candidate: application window attached')
    let pageErrors = 0
    page.on('pageerror', () => { pageErrors++ })
    await page.waitForURL(/^dsh:/, { timeout: 90_000 })
    console.log('Windows candidate: desktop URL loaded')
    await page.locator('[data-shell-overlay]').waitFor({ state: 'attached', timeout: 90_000 })
    const welcome = page.getByRole('dialog', { name: 'Internal Testing Notice', exact: true })
    await welcome.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 30_000 })
    const setup = page.getByRole('dialog', { name: 'Add an API key to get started', exact: true })
    await setup.getByRole('button', { name: 'Configure later', exact: true }).click({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 30_000 })
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.waitFor({ state: 'visible', timeout: 30_000 })
    await settings.getByRole('button', { name: 'Models', exact: true }).click({ timeout: 30_000 })
    await settings.getByRole('button', { name: 'Add provider', exact: true }).click({ timeout: 30_000 })
    await settings.getByLabel('Provider', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    console.log('Windows candidate: provider form opened')
    await page.screenshot({ path: screenshot, fullPage: true })
    const observed = await application.evaluate(({ app }) => ({
      executablePath: process.execPath, applicationVersion: app.getVersion(),
    }))
    const executableHash = await hashRcOutput(observed.executablePath)
    if (pageErrors !== 0) throw new Error(`Windows GUI raised ${pageErrors} uncaught page errors`)
    const exited = waitForRcProcessExit(child, 30_000)
    const [, exitCode] = await Promise.all([application.close(), exited])
    if (exitCode !== 0) throw new Error('Windows GUI did not exit normally with code zero')
    return { settingsOpened: true as const, providerFormOpened: true as const, pageErrors, exitCode,
      applicationVersion: observed.applicationVersion, executableSha256: executableHash.sha256 }
  }, async () => {
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      const exited = waitForRcProcessExit(child, 15_000)
      const results = await Promise.allSettled([
        execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 }), exited,
      ])
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
      if (failures.length !== 0) throw new AggregateError(failures, 'Windows candidate cleanup failed')
    }
  })
}
