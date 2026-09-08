import { execFileSync, spawnSync } from 'node:child_process';
import {
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

import { buildRelease } from '../release/build-release.mjs';
import { buildSourceExport, resolveSourceExport } from '../release/build-source.mjs';
import { LEGACY_SEMVER_PUBLIC } from '../release/lib/manifest.mjs';
import { parseSourceProvenance } from '../release/lib/provenance.mjs';
import { stableSourceArtifactFilename, stableSourceManifestFilename, verifySourceReleasePair } from '../release/lib/source-manifest.mjs';
import { resolveCommit } from '../release/lib/git.mjs';
import {
  commitAll,
  createTempRepo,
  git,
  packageRootIn,
  seedUmbrellaPackageTree,
  trashTemp,
} from './packaging-support.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const SOURCE_ARTIFACT = stableSourceArtifactFilename(VERSION);
const SOURCE_MANIFEST = stableSourceManifestFilename(VERSION);

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
  commitAll(repo, 'seed flow-shell source');
  return { repo, pkgRoot: packageRootIn(repo), commit: resolveCommit(repo) };
}

describe('INSPR-380 source export', () => {
  it('exports a closed source tree with curated fixtures and no private umbrella files', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-src-closed-');
    const outDir = mkdtempSync(join(tmpdir(), 'flow-src-closed-out-'));
    try {
      const exported = buildSourceExport({ repoRoot: pkgRoot, outDir });
      const paths = listTarballPaths(exported.artifactPath);
      assert.ok(paths.includes('package.json') || paths.includes('./package.json') || paths.some((path) => path.endsWith('package.json')));
      assert.equal(paths.some((path) => path.includes('test/helpers.js') || path.endsWith('test/helpers.js')), true);
      assert.equal(paths.some((path) => path.includes('release/build-release.mjs')), true);
      assert.equal(paths.some((path) => path.includes('fixtures/contracts/flow-identity/valid/labelled-local-host.json')), true);
      assert.equal(paths.some((path) => path.includes('fixtures/contracts/delivery/valid/canonical-stream.json')), true);
      assert.equal(paths.some((path) => path.includes('AGENTS.md')), false);
      assert.equal(paths.some((path) => path.includes('CLAUDE.md')), false);
      assert.equal(paths.some((path) => path.includes('doctrine/')), false);
      assert.equal(paths.some((path) => path.includes('.git/')), false);
      assert.equal(paths.some((path) => /README\.md$/.test(path) && path.includes('VISION')), false);
      assert.equal(exported.manifest.version, VERSION);
      assert.equal(exported.manifest.version_scheme, LEGACY_SEMVER_PUBLIC);
      assert.equal(exported.manifest.private, true);
      assert.equal(exported.manifest.release_channel, 'candidate-source');
      assert.match(exported.manifest.source.private_source_commit, /^[0-9a-f]{40}$/);
      assert.match(exported.manifest.source.current_source_commit, /^[0-9a-f]{40}$/);
      assert.equal(exported.manifest.source.private_source_commit.includes('/'), false);
      assert.match(exported.manifest.source.normalization_note, /not identical/i);
      verifySourceReleasePair(exported.releaseDir, SOURCE_MANIFEST);
    } finally {
      trashTemp(repo);
      trashTemp(outDir);
    }
  });

  it('refuses allowlist widening, committed symlinks, and a changed existing coordinate', () => {
    const { repo, pkgRoot, commit } = seededUmbrella('flow-src-neg-');
    const outDir = mkdtempSync(join(tmpdir(), 'flow-src-neg-out-'));
    try {
      const source = resolveSourceExport(pkgRoot, commit);
      assert.throws(
        () => buildSourceExport({
          repoRoot: pkgRoot,
          commit,
          allowlist: { ...source.allowlist, paths: [...source.allowlist.paths, 'AGENTS.md'] },
          outDir,
        }),
        /cannot be widened through build options/,
      );
      const first = buildSourceExport({ repoRoot: pkgRoot, outDir });
      writeFileSync(join(first.releaseDir, SOURCE_ARTIFACT), 'tampered');
      assert.throws(
        () => buildSourceExport({ repoRoot: pkgRoot, outDir }),
        /digest mismatch|refusing to overwrite|mismatched/,
      );
    } finally {
      trashTemp(repo);
      trashTemp(outDir);
    }
  });

  it('rejects a committed symlink under an allowlisted directory', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-src-link-');
    try {
      symlinkSync('helpers.js', join(pkgRoot, 'test', 'escape-link.js'));
      commitAll(repo, 'tracked symlink');
      assert.throws(() => buildSourceExport({ repoRoot: pkgRoot }), /allowlisted symlink rejected/);
    } finally {
      trashTemp(repo);
    }
  });

  it('extracted non-Git source installs, tests, and refuses a tampered tree-mode rebuild', () => {
    if (process.env.FLOW_SHELL_SOURCE_PROOF === '1') return;
    const { repo, pkgRoot, commit } = seededUmbrella('flow-src-extract-');
    const buildDir = mkdtempSync(join(tmpdir(), 'flow-src-extract-build-'));
    const extractDir = mkdtempSync(join(tmpdir(), 'flow-src-extract-tree-'));
    const gitOut = mkdtempSync(join(tmpdir(), 'flow-src-extract-git-out-'));
    const treeOut = mkdtempSync(join(tmpdir(), 'flow-src-extract-tree-out-'));
    const tamperOut = mkdtempSync(join(tmpdir(), 'flow-src-extract-tamper-out-'));
    try {
      const exported = buildSourceExport({ repoRoot: pkgRoot, commit, outDir: buildDir });
      extractTarball(exported.artifactPath, extractDir);
      assert.equal(existsSync(join(extractDir, '.git')), false);
      assert.equal(existsSync(join(extractDir, 'release/source-provenance.json')), true);
      assert.equal(existsSync(join(extractDir, 'AGENTS.md')), false);
      const provenance = parseSourceProvenance(readFileSync(join(extractDir, 'release/source-provenance.json'), 'utf8'));
      assert.equal(provenance.current_source_commit, commit);
      assert.equal(provenance.private_source_commit, commit);

      const install = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: extractDir,
        encoding: 'utf8',
        timeout: 300_000,
      });
      assert.equal(install.status, 0, install.stderr || install.stdout);

      const tests = spawnSync('npm', ['test'], {
        cwd: extractDir,
        encoding: 'utf8',
        timeout: 300_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          USER: process.env.USER,
          LANG: process.env.LANG,
          FLOW_SHELL_SOURCE_PROOF: '1',
        },
      });
      assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
      assert.match(`${tests.stdout}\n${tests.stderr}`, /fail 0/);

      const gitRelease = buildRelease({ repoRoot: pkgRoot, commit, outDir: gitOut });
      const treeRelease = buildRelease({ repoRoot: extractDir, outDir: treeOut });
      assert.equal(treeRelease.manifest.source.commit, gitRelease.manifest.source.commit);
      assert.equal(treeRelease.manifest.source.tree_digest, gitRelease.manifest.source.tree_digest);
      assert.equal(treeRelease.artifactSha256, gitRelease.artifactSha256);

      writeFileSync(
        join(extractDir, 'src/state.js'),
        `${readFileSync(join(extractDir, 'src/state.js'), 'utf8')}\n`,
        'utf8',
      );
      assert.throws(
        () => buildRelease({ repoRoot: extractDir, outDir: tamperOut }),
        /tree-mode provenance mismatch/,
      );
    } finally {
      trashTemp(repo);
      trashTemp(buildDir);
      trashTemp(extractDir);
      trashTemp(gitOut);
      trashTemp(treeOut);
      trashTemp(tamperOut);
    }
  });

  it('preserves opaque private lineage across a later public git init', () => {
    const { repo, pkgRoot, commit } = seededUmbrella('flow-src-lineage-');
    const firstOut = mkdtempSync(join(tmpdir(), 'flow-src-lineage-first-'));
    const extractDir = mkdtempSync(join(tmpdir(), 'flow-src-lineage-extract-'));
    const publicOut = mkdtempSync(join(tmpdir(), 'flow-src-lineage-public-'));
    try {
      const first = buildSourceExport({ repoRoot: pkgRoot, outDir: firstOut });
      extractTarball(first.artifactPath, extractDir);
      git(extractDir, ['init']);
      git(extractDir, ['config', 'user.email', 'public-fixture@example.invalid']);
      git(extractDir, ['config', 'user.name', 'Public Fixture']);
      commitAll(extractDir, 'public initial history');
      const publicCommit = resolveCommit(extractDir);
      assert.notEqual(publicCommit, first.manifest.source.current_source_commit);
      const publicExport = buildSourceExport({ repoRoot: extractDir, outDir: publicOut });
      assert.equal(publicExport.manifest.source.private_source_commit, first.manifest.source.private_source_commit);
      assert.equal(publicExport.manifest.source.current_source_commit, publicCommit);
    } finally {
      trashTemp(repo);
      trashTemp(firstOut);
      trashTemp(extractDir);
      trashTemp(publicOut);
    }
  });
});
