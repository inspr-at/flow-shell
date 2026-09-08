import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const packageRoot = resolve(fixtureRoot, '..');
const umbrellaRoot = resolve(packageRoot, '../..');

function defaultWarn(message) {
  process.stderr.write(message);
}

/**
 * Discard an explicitly owned temp path through `trash` only. There is no
 * rm/unlink fallback. When trash is unavailable, retain the residue and emit a
 * bounded warning so a normal consumer `npm test` can finish.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(message: string) => void} [options.warn]
 * @returns {string | null} residue path when the discard did not happen
 */
export function trashTemp(path, { env = process.env, warn = defaultWarn } = {}) {
  try {
    execFileSync('trash', [path], {
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return null;
  } catch {
    warn(`warning: trash CLI unavailable; retaining owned temp residue at ${path}\n`);
    return path;
  }
}

export function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

export function commitAll(repoRoot, message) {
  git(repoRoot, ['add', '-A']);
  return git(repoRoot, ['commit', '-m', message]);
}

export function createTempRepo(prefix = 'flow-shell-pack-fixture-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'packaging-fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'Packaging Fixture']);
  return dir;
}

function shouldCopy(src) {
  const rel = src.slice(packageRoot.length).replace(/\\/g, '/');
  if (rel.includes('/node_modules') || rel.endsWith('/node_modules')) return false;
  if (rel.includes('/dist/') || rel.endsWith('/dist')) return false;
  if (rel.endsWith('/release/source-provenance.json')) return false;
  return true;
}

export function copyCurrentPackage(dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(packageRoot, dest, {
    recursive: true,
    filter: (src) => shouldCopy(src),
  });
}

export function copyContractFixtures(destRoot) {
  const identityValidUmbrella = join(umbrellaRoot, 'contracts/flow-identity/fixtures/valid');
  const identityInvalidUmbrella = join(umbrellaRoot, 'contracts/flow-identity/fixtures/invalid');
  const deliveryValidUmbrella = join(umbrellaRoot, 'contracts/delivery/fixtures/valid');
  const identityValidVendored = join(packageRoot, 'fixtures/contracts/flow-identity/valid');
  const identityInvalidVendored = join(packageRoot, 'fixtures/contracts/flow-identity/invalid');
  const deliveryValidVendored = join(packageRoot, 'fixtures/contracts/delivery/valid');
  const identityValid = existsSync(identityValidUmbrella) ? identityValidUmbrella : identityValidVendored;
  const identityInvalid = existsSync(identityInvalidUmbrella) ? identityInvalidUmbrella : identityInvalidVendored;
  const deliveryValid = existsSync(deliveryValidUmbrella) ? deliveryValidUmbrella : deliveryValidVendored;
  if (existsSync(identityValid)) {
    cpSync(identityValid, join(destRoot, 'contracts/flow-identity/fixtures/valid'), { recursive: true });
  }
  if (existsSync(identityInvalid)) {
    cpSync(identityInvalid, join(destRoot, 'contracts/flow-identity/fixtures/invalid'), { recursive: true });
  }
  if (existsSync(deliveryValid)) {
    cpSync(deliveryValid, join(destRoot, 'contracts/delivery/fixtures/valid'), { recursive: true });
  }
}

/**
 * Mirror the private umbrella layout: package under packages/flow-shell, curated
 * synthetic fixtures under contracts/.
 */
export function seedUmbrellaPackageTree(repoRoot) {
  const nested = join(repoRoot, 'packages/flow-shell');
  copyCurrentPackage(nested);
  copyContractFixtures(repoRoot);
}

export function packageRootIn(repoRoot) {
  return join(repoRoot, 'packages/flow-shell');
}

export function indexTree(repoRoot) {
  return git(repoRoot, ['write-tree']);
}

export function assertIndexUnchanged(repoRoot, beforeTree) {
  const afterTree = indexTree(repoRoot);
  if (beforeTree !== afterTree) {
    throw new Error(`git index changed during release build: ${beforeTree} -> ${afterTree}`);
  }
}

export function stagingResidue(outDir) {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir).filter((entry) => entry.startsWith('.publish-'));
}

export { dirname, fixtureRoot, packageRoot, umbrellaRoot };
