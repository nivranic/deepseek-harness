/** Shared CLI entry for generator scripts. */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Report the first differing line of a generated text artifact to stderr.
 * @param generator - Generator name prefixed to the diagnostic.
 * @param committed - Current artifact text, or null when it could not be read.
 * @param generated - Regenerated artifact text.
 */
export function reportFirstDifference(generator: string, committed: string | null, generated: string): void {
  const committedLines = committed?.split('\n') ?? []
  const generatedLines = generated.split('\n')
  const lineCount = Math.max(committedLines.length, generatedLines.length)
  for (let index = 0; index < lineCount; index += 1) {
    if (committedLines[index] === generatedLines[index]) continue
    console.error(`${generator}: first difference at line ${index + 1}`)
    console.error(`  committed: ${JSON.stringify(committedLines[index])}`)
    console.error(`  generated: ${JSON.stringify(generatedLines[index])}`)
    break
  }
}

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
