/** Validate Android scanner output with the repository's complete CycloneDX 1.6 schema. */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { JsonValidator } from '@cyclonedx/cyclonedx-library/Validation'
import { Version } from '@cyclonedx/cyclonedx-library/Spec'

try {
  if (process.argv.length !== 3) throw new Error('Require one SBOM file')
  const content = readFileSync(process.argv[2], 'utf8')
  const bom = JSON.parse(content)
  if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6'
    || await new JsonValidator(Version.v1dot6).validate(content) !== null) {
    throw new Error('Invalid CycloneDX 1.6 document')
  }
  const manifest = createRequire(import.meta.url).resolve('@cyclonedx/cyclonedx-library/package.json')
  const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'))
  const files = []
  function inventory(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name
      if (entry.isDirectory()) inventory(join(directory, entry.name), relative + '/')
      else if (entry.isFile()) {
        const sha256 = createHash('sha256').update(readFileSync(join(directory, entry.name))).digest('hex')
        files.push({ path: relative, sha256 })
      } else throw new Error('Validator distribution contains a link or special file')
    }
  }
  inventory(dirname(manifest))
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  process.stdout.write(JSON.stringify({ name, version, fileCount: files.length,
    distributionSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') }) + '\n')
} catch {
  process.stderr.write('Android SBOM schema validation failed\n')
  process.exitCode = 1
}
