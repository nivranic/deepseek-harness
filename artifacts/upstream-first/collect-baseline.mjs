/** Capture immutable Git comparisons and worktree state without reading product data or changing refs. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const upstream = 'c291e7961a515f6d7af9304e7fd1d257929aef26';
const spec = 'E:/11585/DeepSeek Harness 下一版 Agent 总实施规格（Upstream-First）.md';
const git = (args, cwd = root) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const lines = value => value.trim().split(/\r?\n/u).filter(Boolean);
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const changes = (base, head) => lines(git(['diff', '--no-renames', '--name-status', base, head])).map(line => {
  const [change, path] = line.split('\t');
  return { change, path };
});
const component = path => {
  const parts = path.split('/');
  if (parts[0] === 'packages') return parts.slice(0, 3).join('/');
  if (['apps', 'native', 'python', '.github'].includes(parts[0])) return parts.slice(0, 2).join('/');
  return parts[0];
};
const initialReports = ['GOAL_PROGRESS_SUMMARY_2026-09-14.md', 'IMPLEMENTATION_VERIFICATION_V2.md'];
const blocks = git(['worktree', 'list', '--porcelain']).trim().split(/\r?\n\r?\n/u);
const worktrees = blocks.map(block => {
  const fields = Object.fromEntries(lines(block).map(line => {
    const space = line.indexOf(' ');
    return space === -1 ? [line, true] : [line.slice(0, space), line.slice(space + 1)];
  }));
  const cwd = fields.worktree;
  const head = git(['rev-parse', 'HEAD'], cwd).trim();
  const base = git(['merge-base', head, upstream]).trim();
  const [ahead, behind] = git(['rev-list', '--left-right', '--count', `${head}...${upstream}`]).trim().split(/\s/u).map(Number);
  const tracked = git(['status', '--porcelain=v1', '-z', '--untracked-files=no'], cwd).split('\0').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], cwd).split('\0').filter(Boolean);
  const downstreamChanges = changes(base, head);
  const upstreamChanges = changes(base, upstream);
  const upstreamPaths = new Set(upstreamChanges.map(entry => entry.path));
  const overlappingPaths = downstreamChanges.filter(entry => upstreamPaths.has(entry.path)).map(entry => entry.path);
  const groups = {};
  for (const entry of downstreamChanges) {
    const owner = component(entry.path);
    (groups[owner] ??= []).push(entry);
  }
  return {
    path: cwd, branch: fields.branch ?? null, detached: fields.detached === true,
    head, mergeBase: base, ahead, behind,
    dirty: tracked.length > 0 || untracked.length > 0,
    trackedStatusRecords: tracked, untrackedPaths: untracked,
    downstreamChanges, upstreamChangedFileCount: upstreamChanges.length,
    overlappingPaths, components: groups,
  };
});
const main = worktrees.find(entry => entry.branch === 'refs/heads/dev');
const output = {
  schemaVersion: 1, status: 'IN_PROGRESS', collectedAt: new Date().toISOString(),
  upstream: { repository: 'https://github.com/deepseek-ai/deepseek-harness.git', ref: 'master', sha: upstream,
    commit: git(['show', '-s', '--format=%cI %s', upstream]).trim() },
  specification: { path: spec, sha256: sha256(spec) },
  candidate: { path: root, branch: git(['branch', '--show-current']).trim(), sha: git(['rev-parse', 'HEAD']).trim() },
  preservedReports: initialReports.map(path => ({ path: `${main.path}/${path}`, sha256: sha256(`${main.path}/${path}`) })),
  worktrees,
};
writeFileSync(resolve(root, 'UPSTREAM_DELTA.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ upstream, candidate: output.candidate, worktrees: worktrees.map(entry => ({
  path: entry.path, head: entry.head, ahead: entry.ahead, behind: entry.behind,
  tracked: entry.trackedStatusRecords.length, untracked: entry.untrackedPaths.length,
  customFiles: entry.downstreamChanges.length, overlap: entry.overlappingPaths.length,
})), components: [...new Set(worktrees.flatMap(entry => Object.keys(entry.components)))].sort() }, null, 2));
