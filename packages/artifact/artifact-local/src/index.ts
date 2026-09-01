/**
 * Local durable artifact backend rooted below `DSH_HOME`: one atomic
 * `<id>.artifact` file per reference under `artifacts/`, resolving chapter
 * 56's resource channel for the host producer.
 * @module @deepseek-ai/dsh-artifact-local
 */

import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dirent } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ArtifactId, ArtifactStore } from '@deepseek-ai/dsh-artifact'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** File suffix every stored artifact carries below `artifacts/`. */
const ARTIFACT_SUFFIX = '.artifact'

/** How often a configured retention window resweeps besides the boot sweep. */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Milliseconds per day, the unit `retentionDays` counts in. */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Local artifact backend configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Days stored artifact bytes may age before the sweep removes them; omitted keeps every artifact forever. */
  retentionDays?: number
}

/** Persistent local artifact store. */
export class LocalArtifactStore extends ArtifactStore {
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    retentionDays: z.natural().min(1),
  })

  private readonly directory: string

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.directory = join(resolveDshHome(config.dshHome), 'artifacts')
    const { retentionDays } = config
    if (retentionDays === undefined) return
    ctx.effect(() => {
      const timer = setInterval(() => { void this.sweep(retentionDays) }, SWEEP_INTERVAL_MS)
      timer.unref()
      void this.sweep(retentionDays)
      return () => { clearInterval(timer) }
    }, 'artifact-local: retention sweep')
  }

  private file(id: ArtifactId): string {
    return join(this.directory, `${id}${ARTIFACT_SUFFIX}`)
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

  /**
   * Delete stored artifacts whose bytes are older than the retention window,
   * returning the removed ids. Age is time since the bytes were written —
   * reads never refresh it. Best-effort per file: one unreadable entry is
   * logged and skipped, never blocking the rest of the sweep; an artifacts
   * directory that never materialized holds nothing to prune.
   * @param retentionDays - maximum age in days a stored artifact may reach.
   * @returns the ids whose files the sweep removed.
   */
  async sweep(retentionDays: number): Promise<string[]> {
    const cutoff = Date.now() - retentionDays * MS_PER_DAY
    let entries: Dirent[]
    try {
      entries = await readdir(this.directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
      throw error
    }
    const removed: string[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(ARTIFACT_SUFFIX)) continue
      const file = join(this.directory, entry.name)
      try {
        if ((await stat(file)).mtimeMs >= cutoff) continue
        await rm(file, { force: true })
        removed.push(entry.name.slice(0, -ARTIFACT_SUFFIX.length))
      } catch (error) {
        this.ctx.logger.warn(`artifact-local sweep skipped ${entry.name}: ${String(error)}`)
      }
    }
    return removed
  }
}

export default LocalArtifactStore
