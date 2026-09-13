/** Temporarily withhold a candidate scanner without crossing the portable application's filesystem. */
import { mkdtemp, rename, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withRcCleanup } from './rc-lifecycle.ts'

/**
 * Remove only the scanner executable for one refusal scenario, then restore it before returning.
 * The caller owns the application resources exclusively until restoration finishes. The private
 * sibling directory shares the scanner's volume and stays outside its validated resource inventory.
 * A failed restore retains the executable; cleanup removes only an empty holding directory.
 * @param scannerDirectory - observed SupportScanner directory in the running candidate.
 * @param operation - refusal scenario while the executable is absent.
 * @returns the scenario result after restoration; operation and cleanup failures remain observable.
 */
export async function withMissingSupportScanner<T>(scannerDirectory: string, operation: () => Promise<T>): Promise<T> {
  const holding = await mkdtemp(join(dirname(scannerDirectory), '.dsh-withheld-scanner-'))
  const binary = join(scannerDirectory, 'gitleaks.exe'), withheld = join(holding, 'gitleaks.exe')
  return await withRcCleanup(async () => {
    await rename(binary, withheld)
    return await withRcCleanup(operation, async () => { await rename(withheld, binary) })
  }, async () => { await rmdir(holding) })
}
