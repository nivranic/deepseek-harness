/** Pure PowerShell readiness and diagnostic checks without launching a Windows application. */
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'win32')('waits for native control readiness without exposing control values', async () => {
  const { stdout } = await promisify(execFile)('pwsh', ['-NoProfile', '-File', 'scripts/release/windows-support-dialog.unit.ps1'], {
    cwd: resolve(import.meta.dirname, '..'), windowsHide: true,
  })
  expect(JSON.parse(stdout) as unknown).toEqual({ status: 'PASS', scenarios: 7, desktopLaunched: false })
})
