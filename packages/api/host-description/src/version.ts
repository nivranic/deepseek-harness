/** Installed product release metadata. */

import { readFile } from 'node:fs/promises'
import { z } from 'zod'

/**
 * Read this Host package's installed release metadata, shared by the Harness package set.
 * @returns the package release string; missing or malformed metadata rejects startup.
 */
export async function readProductVersion(): Promise<string> {
  const path = new URL(import.meta.resolve('@deepseek-ai/dsh-api-host-description/package.json'))
  const manifest: unknown = JSON.parse(await readFile(path, 'utf8'))
  return z.object({ version: z.string().min(1) }).parse(manifest).version
}
