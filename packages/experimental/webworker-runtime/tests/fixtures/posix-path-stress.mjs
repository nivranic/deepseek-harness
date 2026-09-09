/** Pure path operations isolated from the test runner's event loop. */
import assert from 'node:assert/strict'
import { basename, dirname, fileUrlToPath } from '../../src/module-system/posix-path.ts'

const path = 'file:///' + '?'.repeat(300000) + '\nend'
assert.equal(fileUrlToPath(path), path.slice(7))
assert.equal(fileUrlToPath(path + '#fragment'), path.slice(7))
const separators = '/a/' + '/'.repeat(300000) + 'b///'
assert.equal(dirname(separators), '/a')
assert.equal(basename(separators), 'b')
process.stdout.write('completed\n')
