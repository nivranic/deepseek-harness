/** Model-facing application facts owned by the local Desktop Host. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/**
 * Register Desktop orientation whenever the Host's prompt service is available.
 * The registration follows the owning context and prompt service lifetimes;
 * complete scoped personas retain their normal suppression of other sections.
 * @param ctx - the local Desktop Host context before or after Loader activation.
 */
export function registerDesktopContext(ctx: Context): void {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:desktop-surface',
      order: promptCtx.systemPrompt.getSectionOrder('WEB_SURFACE'),
      text: 'You are interacting with the user through the DeepSeek Harness desktop application window. '
        + 'This session is hosted on the same machine as that window. '
        + 'Command and file tools use the session workspace and their declared execution environment. '
        + 'The window provides no implicit DOM, route, or screenshot context. '
        + 'Starting a separate dsh web server does not update this window.',
    })
  })
}
