/** Shared CLI entry for generator scripts. */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Run one generator's main body only when this module is the invoked script,
 * accepting at most a single `--check` flag.
 * @param meta - the module's own URL and its usage line.
 * @param main - generator body; receives whether `--check` was passed.
 */
export function runGeneratorCli(meta: { url: string | URL; usage: string }, main: (check: boolean) => void | Promise<void>): void {
  const self = fileURLToPath(new URL(String(meta.url), 'file://'))
  if (process.argv[1] === undefined || resolve(process.argv[1]) !== self) return
  const args = process.argv.slice(2)
  if (args.length > 1 || args.length === 1 && args[0] !== '--check') throw new Error(`Usage: ${meta.usage}`)
  void main(args[0] === '--check')
}
