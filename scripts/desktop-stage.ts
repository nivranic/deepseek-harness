/** Private temporary storage for one desktop packaging operation. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Run desktop packaging in a uniquely created directory outside the workspace,
 * so electron-builder cannot detect and reinstall the parent pnpm workspace.
 * The directory remains available until packaging settles, then is removed on
 * either outcome. A concurrent build or residue from another run is untouched.
 * @param packageApp - packaging operation that owns the directory until it settles.
 * @returns the packaging operation's result after directory cleanup.
 */
export async function withDesktopStage<T>(packageApp: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-stage-'))
  try {
    return await packageApp(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
