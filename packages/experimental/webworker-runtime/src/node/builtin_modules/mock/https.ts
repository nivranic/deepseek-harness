/**
 * HTTPS listeners cannot bind sockets in a browser worker. The disabled Link
 * carrier can load; attempting to enable its TLS server fails explicitly.
 */
import { notImplementedFail } from '../../notImplementedFail.ts'

/** TLS server creation is unavailable in the worker host. */
export const createServer: typeof import('node:https').createServer = notImplementedFail('node:https', 'createServer')

/** CommonJS default export for the unreachable native TLS server operation. */
export default { createServer } satisfies Partial<typeof import('node:https')>
