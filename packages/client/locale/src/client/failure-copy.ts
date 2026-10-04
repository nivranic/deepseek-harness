/**
 * §45 same-semantics presentation for Remote failures: one shared mapping
 * from the closed failure-class vocabulary to the common dictionary's copy,
 * so every Client surface renders one failure the same way.
 */
import { classifyRemoteFailure, type RemoteFailureClass } from '@deepseek-ai/dsh-typert-protocol'

/** The common vocabulary's failure keys — the §45 copy schema every surface shares. */
export type FailureCopyKey =
  'failure.authentication' | 'failure.permission' | 'failure.compatibility' | 'failure.conflict'
  | 'failure.host-state' | 'failure.carrier-invalid' | 'failure.transport' | 'failure.unavailable'
  | 'failure.raw'

/**
 * Translator over the failure keys. Any namespace-bound translate satisfies
 * this structurally: the failure keys live in the shared common vocabulary
 * every key domain includes.
 */
export type RemoteFailureTranslate = (key: FailureCopyKey, params?: Record<string, unknown>) => string

/**
 * Raw diagnostic of any caught shape: an Error's message, a wire failure's
 * message field, or the string form — never invented.
 * @param error - the caught value.
 * @returns its raw diagnostic text.
 */
function rawMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' ? message : String(error)
}

/**
 * Render one failure class through the shared classification copy.
 * Classes with agreed cross-Client semantics get the common copy; `unknown`
 * keeps the raw diagnostic through the `failure.raw` template — presentable
 * unchanged, never invented.
 * @param cls - the classified failure class.
 * @param message - the raw diagnostic, shown only for `unknown`.
 * @param t - any namespace-bound translate (the failure keys live in the
 *   shared common vocabulary every key domain includes).
 * @returns the localized failure line.
 */
export function remoteFailureClassCopy(cls: RemoteFailureClass, message: string, t: RemoteFailureTranslate): string {
  switch (cls) {
    case 'authentication': return t('failure.authentication')
    case 'permission': return t('failure.permission')
    case 'compatibility': return t('failure.compatibility')
    case 'conflict': return t('failure.conflict')
    case 'host-state': return t('failure.host-state')
    case 'carrier-invalid': return t('failure.carrier-invalid')
    case 'transport': return t('failure.transport')
    case 'unavailable': return t('failure.unavailable')
    default: return t('failure.raw', { message })
  }
}

/**
 * Render one caught Remote failure through the shared classification.
 * @param error - any caught value; non-Remote failures resolve to the raw line.
 * @param t - any namespace-bound translate (the failure keys live in the
 *   shared common vocabulary every key domain includes).
 * @returns the localized failure line.
 */
export function remoteFailureCopy(error: unknown, t: RemoteFailureTranslate): string {
  return remoteFailureClassCopy(classifyRemoteFailure(error), rawMessageOf(error), t)
}
