/**
 * §42 free-text redaction: credential-shaped spans in agent error text are
 * replaced before the fact enters the ring, and the §43 bundle sanitizer
 * refuses a string value that carries one of the same shapes. The scan is
 * shape-based best effort — it names the three shapes real credentials take
 * (a bearer header, a prefixed API key, a `name: value` assignment), never a
 * semantic secret detector; a credential outside these shapes still passes,
 * which the payload's closed field vocabulary keeps out of every other
 * channel. Hash-shaped values (a bare 40/64-hex revision or digest) match no
 * shape and pass untouched.
 * @module redact
 */

/** The closed credential-shape vocabulary this module names. */
export type SecretShapeKind = 'bearer' | 'key' | 'assignment'

interface SecretShape {
  readonly kind: SecretShapeKind
  readonly pattern: RegExp
}

const SECRET_SHAPES: readonly SecretShape[] = [
  // An HTTP authorization header value: the scheme then a long token run.
  { kind: 'bearer', pattern: /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}/gu },
  // A prefixed API key: the vendor prefix then a long token run.
  { kind: 'key', pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/gu },
  // A credential assignment: a secret-named field then its long value, with the
  // pairing quote consumed when the value is quoted. The class stays lowercase
  // only: the `i` flag already folds case, and a duplicated A-Z half would be
  // the same set twice over.
  { kind: 'assignment', pattern: /\b(?:api[-_]?key|token|passwd|password|secret|credential)s?[ \t]*[:=][ \t]*["']?[a-z0-9._~+/=-]{8,}["']?/giu },
]

/**
 * Name the first credential shape a string carries, if any.
 * @param text - any free-text value about to enter a §42 fact or a §43 entry.
 * @returns the shape's kind, or undefined for a clean string.
 */
export function carriedSecretShape(text: string): SecretShapeKind | undefined {
  for (const shape of SECRET_SHAPES) {
    shape.pattern.lastIndex = 0
    if (shape.pattern.test(text)) return shape.kind
  }
  return undefined
}

/**
 * Replace every credential-shaped span with its named marker, so an error
 * message that quotes a credential still reports the failure without the
 * secret. The original text never leaves the process through this module's
 * callers.
 * @param text - the raw error text.
 * @returns the text with each matched span replaced by `[redacted:<kind>]`.
 */
export function redactSecretShapedText(text: string): string {
  let redacted = text
  for (const shape of SECRET_SHAPES) {
    redacted = redacted.replace(shape.pattern, () => `[redacted:${shape.kind}]`)
  }
  return redacted
}
