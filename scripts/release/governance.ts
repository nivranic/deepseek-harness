/** Release-foundation requirements cannot be removed or waived by checklist JSON. */

const engineeringOwners = {
  'G2-VERSION': 'product-identity', 'G2-CHANNEL': 'distribution-policy', 'G2-CI': 'candidate-ci',
  'G2-SUPPLY': 'candidate-security', 'G2-WIN': 'windows-acceptance', 'G2-MAC': 'macos-acceptance',
  'G2-MACSIGN': 'macos-signing-dry-run', 'G2-IOS': 'ios-acceptance', 'G2-AND': 'android-acceptance',
  'G2-CRASH': 'product-diagnostics', 'G2-SUPPORT': 'support-export', 'G2-MIG': 'storage-migration',
  'G2-COMPAT': 'compatibility-corpus', 'G2-ROLL': 'recovery-rehearsal', 'G2-GOV': 'release-checklist',
  'G2-RC': 'candidate-artifacts',
} as const
const productionOwners = {
  'PROD-SIGN': 'production-signing', 'PROD-NOTARY': 'apple-notarization',
  'PROD-STORES': 'store-submission', 'PROD-PUBLISH': 'artifact-publication',
  'PROD-ROLLOUT': 'production-rollout', 'PROD-IDENTITY': 'developer-identity-submission',
} as const
const roles = ['release', 'runtime', 'security', 'windows', 'macos', 'apple-mobile', 'android', 'quality'] as const
type Role = typeof roles[number]
type EngineeringId = keyof typeof engineeringOwners
type ProductionId = keyof typeof productionOwners
interface Requirement<Id extends string> {
  id: Id
  ownerRole: Role
  evidenceOwner: string
  definitionOfDone: string
}

/** Checkout-owned requirements; serialized verdicts and engineering waivers are forbidden. */
export interface ReleaseChecklist {
  schemaVersion: 1
  scope: 'release-foundation'
  engineering: Requirement<EngineeringId>[]
  production: Requirement<ProductionId>[]
}

/** Same-process owner observations; this type is never parsed from user-supplied JSON. */
export interface GovernanceObservation {
  id: EngineeringId
  status: 'PASS' | 'FAIL' | 'PENDING' | 'UNAVAILABLE'
  reason: string
}

function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join() !== [...keys].sort().join()) throw new Error('invalid release checklist fields')
  return input as Record<string, unknown>
}

function requirements<Id extends string>(input: unknown, owners: Record<Id, string>): Requirement<Id>[] {
  if (!Array.isArray(input) || input.length !== Object.keys(owners).length) throw new Error('release checklist must contain every requirement')
  const seen = new Set<string>()
  const rows = input.map((value: unknown): Requirement<Id> => {
    const row = object(value, ['id', 'ownerRole', 'evidenceOwner', 'definitionOfDone'])
    if (typeof row.id !== 'string' || !Object.hasOwn(owners, row.id) || seen.has(row.id)) {
      throw new Error('unknown or duplicate release requirement')
    }
    seen.add(row.id)
    const id = row.id as Id
    if (row.evidenceOwner !== owners[id]) throw new Error('release requirement has another evidence owner')
    if (!roles.some(role => role === row.ownerRole)) throw new Error('unknown release owner role')
    if (typeof row.definitionOfDone !== 'string' || row.definitionOfDone.trim().length === 0) throw new Error('release requirement needs a definition of done')
    return { id, ownerRole: row.ownerRole as Role, evidenceOwner: owners[id], definitionOfDone: row.definitionOfDone }
  })
  return rows.sort((a, b) => a.id.localeCompare(b.id, 'en'))
}

/**
 * Validate the complete release-foundation checklist without accepting stored verdicts.
 * @param input - Untrusted checklist JSON owned by the selected source checkout.
 * @returns Canonical requirements; missing IDs, changed owners and extra fields reject.
 */
export function parseReleaseChecklist(input: unknown): ReleaseChecklist {
  const row = object(input, ['schemaVersion', 'scope', 'engineering', 'production'])
  if (row.schemaVersion !== 1 || row.scope !== 'release-foundation') throw new Error('unsupported release checklist schema or scope')
  return { schemaVersion: 1, scope: 'release-foundation', engineering: requirements(row.engineering, engineeringOwners),
    production: requirements(row.production, productionOwners) }
}

/**
 * Reduce only observations returned by the command's fixed verification owners.
 * @param checklist - Parsed complete policy from the selected source.
 * @param observations - In-process results; absent owners remain unavailable.
 * @returns Engineering Go/No-Go and separate unexecuted production actions, never publication authority.
 */
export function evaluateReleaseChecklist(checklist: ReleaseChecklist, observations: readonly GovernanceObservation[]) {
  const engineering = checklist.engineering.map((requirement) => {
    const observation = observations.find(row => row.id === requirement.id)
    return { ...requirement, status: observation?.status ?? 'UNAVAILABLE', reason: observation?.reason ?? 'verification adapter is not implemented' }
  })
  return { schemaVersion: 1 as const, scope: checklist.scope,
    decision: engineering.every(row => row.status === 'PASS') ? 'GO' as const : 'NO_GO' as const,
    publicationAuthorized: false as const, engineering,
    production: checklist.production.map(row => ({ ...row, status: 'NOT_EXECUTED' as const })) }
}
