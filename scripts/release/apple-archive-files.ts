/** Inventory the regular bytes, permissions and internal symlinks carried by a Companion archive. */
import { lstat, readdir, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { hashRcOutput } from './rc-output.ts'

/**
 * Read an immutable archive without following symbolic-link directories.
 * @param root - real producer-owned archive directory; links may only resolve inside it.
 * @returns sorted entries; provisioning profiles, external links and special files fail.
 */
export async function inventoryAppleArchive(root: string): Promise<Record<string, unknown>[]> {
  if (!(await lstat(root)).isDirectory()) throw new Error('archive root must be a real directory')
  const resolvedRoot = await realpath(root)
  const entries: Record<string, unknown>[] = []
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name)
      const item = await lstat(path)
      const archivePath = relative(root, path).split(sep).join('/')
      if (name === 'embedded.mobileprovision' || name === 'embedded.provisionprofile') {
        throw new Error('Companion archives must not contain provisioning profiles')
      }
      if (item.isSymbolicLink()) {
        const target = await readlink(path)
        const child = relative(resolvedRoot, await realpath(path))
        if (isAbsolute(target) || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
          throw new Error('archive symlink leaves its owned directory')
        }
        entries.push({ path: archivePath, kind: 'symlink', target })
      } else if (item.isDirectory()) {
        entries.push({ path: archivePath, kind: 'directory', mode: item.mode & 0o777 })
        await visit(path)
      } else if (item.isFile()) {
        entries.push({ path: archivePath, kind: 'file', mode: item.mode & 0o777, ...await hashRcOutput(path) })
      } else {
        throw new Error('archive contains an unsupported filesystem entry')
      }
    }
  }
  await visit(root)
  return entries
}
