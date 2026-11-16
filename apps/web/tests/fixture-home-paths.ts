/** Typed Harness-home path placeholders for Web Session fixture storage and comparison. */

const HOME = '{{harnessHome}}'
const JSON_PATH = /("(?:file_path|path)"\s*:\s*)("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")/g

function mapHomePaths(log: string, home: string, mode: 'capture' | 'realize'): string {
  const windows = /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(home)
  const canonicalHome = windows ? home.replaceAll('\\', '/') : home
  const separator = windows ? '\\' : '/'
  const mapPath = (value: string): string => {
    const candidate = windows ? value.replaceAll('\\', '/') : value
    const root = mode === 'capture' ? canonicalHome : HOME
    if (candidate !== root && !candidate.startsWith(root + '/')) return value
    const suffix = candidate.slice(root.length)
    return mode === 'capture' ? HOME + suffix : home + suffix.replaceAll('/', separator)
  }
  const mapValue = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') {
      if (key === 'path' || key === 'file_path') return mapPath(value)
      if (key === 'arguments') {
        return value.replace(JSON_PATH, (matched, prefix: string, atom: string) => {
          const decoded = JSON.parse(atom) as string
          const mapped = mapPath(decoded)
          return mapped === decoded ? matched : prefix + JSON.stringify(mapped)
        })
      }
      if (key === 'text') return value.replace(/<path>([^<]*)<\/path>/g, (_tag, path: string) => `<path>${mapPath(path)}</path>`)
      return value
    }
    if (Array.isArray(value)) return value.map(item => mapValue(item))
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, mapValue(item, name)]))
    }
    return value
  }
  return log.split('\n').map(line => line.trim() === '' ? line : JSON.stringify(mapValue(JSON.parse(line)))).join('\n')
}

/**
 * Capture exact known home paths in path fields, JSON tool arguments and read-result path tags.
 * Other roots, adjacent names and ordinary prose remain unchanged.
 * @param log - Session JSONL containing native or slash-form paths.
 * @param home - This scenario's isolated Harness home.
 * @returns JSONL with explicit home tokens and canonical suffix separators.
 */
export function captureFixtureHomePaths(log: string, home: string): string {
  return mapHomePaths(log, home, 'capture')
}

/**
 * Expand explicit expected home-path tokens before ordinary full-Session comparison.
 * @param log - Stored Session JSONL with home-path placeholders.
 * @param home - This scenario's isolated Harness home.
 * @returns JSONL with native expected paths and correctly escaped tool arguments.
 */
export function realizeFixtureHomePaths(log: string, home: string): string {
  return mapHomePaths(log, home, 'realize')
}
