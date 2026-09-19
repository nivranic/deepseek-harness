/** Boot the materialized target runtime without access to a user's Harness profile. */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile } from '../src/project-manager.ts'
import { linkDesktopHostPackages, validateDesktopPluginGraph } from '../src/profile-packages.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/**
 * Prove the final resource tree boots and serves its matching Web frontend.
 * @param root - Materialized dsh resources.
 * @param node - Prepared target Node executable.
 * @param runtime - Verified resource descriptor.
 */
export async function smokeDesktopRuntime(root: string, node: string, runtime: DesktopRuntimeDescriptor): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  const host = new DesktopHostProcess(node, root, profile, undefined, { ...process.env, DSH_HOME: home })
  try {
    createPluginProfile(profile)
    const pluginName = 'desktop-runtime-smoke-plugin'
    const plugin = join(profile, 'node_modules', pluginName)
    mkdirSync(plugin, { recursive: true })
    const peerDependencies = Object.fromEntries([
      '@deepseek-ai/cordis', '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-session-persistence-jsonl',
    ].map((name) => {
      const entry = runtime.sharedPackages.find(candidate => candidate.name === name)
      if (entry === undefined) throw new Error(`desktop runtime: missing shared package ${name}`)
      return [name, entry.version]
    }))
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({
      name: pluginName, version: '1.0.0', type: 'module', exports: './index.js',
      peerDependencies, dsh: { bundle: { patch: './bundle.yml' } },
    }))
    copyFileSync(new URL('../tests/fixtures/runtime-session-lease.mjs', import.meta.url), join(plugin, 'session-lease.mjs'))
    const leaseMarker = join(home, 'session-lease-verified')
    writeFileSync(join(plugin, 'index.js'), `
import { Context } from '@deepseek-ai/cordis'
import { writeFile } from 'node:fs/promises'
import { verifySessionLease } from './session-lease.mjs'
export async function apply(ctx) {
  if (!(ctx instanceof Context)) throw new Error('desktop runtime: external plugin loaded another Cordis instance')
  await verifySessionLease(${JSON.stringify(join(home, 'session-lease'))})
  await writeFile(${JSON.stringify(leaseMarker)}, 'verified\\n', { flag: 'wx' })
}
`)
    writeFileSync(join(plugin, 'bundle.yml'), '- insert:\n    - id: desktop-runtime-smoke-plugin\n      name: desktop-runtime-smoke-plugin\n')
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies[pluginName] = '1.0.0'
    manifest.dsh.profile.bundles.push(pluginName)
    writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
    linkDesktopHostPackages(profile, root, runtime)
    validateDesktopPluginGraph(profile, root, runtime, [pluginName])
    const ready = await host.start()
    if (ready.dshVersion !== runtime.release.version) throw new Error('desktop runtime: Host reported another dsh release')
    const response = await host.fetch(new Request('dsh-app://app/'))
    if (response.status !== 200 || !(await response.text()).includes('<html')) {
      throw new Error('desktop runtime: packaged frontend smoke failed')
    }
    if (readFileSync(leaseMarker, 'utf8') !== 'verified\n') throw new Error('desktop runtime: Session lease smoke did not complete')
    console.log(JSON.stringify({ sessionLease: true, frontend: true, externalPlugin: true, node: runtime.release.nodeVersion }))
  } finally {
    await host.stop()
    rmSync(home, { recursive: true, force: true })
  }
}
