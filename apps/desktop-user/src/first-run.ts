/** First-run initialization of the personal desktop profile directory. */

import { initProfile } from '@deepseek-ai/dsh-app-boot'
import { PROFILE_TEMPLATES, type ProfileTemplate } from '@deepseek-ai/dsh-official-bundles'

const DESKTOP_PROFILE_BUNDLES = (PROFILE_TEMPLATES.web as ProfileTemplate).bundles

/**
 * Create the personal `desktop` profile on first run without running a package
 * manager: the shared launcher auto-initializes only profile names with a
 * shipped template, and the template table intentionally carries no `desktop`
 * row — the desktop apps own that profile's initial bundle list (the official
 * Desktop performs the same initialization before its Host starts). Every file
 * is written only when absent, so an initialized profile — and every user file
 * inside it — is never touched.
 * @param profileDir - the personal `desktop` profile directory under the personal home.
 */
export function createDesktopProfile(profileDir: string): void {
  initProfile(profileDir, DESKTOP_PROFILE_BUNDLES)
}
