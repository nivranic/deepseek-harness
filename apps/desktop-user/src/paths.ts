/** Filesystem ownership for the personal Electron-managed desktop installation. */

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/**
 * Resolve the personal home without reading or changing environment variables or files.
 * @param homeDirectory - Operating-system user home directory.
 * @param override - Optional absolute personal home from DSH_DESKTOP_USER_HOME.
 * @returns The override unchanged, or .dsh-personal under the user home.
 * @throws If the override is empty or is not an absolute path.
 */
export function resolvePersonalDshHome(homeDirectory: string, override: string | undefined): string {
  if (override === undefined) return join(homeDirectory, '.dsh-personal')
  if (!isAbsolute(override)) {
    throw new Error('DSH_DESKTOP_USER_HOME must be a nonempty absolute path; unset it to use ~/.dsh-personal')
  }
  return override
}

/** Stable desktop installation paths under the personal Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve Electron-owned paths under the personal home without accessing files.
 * @param dshHome - Personal Harness home; defaults to DSH_DESKTOP_USER_HOME or ~/.dsh-personal.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = resolvePersonalDshHome(homedir(), process.env.DSH_DESKTOP_USER_HOME)): DesktopPaths {
  return {
    profile: join(dshHome, 'profiles', 'desktop'),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
  }
}
