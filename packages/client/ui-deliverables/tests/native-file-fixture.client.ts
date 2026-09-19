/** Controlled generated Remote face for native file action tests. */
import { vi } from 'vitest'
import type { ClientRemote, RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Create independently scripted metadata, open and reveal methods.
 * @param capabilities - current Host advertisement.
 * @returns Remote face and method spies; no native command runs.
 */
export function nativeFileRemote(capabilities = ['presented-file.desktop.v1', 'presented-file.open.v1', 'presented-file.reveal.v1']) {
  const desktop = vi.fn<ClientRemote['presentedFiles']['desktop']>().mockResolvedValue({
    ok: true, value: { name: 'desktop', available: true, fileManager: 'finder' },
  })
  const open = vi.fn<ClientRemote['presentedFiles']['open']>().mockResolvedValue({ ok: true, value: { completed: true } })
  const reveal = vi.fn<ClientRemote['presentedFiles']['reveal']>().mockResolvedValue({ ok: true, value: { completed: true } })
  const remote = {
    $host: { home: undefined, isLoopback: true, capabilities } as RemoteHostFacts,
    presentedFiles: { desktop, open, reveal },
  }
  return { remote, desktop, open, reveal }
}
