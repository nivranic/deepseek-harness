#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isSea } from 'node:sea'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

if (process.env.DSH_SUBPROCESS_BOOTSTRAP !== undefined) {
  if (process.env.DSH_SUBPROCESS_BOOTSTRAP !== '1' || process.platform !== 'win32'
    || !isSea() || process.channel === undefined) {
    throw new Error('dsh: subprocess bootstrap requires an owned Windows SEA IPC launch')
  }
  delete process.env.DSH_SUBPROCESS_BOOTSTRAP
  // The packaged executable has one entry. This fixed helper accepts argv only after parent Job assignment.
  await import('@deepseek-ai/dsh-subprocess-local/windows-bootstrap')
} else {
  await main()
}

async function main(): Promise<void> {
  const invocation = parseDshArgs(process.argv.slice(2), readVersion())

  switch (invocation.mode) {
    case 'profile': {
      const { runProfile } = await import('./profile-boot.ts')
      await runProfile({
        environment: loadLayeredEnv('dsh'),
        profile: invocation.profile,
        patchFiles: invocation.patches,
        args: invocation.args,
      })
      break
    }
    case 'plugin': {
      const { runPlugin } = await import('./plugin.ts')
      process.exit(runPlugin(invocation.profile, invocation.args))
      break
    }
    case 'dump-config': {
      const { runDumpConfig } = await import('./dump-config.ts')
      runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
      break
    }
    default:
      invocation satisfies never
      throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
  }
}
