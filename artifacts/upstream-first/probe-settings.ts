/** Inspect downstream metadata with the actual upstream provider, using only generated fixtures. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileSettingsProvider } from '../../packages/settings/settings-file/src/index.ts'

const root = resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(join(root, '.artifacts/settings-probe-'))
const observations = []
for (const formatVersion of [1, 2]) {
  const path = join(directory, `settings-${String(formatVersion)}.json`)
  const original = JSON.stringify({ formatVersion, 'ui-theme': { theme: 'light' } }) + '\n'
  await writeFile(path, original)
  const ctx = new Context()
  const fiber = ctx.plugin(FileSettingsProvider, { path, watch: false })
  try {
    await fiber
    const scope = ctx.settings.register('ui-theme', z.object({ theme: z.string().default('dark') }))
    assert.equal(scope.get().theme, 'light')
    assert.equal(await readFile(path, 'utf8'), original)
    await scope.update({ theme: 'dark' })
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    assert.equal(written.formatVersion, formatVersion)
    observations.push({ formatVersion, namespaceLoaded: true, sourceUnchangedOnRead: true, metadataPreservedOnWrite: true })
  } finally {
    await fiber.dispose()
  }
}
const result = {
  status: 'PASS', scope: 'actual upstream provider observation on generated JSON fixtures only',
  observations, unknownFormatMetadataIsNotACompatibilityCheck: true,
}
await writeFile(join(root, 'artifacts/upstream-first/settings-probe.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
