/**
 * Local durable artifact backend rooted below `DSH_HOME`: one atomic
 * `<id>.artifact` file per reference under `artifacts/`, resolving chapter
 * 56's resource channel for the host producer.
 * @module @deepseek-ai/dsh-artifact-local
 */

import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ArtifactId, ArtifactStore } from '@deepseek-ai/dsh-artifact'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Local artifact backend configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
}

/** Persistent local artifact store. */
export class LocalArtifactStore extends ArtifactStore {
  static Config: z<Config> = z.object({
    dshHome: z.string(),
  })

  private readonly directory: string

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.directory = join(resolveDshHome(config.dshHome), 'artifacts')
  }

  private file(id: ArtifactId): string {
    return join(this.directory, `${id}.artifact`)
  }

  async put(id: ArtifactId, data: Uint8Array): Promise<void> {
    await writeFileAtomic(this.file(id), data, { mode: 0o600, dirMode: 0o700 })
  }

  async get(id: ArtifactId): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(id)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
      throw error
    }
  }

  async remove(id: ArtifactId): Promise<void> {
    await rm(this.file(id), { force: true })
  }
}

export default LocalArtifactStore
