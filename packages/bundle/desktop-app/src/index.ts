/**
 * @deepseek-ai/dsh-desktop-app — the desktop-surface bundle's runtime glue
 * plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The plugin registers the
 * desktop-surface prompt section and the harness-checkout prompt section plus
 * runtime context; the carrier (desktopGateway) and the window belong to the
 * electron-ipc row and the app shell, and no URL line, shell variable, or
 * HTTP seat exists on this surface.
 * @module @deepseek-ai/dsh-desktop-app
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Prompt-section and runtime-context name for the implementation checkout. */
const HARNESS_SOURCE = 'harness:source'

/** Static guidance of the harness-source section; the runtime context carries the path itself. */
const HARNESS_SOURCE_PROMPT = 'The runtime context names the DeepSeek Harness implementation checkout. '
  + 'The checkout location and current working directory are separate values and may differ; '
  + 'never infer the working directory from the checkout path. Use pwd to determine the current working directory. '
  + 'Use this checkout only to inspect or extend DSH itself.'

/** Plugin config: the composed deployment settings. */
export interface Config {
  /**
   * Register the model-visible surface context (the `app:desktop-surface`
   * prompt section). A one-shot non-interactive layer can turn it off when
   * its user is not in the window, so the orientation text would be false.
   */
  surfaceContext: boolean
}

export const Config: z<Config> = z.object({
  surfaceContext: z.boolean().default(true),
})

/** Model-visible orientation for sessions created through the desktop surface. */
function desktopSurfacePrompt(): string {
  return 'You are interacting with the user through the DeepSeek Harness desktop application window. '
    + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this application. '
    + 'The window provides no implicit DOM, route, or screenshot context. '
    + 'There is no URL: the window loads the built frontend in-process, and no HTTP server serves it. '
    + 'Do not start a `dsh web` server for the user unless they ask; the desktop window is already the GUI.'
}

/**
 * Mount the desktop runtime: the surface prompt section.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.surfaceContext) return
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: HARNESS_SOURCE,
      order: promptCtx.systemPrompt.getSectionOrder('HARNESS_SOURCE'),
      interpolate: false,
      text: HARNESS_SOURCE_PROMPT,
    })
    promptCtx.systemPrompt.context({
      name: HARNESS_SOURCE,
      order: promptCtx.systemPrompt.getContextOrder('HARNESS_SOURCE'),
      interpolate: false,
      text: `Current DeepSeek Harness implementation checkout: ${JSON.stringify(SOURCE_ROOT)}.`,
    })
    promptCtx.systemPrompt.section({
      name: 'app:desktop-surface',
      order: -98,
      text: () => desktopSurfacePrompt(),
    })
  })
}
