/** Real Settings and native save-dialog acceptance for an already isolated Windows candidate. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication, Page } from 'playwright-core'
import type { DesktopSupportResult } from '@deepseek-ai/dsh-host-electron-ipc/types'
import type { ProductIdentity } from './product-identity.ts'
import { hashRcOutput } from './rc-output.ts'
import type { SupportScannerIdentity } from './support-scanner.ts'

const execute = promisify(execFile)
const endpoint = '/api/desktopSupport/export'

/** Native UIAutomation facts, without dialog text or filesystem paths. */
interface NativeObservation {
  readonly schemaVersion: 1
  readonly action: string
  readonly dialogObserved: boolean
  readonly dialogClosed: boolean
}

/**
 * Exercise an actual IFileSaveDialog belonging to the candidate main process.
 * @param processId - observed Electron main process id, including portable child launches.
 * @param action - save, cancel, wait until open, or verify absence.
 * @param environment - credential-free candidate environment owned by the caller.
 * @param destination - absolute test-owned target for the save action.
 * @returns independently observed native dialog facts.
 */
export async function nativeSupportDialog(
  processId: number, action: 'save' | 'cancel' | 'observe' | 'absent', environment: Record<string, string>, destination?: string,
): Promise<NativeObservation> {
  const result = await execute('pwsh', ['-NoProfile', '-File', join(import.meta.dirname, 'windows-support-dialog.ps1'),
    '-CandidateProcessId', String(processId), '-Action', action,
    '-TimeoutMilliseconds', action === 'absent' ? '300' : '30000',
    ...(destination === undefined ? [] : ['-Destination', destination]),
  ], { windowsHide: true, timeout: 40_000, env: environment })
  const value: unknown = JSON.parse(result.stdout.trim())
  const expected = { schemaVersion: 1, action, dialogObserved: action !== 'absent', dialogClosed: action !== 'observe' }
  assert.deepEqual(value, expected, 'native support dialog observation differs')
  return expected as NativeObservation
}

async function exportFromSettings(page: Page, nativeAction?: () => Promise<NativeObservation>): Promise<DesktopSupportResult> {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === endpoint, { timeout: 60_000 })
  const results = await Promise.allSettled([
    response.then(async (value) => {
      assert.equal(value.status(), 200, 'desktop export did not reach the local Gateway')
      const envelope = await value.json() as { type?: string; result?: { ok?: boolean; value?: DesktopSupportResult } }
      assert.equal(envelope.type, 'server-response')
      assert.equal(envelope.result?.ok, true, 'desktop export Gateway rejected the operation')
      assert.ok(envelope.result.value)
      return envelope.result.value
    }),
    page.locator('[data-support-export]').click().then(async () => { await nativeAction?.() }),
  ])
  const errors = results.filter(result => result.status === 'rejected')
  if (errors.length !== 0) {
    throw new AggregateError(errors.map(result => result.reason as unknown), 'Windows Settings export or native interaction did not complete')
  }
  const result = results[0]
  assert.equal(result.status, 'fulfilled')
  const value = result.value
  await page.locator(`[data-support-result="${value.status}"]`).waitFor({ state: 'visible', timeout: 10_000 })
  return value
}

/**
 * Verify saved bytes, cancellation and scanner refusals through the installed Settings action.
 * Only the test-owned extracted candidate resources are temporarily changed; each is restored before return.
 * @param application - already launched disposable candidate.
 * @param page - its actual renderer with Settings open.
 * @param appPath - observed packaged application resource directory.
 * @param scanner - independently acquired scanner identity.
 * @param product - expected candidate release identity.
 * @param directory - fresh scratch directory, never published as an artifact.
 * @param output - approved attachment prefix, including launcher name.
 * @param environment - credential-free environment for UIAutomation and independent scanning.
 * @returns the verified byte identity and completed refusal/cancellation scenarios.
 */
export async function smokeWindowsSupport(
  application: ElectronApplication, page: Page, appPath: string, scanner: SupportScannerIdentity,
  product: ProductIdentity, directory: string, output: string, environment: Record<string, string>,
): Promise<{
  readonly saved: { readonly bytes: number; readonly sha256: string; readonly findings: 0 }
  readonly cancelled: true
  readonly missingScannerRefused: true
  readonly pollutedScannerRefused: true
  readonly secretRefused: true
}> {
  const processId = await application.evaluate(() => process.pid)
  const scannerDirectory = join(appPath, 'resources', 'SupportScanner')
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'General', exact: true }).click()
  const savedFile = join(directory, 'support-saved.json')
  const native = (action: 'save' | 'cancel' | 'absent') => nativeSupportDialog(processId, action, environment, action === 'save' ? savedFile : undefined)
  const saved = await exportFromSettings(page, () => native('save'))
  assert.equal(saved.status, 'saved', 'native export did not report a saved file')
  const digest = await hashRcOutput(savedFile)
  assert.deepEqual(saved, { status: 'saved', bytes: digest.bytes, sha256: digest.sha256, complete: false })
  const identityFile = join(directory, 'support-identity.json')
  const verificationFile = join(directory, 'support-verification.json')
  await writeFile(identityFile, JSON.stringify({ product, scanner }), { flag: 'wx' })
  await execute('python', ['-B', join(import.meta.dirname, '../verify-windows-support-export.py'),
    '--input', savedFile, '--scanner-directory', scannerDirectory, '--identity', identityFile,
    '--approved', `${output}.json`, '--output', verificationFile,
  ], { windowsHide: true, timeout: 360_000, env: environment })
  const verification: unknown = JSON.parse(await readFile(verificationFile, 'utf8'))
  assert.deepEqual(verification, { schemaVersion: 1, status: 'PASS', completeSupportBundle: false,
    bytes: saved.bytes, sha256: saved.sha256, findings: 0 })
  await page.screenshot({ path: `${output}-saved.png`, fullPage: true })
  const savedFeedback = await page.locator('[data-support-result]').innerText()
  const cancelled = await exportFromSettings(page, () => native('cancel'))
  assert.deepEqual(cancelled, { status: 'cancelled' })
  const feedback = { saved: savedFeedback, cancelled: await page.locator('[data-support-result]').innerText(), rejected: '' }
  await page.screenshot({ path: `${output}-cancelled.png`, fullPage: true })
  const binary = join(scannerDirectory, 'gitleaks.exe'), withheld = join(directory, 'withheld-gitleaks.exe')
  await rename(binary, withheld)
  try {
    assert.deepEqual(await exportFromSettings(page), { status: 'failed', reason: 'invalid-scanner' })
    await native('absent')
  } finally { await rename(withheld, binary) }
  const scannerManifest = join(scannerDirectory, 'scanner.json')
  const originalScanner = await readFile(scannerManifest)
  try {
    await writeFile(scannerManifest, JSON.stringify({ ...scanner, unexpected: 'must-refuse' }))
    assert.deepEqual(await exportFromSettings(page), { status: 'failed', reason: 'invalid-scanner' })
    await native('absent')
  } finally { await writeFile(scannerManifest, originalScanner) }
  const packageManifest = join(appPath, 'package.json'), originalPackage = await readFile(packageManifest)
  try {
    const manifest = JSON.parse(originalPackage.toString('utf8')) as Record<string, unknown>
    // A syntactically valid product identifier carrying a random synthetic token must fail the actual payload scan.
    manifest.version = `0.1.2-xoxb-123456789012-123456789012-${randomBytes(12).toString('hex')}`
    manifest.dshProduct = { buildNumber: product.buildNumber, channel: 'dev' }
    await writeFile(packageManifest, JSON.stringify(manifest))
    assert.deepEqual(await exportFromSettings(page), { status: 'failed', reason: 'secrets-detected' })
    await native('absent')
  } finally { await writeFile(packageManifest, originalPackage) }
  feedback.rejected = await page.locator('[data-support-result]').innerText()
  const expected: unknown = JSON.parse(await readFile(join(import.meta.dirname, 'expected/windows-support-feedback.json'), 'utf8'))
  assert.deepEqual(feedback, expected, 'assembled desktop support feedback changed')
  await page.screenshot({ path: `${output}-rejected.png`, fullPage: true })
  assert.deepEqual(await hashRcOutput(savedFile), digest, 'cancelled or refused export changed the saved file')
  assert.deepEqual(await readdir(directory).then(names => names.filter(name => name.startsWith('.dsh-support-'))), [])
  return { saved: { bytes: saved.bytes, sha256: saved.sha256, findings: 0 }, cancelled: true,
    missingScannerRefused: true, pollutedScannerRefused: true, secretRefused: true }
}
