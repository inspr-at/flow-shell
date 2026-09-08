import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildRelease, resolveReleaseSource } from '../release/build-release.mjs';
import { sha256 } from '../release/lib/digest.mjs';
import { expandAllowlistPaths, resolveCommit, validateArchivePath } from '../release/lib/git.mjs';
import { LEGACY_SEMVER_PUBLIC, publishImmutableReleasePair, stableArtifactFilename, stableManifestFilename, stableReleaseDirname, verifyReleasePair } from '../release/lib/manifest.mjs';
import {
  assertIndexUnchanged,
  assertCommandUnavailableOnPath,
  commitAll,
  createTempRepo,
  indexTree,
  makeIsolatedPathBin,
  packageRootIn,
  seedUmbrellaPackageTree,
  stagingResidue,
  trashTemp,
  packageRoot as sourcePackageRoot,
} from './packaging-support.js';

const NODE = process.execPath;
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const ARTIFACT_NAME = stableArtifactFilename(VERSION);
const MANIFEST_NAME = stableManifestFilename(VERSION);
const RELEASE_DIRNAME = stableReleaseDirname(VERSION);
const COORDINATE = `npm:@inspr/flow-shell@${VERSION}.tgz`;

function listTarballPaths(archivePath) {
  return execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

function extractTarball(archivePath, dest) {
  mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['-xzf', archivePath, '-C', dest], { stdio: 'ignore' });
}

function seededUmbrella(prefix) {
  const repo = createTempRepo(prefix);
  seedUmbrellaPackageTree(repo);
  commitAll(repo, 'seed flow-shell package');
  return { repo, pkgRoot: packageRootIn(repo), commit: resolveCommit(repo) };
}

describe('INSPR-380 runtime packaging', () => {
  it('pins the current commit and rejects option-like refs', () => {
    const { repo, pkgRoot, commit } = seededUmbrella('flow-pack-refs-');
    try {
      const source = resolveReleaseSource(pkgRoot);
      assert.equal(source.commit, commit);
      assert.equal(source.fromTree, false);
      assert.throws(() => resolveReleaseSource(pkgRoot, '--help'), /invalid commit ref/);
    } finally {
      trashTemp(repo);
    }
  });

  it('allowlist stays closed and rejects traversal, option-like, and outside paths', () => {
    const { repo, pkgRoot, commit } = seededUmbrella('flow-pack-closed-');
    try {
      const source = resolveReleaseSource(pkgRoot);
      const gitPaths = source.allowlist.paths.map((path) => (
        source.layout.packagePrefix ? `${source.layout.packagePrefix}/${path.replace(/\/$/, '')}` : path.replace(/\/$/, '')
      ));
      const expanded = expandAllowlistPaths(repo, commit, source.allowlist.paths.map((path) => (
        source.layout.packagePrefix ? `${source.layout.packagePrefix}/${path}` : path
      )));
      assert.ok(expanded.some((path) => path.endsWith('src/inspr-flow-shell.js')));
      assert.equal(expanded.some((path) => path.includes('test/')), false);
      assert.equal(expanded.some((path) => path.includes('AGENTS.md')), false);
      assert.throws(() => validateArchivePath('-etc/passwd'), /looks like an option/);
      assert.throws(() => validateArchivePath('a\nb'), /control characters/);
      assert.throws(
        () => expandAllowlistPaths(repo, commit, ['../package.json']),
        /traversal rejected/,
      );
      assert.ok(gitPaths.every((path) => !path.includes('..')));
    } finally {
      trashTemp(repo);
    }
  });

  it('packs committed blobs only and excludes dirty and untracked operator residue', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-pack-dirty-');
    const outA = mkdtempSync(join(tmpdir(), 'flow-pack-dirty-a-'));
    const outB = mkdtempSync(join(tmpdir(), 'flow-pack-dirty-b-'));
    try {
      const before = indexTree(repo);
      const first = buildRelease({ repoRoot: pkgRoot, outDir: outA });
      writeFileSync(join(pkgRoot, 'package.json'), '{"name":"mutated","version":"9.9.9","private":true}\n', 'utf8');
      writeFileSync(join(pkgRoot, 'worker-result.txt'), 'operator residue\n', 'utf8');
      writeFileSync(join(pkgRoot, 'src', 'secret-not-for-export.js'), 'export const leak = 1;\n', 'utf8');
      const second = buildRelease({ repoRoot: pkgRoot, outDir: outB });
      assert.equal(first.artifactSha256, second.artifactSha256);
      const paths = listTarballPaths(second.artifactPath);
      assert.equal(paths.some((path) => path.includes('worker-result')), false);
      assert.equal(paths.some((path) => path.includes('secret-not-for-export')), false);
      assert.equal(paths.some((path) => path.includes('AGENTS.md')), false);
      assert.equal(JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version, '9.9.9');
      assertIndexUnchanged(repo, before);
    } finally {
      trashTemp(repo);
      trashTemp(outA);
      trashTemp(outB);
    }
  });

  it('rejects committed symlinks on the allowlist', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-pack-symlink-');
    try {
      symlinkSync('inspr-flow-shell.js', join(pkgRoot, 'src', 'escape-link.js'));
      commitAll(repo, 'tracked symlink');
      assert.throws(() => buildRelease({ repoRoot: pkgRoot }), /allowlisted symlink rejected/);
    } finally {
      trashTemp(repo);
    }
  });

  it('refuses to widen the committed allowlist through build options', () => {
    const { repo, pkgRoot, commit } = seededUmbrella('flow-pack-widen-');
    const outDir = mkdtempSync(join(tmpdir(), 'flow-pack-widen-out-'));
    try {
      const source = resolveReleaseSource(pkgRoot, commit);
      assert.throws(
        () => buildRelease({
          repoRoot: pkgRoot,
          commit,
          allowlist: { ...source.allowlist, paths: [...source.allowlist.paths, 'test/'] },
          outDir,
        }),
        /cannot be widened through build options/,
      );
    } finally {
      trashTemp(repo);
      trashTemp(outDir);
    }
  });

  it('publishes an immutable coordinate pair and refuses a different payload', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-pack-immut-');
    const outDir = mkdtempSync(join(tmpdir(), 'flow-pack-immut-out-'));
    try {
      const built = buildRelease({ repoRoot: pkgRoot, outDir });
      assert.equal(built.manifest.version, VERSION);
      assert.equal(built.manifest.version_scheme, LEGACY_SEMVER_PUBLIC);
      assert.equal(built.manifest.private, true);
      assert.equal(built.manifest.release_channel, 'github-runtime-tgz');
      assert.match(built.manifest.source.commit, /^[0-9a-f]{40}$/);
      assert.equal(built.manifest.source.commit.includes('/'), false);
      verifyReleasePair(built.releaseDir, MANIFEST_NAME);
      const repeat = buildRelease({ repoRoot: pkgRoot, outDir });
      assert.equal(repeat.publication.status, 'identical');
      assert.throws(
        () => publishImmutableReleasePair({
          releaseDir: built.releaseDir,
          artifactName: ARTIFACT_NAME,
          artifactBytes: Buffer.from('different-bytes'),
          manifestName: MANIFEST_NAME,
          manifestText: built.manifestText,
          artifactCoordinate: COORDINATE,
        }),
        /refusing to overwrite non-identical/,
      );
      const symlinkOut = mkdtempSync(join(tmpdir(), 'flow-pack-immut-link-'));
      symlinkSync(built.releaseDir, join(symlinkOut, RELEASE_DIRNAME));
      assert.throws(
        () => buildRelease({ repoRoot: pkgRoot, outDir: symlinkOut }),
        /must not follow symlinks/,
      );
      trashTemp(symlinkOut);
      assert.deepEqual(stagingResidue(outDir), []);
    } finally {
      trashTemp(repo);
      trashTemp(outDir);
    }
  });

  it('installs a clean consumer tarball into two hosts that share one package', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-pack-hosts-');
    const outDir = mkdtempSync(join(tmpdir(), 'flow-pack-hosts-out-'));
    const workspace = mkdtempSync(join(tmpdir(), 'flow-pack-hosts-ws-'));
    try {
      const built = buildRelease({ repoRoot: pkgRoot, outDir });
      const paths = listTarballPaths(built.artifactPath);
      assert.ok(paths.includes('package/src/inspr-flow-shell.js'));
      assert.ok(paths.includes('package/src/assets/inspr-logo.svg'));
      assert.ok(paths.includes('package/src/flow-shell.css'));
      assert.equal(paths.some((path) => path.includes('test/')), false);
      assert.equal(paths.some((path) => path.includes('release/')), false);
      assert.equal(paths.some((path) => path.includes('.git')), false);

      const pkgJson = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
      assert.equal(pkgJson.dependencies, undefined);
      const hosts = ['host-a', 'host-b'].map((name) => {
        const host = join(workspace, name);
        mkdirSync(host);
        writeFileSync(join(host, 'package.json'), `${JSON.stringify({
          name,
          private: true,
          type: 'module',
        }, null, 2)}\n`);
        copyFileSync(join(pkgRoot, 'release/consumer-proof.mjs'), join(host, 'consumer-proof.mjs'));
        const install = spawnSync(
          'npm',
          ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', built.artifactPath],
          { cwd: host, encoding: 'utf8', timeout: 120_000 },
        );
        assert.equal(install.status, 0, install.stderr || install.stdout);
        execFileSync(NODE, [join(host, 'consumer-proof.mjs')], {
          cwd: host,
          stdio: 'pipe',
        });
        return host;
      });

      const fileA = join(hosts[0], 'node_modules/@inspr/flow-shell/src/inspr-flow-shell.js');
      const fileB = join(hosts[1], 'node_modules/@inspr/flow-shell/src/inspr-flow-shell.js');
      assert.equal(sha256(readFileSync(fileA)), sha256(readFileSync(fileB)));
      assert.notEqual(hosts[0], hosts[1]);
      for (const host of hosts) {
        execFileSync(
          NODE,
          [join(sourcePackageRoot, 'release/host-dom-proof.mjs'), join(host, 'node_modules/@inspr/flow-shell')],
          { cwd: sourcePackageRoot, stdio: 'pipe' },
        );
      }
    } finally {
      trashTemp(repo);
      trashTemp(outDir);
      trashTemp(workspace);
    }
  });

  it('retains owned temp residue with a bounded warning when trash is absent from PATH', () => {
    const residue = mkdtempSync(join(tmpdir(), 'flow-pack-no-trash-'));
    const isolatedPath = mkdtempSync(join(tmpdir(), 'flow-pack-no-trash-path-'));
    writeFileSync(join(residue, 'owned.txt'), 'owned\n');
    const warnings = [];
    const result = trashTemp(residue, {
      env: { ...process.env, PATH: isolatedPath },
      warn: (message) => warnings.push(message),
    });
    assert.equal(existsSync(join(residue, 'owned.txt')), true);
    assert.equal(result, residue);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /trash CLI unavailable/);
    assert.equal(warnings[0].includes(residue), true);
    trashTemp(residue);
    trashTemp(isolatedPath);
  });

  it('a packaging test finishes on a PATH that has node npm git tar but no trash', { skip: process.env.FLOW_SHELL_SOURCE_PROOF === '1' }, () => {
    const bin = makeIsolatedPathBin(['node', 'npm', 'git', 'tar', 'sh']);
    const isolatedEnv = {
      ...process.env,
      PATH: bin,
    };
    assertCommandUnavailableOnPath('trash', isolatedEnv);
    const gitExecPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    try {
      const result = spawnSync(
        NODE,
        ['--test', '--test-name-pattern', 'pins the current commit', 'test/packaging.test.js'],
        {
          cwd: sourcePackageRoot,
          encoding: 'utf8',
          timeout: 60_000,
          env: {
            PATH: bin,
            GIT_EXEC_PATH: gitExecPath,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            USER: process.env.USER,
            LANG: process.env.LANG,
            FLOW_SHELL_SOURCE_PROOF: '1',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const combined = `${result.stdout}\n${result.stderr}`;
      assert.match(combined, /pass 1/);
      assert.match(combined, /trash CLI unavailable|retaining owned temp residue/);
    } finally {
      trashTemp(bin);
    }
  });
});
