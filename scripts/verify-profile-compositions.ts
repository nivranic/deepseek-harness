/** Check shipped profile layers using the launcher's parser and patch semantics. */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { isCordisGroupEntry, loadCordisYaml } from './cordis-yaml.ts'

const PROFILE_SOURCE = 'packages/boot/app-boot/src/profile.ts'
const DESKTOP_SOURCE = 'apps/desktop/src/project-manager.ts'
const DESKTOP_PATCH = 'apps/desktop-host/config/desktop.cordis.patch.yml'

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)
    || ts.isParenthesizedExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    expression = expression.expression
  }
  return expression
}

/** Read an owned top-level declaration without importing or executing its source. */
function constant(repoRoot: string, file: string, name: string): ts.Expression {
  const source = ts.createSourceFile(file, readFileSync(resolve(repoRoot, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const declarations = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)
  const initializer = declarations[0]?.initializer
  if (declarations.length !== 1 || initializer === undefined) {
    throw new Error(`${file}: expected one initialized ${name} declaration`)
  }
  return unwrap(initializer)
}

function members(expression: ts.Expression, label: string): Map<string, ts.Expression> {
  const object = unwrap(expression)
  if (!ts.isObjectLiteralExpression(object)) throw new Error(`${label}: expected a literal object`)
  const result = new Map<string, ts.Expression>()
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)
      || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) {
      throw new Error(`${label}: expected named properties without spreads or computed keys`)
    }
    const name = property.name.text
    if (result.has(name)) throw new Error(`${label}: duplicate property ${JSON.stringify(name)}`)
    result.set(name, property.initializer)
  }
  return result
}

function bundles(expression: ts.Expression | undefined, label: string): string[] {
  const array = expression === undefined ? undefined : unwrap(expression)
  if (array === undefined || !ts.isArrayLiteralExpression(array) || array.elements.length === 0) {
    throw new Error(`${label}: expected a nonempty literal bundle list`)
  }
  return array.elements.map((element) => {
    if (!ts.isStringLiteral(element) || element.text === '') {
      throw new Error(`${label}: bundle names must be nonempty string literals`)
    }
    return element.text
  })
}

/** A statically disabled group also disables every entry it contains. */
function visitEntries(
  rows: readonly unknown[], visit: (row: Record<string, unknown>, active: boolean) => void, parentActive = true,
): void {
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const entry = row as Record<string, unknown>
    const active = parentActive && entry.disabled !== true
    visit(entry, active)
    if (isCordisGroupEntry(entry)) visitEntries(entry.config, visit, active)
  }
}

function presetPlaneErrors(repoRoot: string, label: string, entries: readonly unknown[]): string[] {
  const hostIds = new Set<string>()
  const hostPackages = new Set<string>()
  visitEntries(entries, (entry, active) => {
    if (!active) return
    if (typeof entry.id === 'string' && typeof entry.name === 'string') hostIds.add(entry.id)
    if (typeof entry.name === 'string') hostPackages.add(entry.name)
  })
  if (!hostPackages.has('@deepseek-ai/dsh-agent-presets')) return []
  const files = globSync('packages/preset/agent-presets/presets/*/agent.cordis.yml', { cwd: repoRoot })
    .map(file => file.replaceAll('\\', '/')).sort()
  if (files.length === 0) return [`${label}: shipped preset roster is empty`]
  return files.flatMap((file) => {
    const preset = loadCordisYaml(readFileSync(resolve(repoRoot, file), 'utf8'))
    if (!Array.isArray(preset)) throw new Error(`${file}: preset must be a Loader entry array`)
    const repeated = new Set<string>()
    visitEntries(preset, (entry, active) => {
      if (active && typeof entry.id === 'string' && typeof entry.name === 'string' && hostIds.has(entry.id)) {
        repeated.add(entry.id)
      }
    })
    return [...repeated].map(id => `${label}: ${file}: row ${JSON.stringify(id)} is also active in the host composition; a row belongs to exactly one plane`)
  })
}

/**
 * Check every declared CLI profile and the Desktop's core bundle list plus its private patch.
 * Expressions in plugin configuration remain unevaluated. Repeated row ids share one
 * Loader tree even across nested groups; ordinary plugin config arrays are not entry lists.
 * @param repoRoot - Source checkout containing the profile declarations and patches.
 * @param bundlePatches - Workspace package names mapped to their declared patch paths.
 * @returns Diagnostics for repeated ids, Host/preset overlap, or unreadable/missing layers.
 * @throws when a source roster is absent, empty, or no longer a statically readable declaration.
 */
export function profileCompositionErrors(repoRoot: string, bundlePatches: ReadonlyMap<string, string>): string[] {
  const templates = members(constant(repoRoot, PROFILE_SOURCE, 'PROFILE_TEMPLATES'), PROFILE_SOURCE)
  if (templates.size === 0) throw new Error(`${PROFILE_SOURCE}: shipped profile roster is empty`)
  const profiles = [...templates].map(([name, expression]) => ({
    label: `profile ${name}`,
    bundles: bundles(members(expression, `${PROFILE_SOURCE}:${name}`).get('bundles'), `${PROFILE_SOURCE}:${name}`),
    patches: [] as string[],
  }))
  profiles.push({
    label: 'Desktop profile',
    bundles: bundles(constant(repoRoot, DESKTOP_SOURCE, 'DESKTOP_PROFILE_BUNDLES'), DESKTOP_SOURCE),
    patches: [DESKTOP_PATCH],
  })
  return profiles.flatMap((profile) => {
    try {
      const paths = [...profile.bundles.map((name) => {
        const path = bundlePatches.get(name)
        if (path === undefined) throw new Error(`bundle ${JSON.stringify(name)} has no workspace patch declaration`)
        return path
      }), ...profile.patches]
      const entries = composeEntries(paths.map(path => loadOverlayPatches('profile composition', resolve(repoRoot, path))))
      const problems: string[] = []
      const seen = new Set<string>()
      visitEntries(entries, (row) => {
        if (typeof row.id === 'string' && row.id !== '') {
          if (seen.has(row.id)) problems.push(`${profile.label}: duplicate loader entry id ${JSON.stringify(row.id)}`)
          seen.add(row.id)
        }
      })
      return [...problems, ...presetPlaneErrors(repoRoot, profile.label, entries)]
    } catch (error) {
      return [`${profile.label}: ${error instanceof Error ? error.message : String(error)}`]
    }
  })
}
