import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/**
 * @param {string} start
 * @returns {string | null}
 */
export function findGitRoot(start) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: start,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Map a package-relative path onto the Git tree. Isolated fixture repos and
 * extracted public source have package.json at the Git root; the private
 * umbrella keeps this package under packages/flow-shell/.
 *
 * @param {string} packageRoot
 */
export function resolveLayout(packageRoot) {
  const gitRoot = findGitRoot(packageRoot);
  if (!gitRoot) {
    return { packageRoot, gitRoot: null, packagePrefix: '', fromTree: true };
  }
  const realPackage = realpathSync(resolve(packageRoot));
  const realGit = realpathSync(gitRoot);
  const rel = relative(realGit, realPackage);
  if (rel.startsWith('..') || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)) {
    throw new Error('package root is outside the Git checkout');
  }
  const packagePrefix = rel === '' ? '' : rel.split(sep).join('/');
  return { packageRoot: realPackage, gitRoot: realGit, packagePrefix, fromTree: false };
}

/**
 * @param {string} packagePrefix
 * @param {string} packagePath
 * @returns {string}
 */
export function toGitPath(packagePrefix, packagePath) {
  const normalized = packagePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!packagePrefix) return normalized;
  if (!normalized || normalized === '.') return packagePrefix;
  return `${packagePrefix}/${normalized}`;
}

/**
 * @param {string} packagePrefix
 * @param {string} gitPath
 * @returns {string}
 */
export function fromGitPath(packagePrefix, gitPath) {
  if (!packagePrefix) return gitPath;
  if (gitPath === packagePrefix) return '';
  const prefix = `${packagePrefix}/`;
  if (!gitPath.startsWith(prefix)) {
    throw new Error(`git path ${gitPath} is outside package prefix ${packagePrefix}`);
  }
  return gitPath.slice(prefix.length);
}
