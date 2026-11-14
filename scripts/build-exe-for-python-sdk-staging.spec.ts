import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, expect, it } from 'vitest'
import { deduplicateStagedWorkspacePackages, materializeStagedLinks, relocateStagedBuildApprovals } from './build-exe-for-python-sdk-staging.ts'

const temporaryDirectories: string[] = []
const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir'

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture(prefix: string) {
  const workspace = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(workspace)
  return workspace
}

it.each([true, false])('retains local build permissions and denials with the absolute denial first %s', async (denialFirst) => {
  const workspace = await fixture('dsh-python-staging-approvals-')
  const staging = join(workspace, 'payload')
  await mkdir(staging)
  const collisionIdentity = `@fixture/collision@${pathToFileURL(join(workspace, 'packages/collision')).href}`
  const collisionApprovals = [
    ['@fixture/collision@file:packages/collision', true],
    [collisionIdentity, false],
  ] as const
  const orderedApprovals = denialFirst ? [...collisionApprovals].reverse() : collisionApprovals
  const manifest = {
    packages: ['.'],
    autoInstallPeers: true,
    allowBuilds: {
      '@fixture/local@file:packages/local': true,
      '@fixture/denied@file:packages/denied': false,
      'external@1.2.3': false,
      esbuild: true,
      ...Object.fromEntries(orderedApprovals),
    },
  }
  const file = join(staging, 'pnpm-workspace.yaml')
  await writeFile(file, JSON.stringify(manifest))

  await relocateStagedBuildApprovals(staging, workspace)

  const expected = {
    ...manifest,
    allowBuilds: {
      [`@fixture/local@${pathToFileURL(join(workspace, 'packages/local')).href}`]: true,
      [`@fixture/denied@${pathToFileURL(join(workspace, 'packages/denied')).href}`]: false,
      'external@1.2.3': false,
      esbuild: true,
      [collisionIdentity]: false,
    },
  }
  expect(load(await readFile(file, 'utf8'))).toEqual(expected)
  await relocateStagedBuildApprovals(staging, workspace)
  expect(load(await readFile(file, 'utf8'))).toEqual(expected)
})

/** List every symbolic link below a directory. */
async function listSymlinks(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) return [path]
    if (entry.isDirectory()) return listSymlinks(path)
    return []
  }))
  return nested.flat()
}

it('drops the deploy root link that points back into the payload', async () => {
  const workspace = await fixture('dsh-python-staging-root-')
  const project = join(workspace, 'python', 'sdk-runtime')
  const staging = join(project, 'src', 'runtime', 'node')
  await mkdir(join(staging, 'node_modules'), { recursive: true })
  await writeFile(join(project, 'package.json'), '{"name":"dsh-python-runtime-closure"}\n')
  await symlink(project, join(staging, 'node_modules', 'dsh-python-runtime-closure'), directoryLinkType)

  await materializeStagedLinks(staging)

  expect(existsSync(join(staging, 'node_modules', 'dsh-python-runtime-closure'))).toBe(false)
  await expect(readFile(join(project, 'package.json'), 'utf8')).resolves.toContain('dsh-python-runtime-closure')
})

it('copies workspace package links as files and removes command shims', async () => {
  const workspace = await fixture('dsh-python-staging-packages-')
  const staging = join(workspace, 'runtime', 'node')
  const packageDirectory = join(workspace, 'packages', 'dsh-base')
  await mkdir(join(packageDirectory, 'lib'), { recursive: true })
  await writeFile(join(packageDirectory, 'package.json'), '{"name":"@deepseek-ai/dsh-base"}\n')
  await writeFile(join(packageDirectory, 'lib', 'index.js'), 'export {}\n')
  await mkdir(join(staging, 'node_modules', '@deepseek-ai'), { recursive: true })
  await mkdir(join(staging, 'node_modules', '.bin'), { recursive: true })
  await writeFile(join(staging, 'package.json'), '{"name":"dsh-python-runtime-closure"}\n')
  await symlink(packageDirectory, join(staging, 'node_modules', '@deepseek-ai', 'dsh-base'), directoryLinkType)
  await symlink(packageDirectory, join(staging, 'node_modules', '.bin', 'dsh'), directoryLinkType)

  await materializeStagedLinks(staging)

  expect(existsSync(join(staging, 'node_modules', '.bin'))).toBe(false)
  await expect(readFile(join(staging, 'node_modules', '@deepseek-ai', 'dsh-base', 'lib', 'index.js'), 'utf8'))
    .resolves.toBe('export {}\n')
  expect(await listSymlinks(staging)).toEqual([])
})

it.each(['workspace', 'staging'])('shares an identical workspace package with %s-relative metadata', async (metadataLocation) => {
  const workspace = await fixture('dsh-python-staging-dedupe-')
  const staging = join(workspace, 'payload')
  const metadataRoot = metadataLocation === 'staging' ? staging : workspace
  const modules = join(staging, 'node_modules')
  const root = join(modules, '@fixture', 'tools')
  const duplicate = join(modules, 'app', 'node_modules', '@fixture', 'tools')
  const differentPeers = join(modules, 'other', 'node_modules', '@fixture', 'tools')
  const external = join(modules, 'external')
  const externalCopy = join(modules, 'app', 'node_modules', 'external')
  for (const directory of [root, duplicate, differentPeers, external, externalCopy]) {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'index.js'), 'exports.scheduler = Symbol("scheduler")\n')
  }
  const locations = (paths: string[]) => paths.map(path => relative(metadataRoot, path))
  await writeFile(join(modules, '.modules.yaml'), JSON.stringify({ hoistedLocations: {
    '@fixture/tools@file:packages/tools(peer@1)': locations([root, duplicate]),
    '@fixture/tools@file:packages/tools(peer@2)': locations([differentPeers]),
    'external@1.0.0(@fixture/tools@file:packages/tools)': locations([external, externalCopy]),
  } }))

  await deduplicateStagedWorkspacePackages(staging, metadataRoot)

  expect(existsSync(duplicate)).toBe(false)
  for (const directory of [root, differentPeers, external, externalCopy]) {
    expect(existsSync(join(directory, 'index.js'))).toBe(true)
  }
  const fromRoot = createRequire(join(staging, 'entry.cjs'))
  const fromApp = createRequire(join(modules, 'app', 'entry.cjs'))
  const fromOther = createRequire(join(modules, 'other', 'entry.cjs'))
  expect(fromApp('@fixture/tools')).toBe(fromRoot('@fixture/tools'))
  expect(fromOther('@fixture/tools')).not.toBe(fromRoot('@fixture/tools'))
})

it('rejects invalid deployment metadata before removing any package', async () => {
  const workspace = await fixture('dsh-python-staging-metadata-')
  const staging = join(workspace, 'payload')
  const modules = join(staging, 'node_modules')
  const root = join(modules, 'tools')
  const duplicate = join(modules, 'app', 'node_modules', 'tools')
  const outside = join(workspace, 'source')
  for (const directory of [root, duplicate, outside]) await mkdir(directory, { recursive: true })
  const valid = { 'tools@file:packages/tools': [root, duplicate].map(path => relative(workspace, path)) }
  for (const invalid of [
    {},
    { hoistedLocations: { invalid: [42] } },
    { hoistedLocations: { ...valid, 'other@file:packages/other': [relative(workspace, outside)] } },
  ]) {
    await writeFile(join(modules, '.modules.yaml'), JSON.stringify(invalid))
    await expect(deduplicateStagedWorkspacePackages(staging, workspace)).rejects.toThrow('hoistedLocations')
    expect(existsSync(duplicate)).toBe(true)
    expect(existsSync(outside)).toBe(true)
  }
})
