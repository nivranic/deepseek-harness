/** The host half: live desktop preferences and the generated-page opt-out. */

import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import * as HostPlugin from '../src/index.ts'

it('defaults to tray-close and autostart-off, updating live without remounting', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const configuration = await liveConfig(ctx, HostPlugin)
  expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({
    closeAction: 'tray',
    launchAtLogin: false,
  })
  await configuration.update({ closeAction: 'quit', launchAtLogin: true })
  expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({
    closeAction: 'quit',
    launchAtLogin: true,
  })
  expect(configuration.entry.fiber).toBe(configuration.fiber)
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
