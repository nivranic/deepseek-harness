/** The node half: namespace registration, the shell face, and their disposal. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { DESKTOP_SETTINGS_NAMESPACE } from '../src/desktop-settings.ts'
import { apply } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-desktop host', () => {
  it('registers the close-button namespace with the tray default and re-resolves every commit', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(DESKTOP_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ closeAction: 'tray' })
    await ctx.settings.update(ns, { closeAction: 'quit' })
    expect(ctx.settings.get(ns)).toEqual({ closeAction: 'quit' })
    // The schema is the only validity gate: anything outside the union refuses
    // the write before anything persists.
    await expect(ctx.settings.update(ns, { closeAction: 'minimize' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
