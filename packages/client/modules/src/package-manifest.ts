/** Resolve resource-owning package manifests through managed executable module proxies. */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Package metadata can belong to a generated ESM proxy rather than the packaged module it imports. */
interface LocatedPackageManifest {
  name?: unknown
  exports?: unknown
  dsh?: unknown
}

/** Follow the exact managed proxy export used by the Loader, preserving the original package's resource paths. */
function moduleFallbackTarget(manifest: LocatedPackageManifest, manifestPath: string, moduleUrl: string): string | undefined {
  const dsh = manifest.dsh
  if (dsh === null || typeof dsh !== 'object') return undefined
  const fallback = (dsh as Record<string, unknown>).moduleFallback
  if (fallback === undefined) return undefined
  const targets = fallback !== null && typeof fallback === 'object'
    ? (fallback as Record<string, unknown>).targets : undefined
  const declared = manifest.exports
  if (targets === null || typeof targets !== 'object' || Array.isArray(targets)
    || declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    throw new Error('client-modules: managed module fallback must declare export and target maps')
  }
  const matching = Object.entries(declared).filter(([, value]) => typeof value === 'string'
    && value.startsWith('./') && pathToFileURL(resolve(dirname(manifestPath), value)).href === moduleUrl)
  const subpath = matching.length === 1 ? matching[0]?.[0] : undefined
  const target = subpath === undefined ? undefined : (targets as Record<string, unknown>)[subpath]
  if (typeof target !== 'string' || !target.startsWith('file:')) {
    throw new Error('client-modules: managed module fallback has no file target for the resolved export')
  }
  return target
}

/**
 * Locate the package that owns the resolved module and its client bundle.
 * Managed proxies retain their original module URL; malformed targets and cycles throw.
 * @param moduleUrl - the Loader-resolved module URL.
 * @param expectedPackageName - an exact package name when resolving a bare package entry.
 * @param visited - manifests already traversed in the current proxy chain.
 * @returns the resource-owning manifest and package name, or undefined when none owns the module.
 */
export function locateModulePackage(
  moduleUrl: string,
  expectedPackageName?: string,
  visited = new Set<string>(),
): { path: string; packageName: string } | undefined {
  if (!moduleUrl.startsWith('file:')) return undefined
  let dir = dirname(fileURLToPath(moduleUrl))
  while (true) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      let manifest: LocatedPackageManifest | undefined
      try {
        manifest = JSON.parse(readFileSync(candidate, 'utf8')) as LocatedPackageManifest
      } catch {
        // An unreadable or malformed intermediate manifest cannot own the
        // module; keep walking toward the declaring package root.
      }
      const name = manifest?.name
      if (manifest !== undefined && typeof name === 'string'
        && (expectedPackageName === undefined || name === expectedPackageName)) {
        if (visited.has(candidate)) throw new Error('client-modules: managed module fallback cycle')
        visited.add(candidate)
        const target = moduleFallbackTarget(manifest, candidate, moduleUrl)
        if (target === undefined) return { path: candidate, packageName: name }
        const original = locateModulePackage(target, name, visited)
        if (original === undefined) throw new Error('client-modules: managed module fallback target has no owning package')
        return original
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}
