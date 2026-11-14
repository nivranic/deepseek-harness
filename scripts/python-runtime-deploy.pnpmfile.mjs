/**
 * Preserve workspace build approvals when pnpm deploy records local dependencies as file:// URLs.
 * This hook lives in the workspace root's scripts/ directory; relative file: approvals use that root.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Translate local build identities without changing their approved or denied status.
 * @param {import('./python-runtime-deploy.pnpmfile.mjs').RuntimeDeployConfig} config - Source workspace configuration.
 * @returns {import('./python-runtime-deploy.pnpmfile.mjs').RuntimeDeployConfig} Deployment configuration with exact file URL approvals.
 */
function updateConfig(config) {
  if (config.allowBuilds === undefined) return config
  const approvals = new Map()
  for (const [key, value] of Object.entries(config.allowBuilds)) {
    const marker = key.indexOf('@file:')
    let identity = key
    if (marker >= 0 && !key.slice(marker + 6).startsWith('//')) {
      const source = resolve(import.meta.dirname, '..', key.slice(marker + 6))
      identity = `${key.slice(0, marker + 1)}${pathToFileURL(source).href}`
    }
    if (approvals.get(identity) !== false) approvals.set(identity, value)
  }
  const allowBuilds = Object.fromEntries(approvals)
  return { ...config, allowBuilds }
}

/** Pnpm configuration hooks scoped to Python runtime deployment. */
export const hooks = { updateConfig }
