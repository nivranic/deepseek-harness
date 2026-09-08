/** Native ownership of the desktop support-export save dialog and staged product metadata. */
import { app, BrowserWindow, dialog } from 'electron'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopSupport, SupportExportError } from '@deepseek-ai/dsh-host-electron-ipc'

async function productManifest(Failure: typeof SupportExportError): Promise<unknown> {
  try {
    const handle = await open(join(app.getAppPath(), 'package.json'), 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size === 0 || info.size > 65_536) throw new Failure('invalid-identity')
      const bytes = Buffer.alloc(65_537)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      if (offset !== info.size) throw new Failure('invalid-identity')
      return JSON.parse(bytes.subarray(0, offset).toString('utf8')) as unknown
    } finally {
      await handle.close()
    }
  } catch {
    // Only staged application metadata is read here; raw filesystem and JSON errors stay private.
    throw new Failure('invalid-identity')
  }
}

/**
 * Bind the application's native exporter to the desktop Gateway service.
 * @param support - live profile-owned export service.
 * @param mainWindow - current application window; read only when the user exports.
 * @returns completion of native callback registration after the profile has loaded its Host modules.
 */
export async function registerDesktopSupport(support: DesktopSupport, mainWindow: () => BrowserWindow | undefined): Promise<void> {
  // Host module loading stays behind startGateway's existing dynamic profile boot and install warmup.
  const { SupportExportError } = await import('@deepseek-ai/dsh-host-electron-ipc')
  support.registerHost({
    scannerDirectory: join(app.getAppPath(), 'resources', 'SupportScanner'),
    readProductManifest: () => productManifest(SupportExportError),
    async save(document, signal) {
      signal.throwIfAborted()
      const parent = mainWindow()
      if (parent === undefined || parent.isDestroyed()) throw new SupportExportError('unavailable')
      // A dedicated, unloaded owner lets cancellation close this native dialog without destroying the application window.
      const owner = new BrowserWindow({
        parent, show: false, skipTaskbar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      })
      const close = (): void => { if (!owner.isDestroyed()) owner.destroy() }
      signal.addEventListener('abort', close, { once: true })
      parent.once('closed', close)
      try {
        const zh = app.getLocale().toLowerCase().startsWith('zh')
        const result = await dialog.showSaveDialog(owner, {
          title: zh ? '导出诊断信息' : 'Export diagnostics',
          defaultPath: 'deepseek-harness-diagnostics.json',
          filters: [{ name: zh ? '诊断文件' : 'Diagnostics', extensions: ['json'] }],
          properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
        })
        if (result.canceled || signal.aborted || parent.isDestroyed()) return 'cancelled'
        await document.save(result.filePath, signal)
        return 'saved'
      } catch (error) {
        if (error instanceof SupportExportError && error.reason === 'cleanup-failed') throw error
        if (signal.aborted || parent.isDestroyed()) return 'cancelled'
        if (error instanceof SupportExportError) throw error
        throw new SupportExportError('save-failed')
      } finally {
        signal.removeEventListener('abort', close)
        parent.off('closed', close)
        close()
      }
    },
  })
}
