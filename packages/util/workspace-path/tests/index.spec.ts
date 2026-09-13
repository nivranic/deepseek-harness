import { describe, expect, it } from 'vitest'
import {
  abbreviateHomePath, resolveWorkspacePath, workspaceTitleOf,
} from '@deepseek-ai/dsh-util-workspace-path'

describe('Workspace path helpers', () => {
  it('resolves relative paths without changing absolute paths', () => {
    expect(resolveWorkspacePath('/w', 'src/a.ts')).toBe('/w/src/a.ts')
    expect(resolveWorkspacePath('/w/', '/abs/a.ts')).toBe('/abs/a.ts')
    expect(resolveWorkspacePath(undefined, 'src/a.ts')).toBe('src/a.ts')
    expect(resolveWorkspacePath('', 'src/a.ts')).toBe('src/a.ts')
    expect(resolveWorkspacePath('/w', 'C:\\x\\a.ts')).toBe('C:\\x\\a.ts')
    expect(resolveWorkspacePath('/w', '\\\\server\\share')).toBe('\\\\server\\share')
  })

  it('abbreviates only descendants of a POSIX home', () => {
    expect(abbreviateHomePath('/Users/u', '/Users/u')).toBe('~')
    expect(abbreviateHomePath('/Users/u/', '/Users/u')).toBe('~')
    expect(abbreviateHomePath('/Users/u/Documents/project', '/Users/u')).toBe('~/Documents/project')
    expect(abbreviateHomePath('/Users/u2/a.ts', '/Users/u')).toBe('/Users/u2/a.ts')
    expect(abbreviateHomePath('/Users/u/a.ts')).toBe('/Users/u/a.ts')
    expect(abbreviateHomePath('/Users/u/a.ts', '')).toBe('/Users/u/a.ts')
    expect(abbreviateHomePath('/etc/hosts', '/')).toBe('/etc/hosts')
    expect(abbreviateHomePath('C:\\Users\\u\\project', 'C:\\Users\\u')).toBe('C:\\Users\\u\\project')
    expect(abbreviateHomePath('\\\\server\\share\\u', '\\\\server\\share\\u'))
      .toBe('\\\\server\\share\\u')
  })

  it('reads the final path segment on both path styles', () => {
    expect(workspaceTitleOf('/work/project/')).toBe('project')
    expect(workspaceTitleOf('C:\\work\\project\\')).toBe('project')
    expect(workspaceTitleOf('/')).toBe('')
    expect(workspaceTitleOf('')).toBe('')
    expect(workspaceTitleOf('C:\\work\\project/\\/')).toBe('project')
    expect(resolveWorkspacePath('/work/\\/', '\\file')).toBe('/work/file')
    expect(abbreviateHomePath('/work\\/', '/work\\/')).toBe('~')
  })

  it('preserves long internal separator runs without repeatedly scanning them', () => {
    const path = `/work/${'/'.repeat(200_000)}project`
    const start = performance.now()
    expect(workspaceTitleOf(path)).toBe('project')
    expect(resolveWorkspacePath(path, 'file')).toBe(`${path}/file`)
    expect(abbreviateHomePath(path, '/work')).toBe(`~${path.slice(5)}`)
    expect(performance.now() - start).toBeLessThan(2000)
  })
})
