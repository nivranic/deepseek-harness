/** Locate resource-owning package manifests behind executable module proxies. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface PackageManifest {
  name?: unknown
  exports?: unknown
  dsh?: unknown
}

/** Match the loaded proxy export to the original module URL recorded by app-boot. */
function proxyTarget(manifest: PackageManifest, manifestPath: string, moduleUrl: string): string | undefined {
  const dsh = manifest.dsh
  if (dsh === null || typeof dsh !== 'object' || !('moduleFallback' in dsh)) return undefined
  const fallback = dsh.moduleFallback
  const targets = fallback !== null && typeof fallback === 'object' && 'targets' in fallback ? fallback.targets : undefined
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
 * Follow managed proxy exports to the manifest that owns the loaded module's client resources.
 * @param moduleUrl - Loader-resolved module URL.
 * @param expectedPackageName - Required package identity for a bare specifier.
 * @returns Resource-owning manifest and package name, or undefined for an unowned module.
 * @throws Error for malformed proxy metadata, missing target owners, or proxy cycles.
 */
export function locateModulePackage(
  moduleUrl: string,
  expectedPackageName?: string,
): { path: string; packageName: string } | undefined {
  const visited = new Set<string>()
  while (moduleUrl.startsWith('file:')) {
    let directory = dirname(fileURLToPath(moduleUrl))
    let nextTarget: string | undefined
    while (true) {
      const candidate = join(directory, 'package.json')
      let manifest: PackageManifest | undefined
      if (existsSync(candidate)) {
        try {
          manifest = JSON.parse(readFileSync(candidate, 'utf8')) as PackageManifest
        } catch {
          // An unreadable or malformed intermediate manifest cannot own the module.
        }
      }
      const name = manifest?.name
      if (manifest !== undefined && typeof name === 'string'
        && (expectedPackageName === undefined || name === expectedPackageName)) {
        if (visited.has(candidate)) throw new Error('client-modules: managed module fallback cycle')
        visited.add(candidate)
        nextTarget = proxyTarget(manifest, candidate, moduleUrl)
        if (nextTarget === undefined) return { path: candidate, packageName: name }
        expectedPackageName = name
        break
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    if (nextTarget === undefined) {
      if (visited.size > 0) throw new Error('client-modules: managed module fallback target has no owning package')
      return undefined
    }
    moduleUrl = nextTarget
  }
  return undefined
}
