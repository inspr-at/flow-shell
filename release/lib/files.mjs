import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256 } from './digest.mjs';
import { expandAllowlistPaths, readBlob, treeDigest, validateArchivePath } from './git.mjs';
import { fromGitPath, toGitPath } from './layout.mjs';
import { expandAllowlistPathsFromTree, readTreeFile, treeDigestFromEntries } from './tree.mjs';

const FIXTURE_PREFIX = 'fixtures/contracts/';
const CONTRACT_FROM = /^(contracts\/(?:flow-identity|delivery)\/)/;

/**
 * @param {unknown} allowlist
 * @param {string} label
 */
export function assertAllowlistShape(allowlist, label) {
  if (!Array.isArray(allowlist?.paths) || !allowlist.paths.length) {
    throw new Error(`${label} must declare a non-empty paths array`);
  }
  if (!Array.isArray(allowlist.forbidden_patterns)) {
    throw new Error(`${label} must declare a forbidden_patterns array`);
  }
  if (allowlist.contract_trees !== undefined && !Array.isArray(allowlist.contract_trees)) {
    throw new Error(`${label} contract_trees must be an array when present`);
  }
}

/**
 * @param {string} path
 * @param {string[]} patterns
 */
export function assertNotForbidden(path, patterns) {
  for (const pattern of patterns) {
    if (new RegExp(pattern).test(path)) {
      throw new Error(`allowlisted path matches forbidden pattern ${pattern}: ${path}`);
    }
  }
}

/**
 * @param {Iterable<string>} paths
 * @param {string[]} patterns
 */
export function assertInventoryClosed(paths, patterns) {
  for (const path of paths) {
    validateArchivePath(path.replace(/\/$/, ''));
    assertNotForbidden(path, patterns);
  }
}

/**
 * @param {object} tree
 */
function assertContractTree(tree) {
  if (!tree || typeof tree.from !== 'string' || typeof tree.to !== 'string') {
    throw new Error('contract_trees entries must declare from and to');
  }
  validateArchivePath(tree.from.replace(/\/$/, ''));
  validateArchivePath(tree.to.replace(/\/$/, ''));
  if (tree.from.includes('..') || tree.to.includes('..')) {
    throw new Error(`contract tree path traversal rejected: ${tree.from} -> ${tree.to}`);
  }
  if (!CONTRACT_FROM.test(tree.from)) {
    throw new Error(`contract tree from must stay under contracts/flow-identity or contracts/delivery: ${tree.from}`);
  }
  if (!tree.to.startsWith(FIXTURE_PREFIX)) {
    throw new Error(`contract tree to must stay under ${FIXTURE_PREFIX}: ${tree.to}`);
  }
}

/**
 * @param {string} gitRoot
 * @param {string} commit
 * @param {string} gitPath
 */
function gitPathExists(gitRoot, commit, gitPath) {
  try {
    expandAllowlistPaths(gitRoot, commit, [gitPath.endsWith('/') ? gitPath : gitPath]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/symlink rejected|gitlink rejected|non-file mode|unsupported git type/.test(message)) {
      throw error;
    }
    if (/missing|not a regular file|unsupported file type/.test(message)) return false;
    throw error;
  }
}

/**
 * @param {object} input
 * @returns {Map<string, Buffer>}
 */
export function collectRuntimeFilesFromGit({ gitRoot, commit, packagePrefix, allowlist }) {
  assertAllowlistShape(allowlist, 'runtime allowlist');
  const gitPaths = allowlist.paths.map((path) => toGitPath(packagePrefix, path));
  const expanded = expandAllowlistPaths(gitRoot, commit, gitPaths);
  const files = new Map();
  for (const gitPath of expanded) {
    const rel = fromGitPath(packagePrefix, gitPath);
    assertNotForbidden(rel, allowlist.forbidden_patterns);
    files.set(rel, readBlob(gitRoot, commit, gitPath));
  }
  return files;
}

/**
 * @param {object} input
 * @returns {Map<string, Buffer>}
 */
export function collectRuntimeFilesFromTree({ packageRoot, allowlist }) {
  assertAllowlistShape(allowlist, 'runtime allowlist');
  const expanded = expandAllowlistPathsFromTree(packageRoot, allowlist.paths);
  const files = new Map();
  for (const path of expanded) {
    assertNotForbidden(path, allowlist.forbidden_patterns);
    files.set(path, readTreeFile(packageRoot, path));
  }
  return files;
}

/**
 * @param {object} input
 * @returns {Map<string, Buffer>}
 */
export function collectSourceFilesFromGit({ gitRoot, commit, packagePrefix, allowlist }) {
  assertAllowlistShape(allowlist, 'source allowlist');
  const files = new Map();
  const pending = [];
  for (const entry of allowlist.paths) {
    const gitPath = toGitPath(packagePrefix, entry);
    if (gitPathExists(gitRoot, commit, gitPath)) {
      pending.push(entry);
      continue;
    }
    if (entry.replace(/\/$/, '').startsWith(FIXTURE_PREFIX.replace(/\/$/, '')) || entry.startsWith(FIXTURE_PREFIX)) {
      continue;
    }
    throw new Error(`allowlisted path missing at ${commit}: ${gitPath}`);
  }
  if (pending.length) {
    const expanded = expandAllowlistPaths(
      gitRoot,
      commit,
      pending.map((path) => toGitPath(packagePrefix, path)),
    );
    for (const gitPath of expanded) {
      const rel = fromGitPath(packagePrefix, gitPath);
      assertNotForbidden(rel, allowlist.forbidden_patterns);
      files.set(rel, readBlob(gitRoot, commit, gitPath));
    }
  }
  for (const tree of allowlist.contract_trees ?? []) {
    assertContractTree(tree);
    const fromPrefix = tree.from.replace(/\/$/, '');
    const toPrefix = tree.to.replace(/\/$/, '');
    const materialized = [...files.keys()].some(
      (path) => path === toPrefix || path.startsWith(`${toPrefix}/`),
    );
    let expanded;
    try {
      expanded = expandAllowlistPaths(gitRoot, commit, [tree.from.endsWith('/') ? tree.from : `${tree.from}/`]);
    } catch (error) {
      if (materialized) continue;
      throw error;
    }
    for (const gitPath of expanded) {
      if (gitPath !== fromPrefix && !gitPath.startsWith(`${fromPrefix}/`)) {
        throw new Error(`contract tree expansion escaped ${fromPrefix}: ${gitPath}`);
      }
      const suffix = gitPath === fromPrefix ? '' : gitPath.slice(fromPrefix.length + 1);
      const dest = suffix ? `${toPrefix}/${suffix}` : toPrefix;
      assertNotForbidden(dest, allowlist.forbidden_patterns);
      const incoming = readBlob(gitRoot, commit, gitPath);
      const existing = files.get(dest);
      if (existing && !existing.equals(incoming)) {
        throw new Error(`contract tree destination collides with package path: ${dest}`);
      }
      files.set(dest, incoming);
    }
  }
  if (![...files.keys()].some((path) => path.startsWith(FIXTURE_PREFIX))) {
    throw new Error('source export must include curated synthetic contract fixtures');
  }
  return files;
}

/**
 * @param {object} input
 * @returns {Map<string, Buffer>}
 */
export function collectSourceFilesFromTree({ packageRoot, allowlist }) {
  assertAllowlistShape(allowlist, 'source allowlist');
  const expanded = expandAllowlistPathsFromTree(packageRoot, allowlist.paths);
  const files = new Map();
  for (const path of expanded) {
    assertNotForbidden(path, allowlist.forbidden_patterns);
    files.set(path, readTreeFile(packageRoot, path));
  }
  if (![...files.keys()].some((path) => path.startsWith(FIXTURE_PREFIX))) {
    throw new Error('source export must include curated synthetic contract fixtures');
  }
  return files;
}

/**
 * @param {Map<string, Buffer>} files
 * @param {string[]} runtimePaths
 */
export function runtimeTreeDigestFromFiles(files, runtimePaths) {
  return treeDigestFromEntries(runtimePaths.map((path) => [path, files.get(path)]));
}

/**
 * @param {string} gitRoot
 * @param {string} commit
 * @param {string} packagePrefix
 * @param {object} runtimeAllowlist
 */
export function runtimeTreeDigestFromGit(gitRoot, commit, packagePrefix, runtimeAllowlist) {
  const gitPaths = runtimeAllowlist.paths.map((path) => toGitPath(packagePrefix, path));
  const expanded = expandAllowlistPaths(gitRoot, commit, gitPaths);
  return treeDigest(gitRoot, commit, expanded);
}

/**
 * @param {Map<string, Buffer>} files
 * @returns {string}
 */
export function lockDigestFromFiles(files) {
  const lock = files.get('package-lock.json');
  if (!lock) throw new Error('package-lock.json missing from export inventory');
  return `sha256:${sha256(lock)}`;
}

/**
 * @param {Iterable<[string, Buffer]>} entries
 * @returns {string}
 */
export function opaqueTreeDigest(entries) {
  return treeDigestFromEntries(entries);
}

/**
 * Order-independent JSON encoding, used only to compare two allowlists.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * @param {string} packageRoot
 * @param {string} relPath
 * @returns {object}
 */
export function readJsonFile(packageRoot, relPath) {
  return JSON.parse(readFileSync(join(packageRoot, relPath), 'utf8'));
}

/**
 * @param {Buffer} data
 * @returns {string}
 */
export function sha256Buffer(data) {
  return createHash('sha256').update(data).digest('hex');
}
