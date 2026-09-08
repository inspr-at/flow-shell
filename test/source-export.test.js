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
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildRelease } from '../release/build-release.mjs';
import { buildSourceExport, resolveSourceExport } from '../release/build-source.mjs';
import {
  admitRelease,
  assertAdmissibleReleaseRef,
  assertReleaseRefMatchesVersion,
  assertStrictSemVer,
  resolveAdmissionSourceCommit,
} from '../release/admit-release.mjs';
import { LEGACY_SEMVER_PUBLIC } from '../release/lib/manifest.mjs';
import { parseSourceProvenance } from '../release/lib/provenance.mjs';
import {
  expectedForgeAssetNames,
  findUnexpectedForgeAssetNames,
  planForgeAssetRetention,
  retainForgeAssets,
} from '../release/retain-forge-assets.mjs';
import { sha256 } from '../release/lib/digest.mjs';
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

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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
      assert.equal(exported.manifest.release_channel, 'github-source');
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

describe('INSPR-380 public release automation', () => {
  it('publication inventory documents the GitHub release contract', () => {
    const inventory = JSON.parse(readFileSync(join(repoRoot, 'release/publication-inventory.json'), 'utf8'));
    assert.equal(inventory.version_scheme, LEGACY_SEMVER_PUBLIC);
    assert.equal(inventory.release_channels.runtime_package, 'github-runtime-tgz');
    assert.equal(inventory.release_channels.public_source_candidate, 'github-source');
    assert.equal(inventory.public_repository_target, 'inspr-at/flow-shell');
    assert.equal(inventory.package_registry.publish, false);
    assert.equal(inventory.package_registry.namespace_claim, false);
    assert.equal(inventory.ci.auto_publish_on_push, false);
    assert.match(inventory.ci.retained_forge_assets, /retain-forge-assets/);
    assert.match(inventory.ci.canonical_toolchain_enforcement, /FLOW_SHELL_CANONICAL_RELEASE/);
    assert.match(inventory.ci.release_gates, /admit-consumer-proof/);
    assert.match(inventory.handoff.review_extract, /mkdir -p/);
  });

  it('source export includes CI workflows and release admission scripts', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-src-ci-');
    const outDir = mkdtempSync(join(tmpdir(), 'flow-src-ci-out-'));
    try {
      const exported = buildSourceExport({ repoRoot: pkgRoot, outDir });
      const paths = listTarballPaths(exported.artifactPath);
      assert.equal(paths.some((path) => path.endsWith('.github/workflows/ci.yml')), true);
      assert.equal(paths.some((path) => path.endsWith('.github/workflows/release.yml')), true);
      assert.equal(paths.some((path) => path.endsWith('release/admit-release.mjs')), true);
      assert.equal(paths.some((path) => path.endsWith('release/admit-consumer-proof.mjs')), true);
      assert.equal(paths.some((path) => path.endsWith('release/retain-forge-assets.mjs')), true);
    } finally {
      trashTemp(repo);
      trashTemp(outDir);
    }
  });

  it('admission binds manifests to the actual checked-out commit and tag target', () => {
    const { repo, pkgRoot, commit } = seededUmbrella('flow-admit-bind-');
    const distRoot = join(pkgRoot, 'dist');
    try {
      buildRelease({ repoRoot: pkgRoot, outDir: distRoot });
      buildSourceExport({ repoRoot: pkgRoot, outDir: distRoot });
      git(repo, ['tag', `v${VERSION}`]);
      const admitted = admitRelease({
        repoRoot: pkgRoot,
        version: VERSION,
        ref: `refs/tags/v${VERSION}`,
        distRoot,
      });
      assert.equal(admitted.commit, commit);
      assert.equal(admitted.runtime.manifest.source.commit, commit);
      assert.equal(admitted.source.manifest.source.current_source_commit, commit);
      assert.equal(resolveAdmissionSourceCommit({ repoRoot: pkgRoot, ref: `refs/tags/v${VERSION}` }).commit, commit);
    } finally {
      trashTemp(repo);
    }
  });

  it('admission rejects a self-consistent pair from a stale commit after HEAD moves', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-admit-stale-');
    const distRoot = join(pkgRoot, 'dist');
    try {
      buildRelease({ repoRoot: pkgRoot, outDir: distRoot });
      buildSourceExport({ repoRoot: pkgRoot, outDir: distRoot });
      writeFileSync(join(pkgRoot, 'README.md'), `${readFileSync(join(pkgRoot, 'README.md'), 'utf8')}\n`, 'utf8');
      commitAll(repo, 'post-build commit');
      assert.throws(
        () => admitRelease({ repoRoot: pkgRoot, version: VERSION, ref: 'refs/heads/main', distRoot }),
        /does not match the actual admitted Git commit/,
      );
    } finally {
      trashTemp(repo);
    }
  });

  it('admission rejects mixed runtime/source manifests built from separate commits', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-admit-mixed-');
    const runtimeOut = mkdtempSync(join(tmpdir(), 'flow-admit-mixed-runtime-'));
    const sourceOut = mkdtempSync(join(tmpdir(), 'flow-admit-mixed-source-'));
    const distRoot = join(pkgRoot, 'dist');
    try {
      const first = buildRelease({ repoRoot: pkgRoot, outDir: runtimeOut });
      writeFileSync(join(pkgRoot, 'README.md'), `${readFileSync(join(pkgRoot, 'README.md'), 'utf8')}\n`, 'utf8');
      commitAll(repo, 'between runtime and source');
      const second = buildSourceExport({ repoRoot: pkgRoot, outDir: sourceOut });
      assert.notEqual(first.manifest.source.commit, second.manifest.source.current_source_commit);
      mkdirSync(distRoot, { recursive: true });
      execFileSync('cp', ['-R', join(runtimeOut, `inspr-flow-shell-${VERSION}`), distRoot]);
      execFileSync('cp', ['-R', join(sourceOut, `inspr-flow-shell-source-${VERSION}`), distRoot]);
      assert.throws(
        () => admitRelease({ repoRoot: pkgRoot, version: VERSION, ref: 'refs/heads/main', distRoot }),
        /does not match the actual admitted Git commit/,
      );
    } finally {
      trashTemp(repo);
      trashTemp(runtimeOut);
      trashTemp(sourceOut);
    }
  });

  it('admission refuses tag/version mismatch before forge I/O', () => {
    assert.throws(
      () => admitRelease({ repoRoot, version: VERSION, ref: 'refs/tags/v9.9.9' }),
      /does not match coordinate/,
    );
    assert.throws(
      () => admitRelease({ repoRoot, version: 'not-semver' }),
      /invalid strict SemVer/,
    );
    assert.equal(assertAdmissibleReleaseRef('refs/heads/main'), 'refs/heads/main');
    assert.throws(() => assertAdmissibleReleaseRef('refs/heads/feat/x'), /limited to main/);
    assert.equal(assertReleaseRefMatchesVersion(`refs/tags/v${VERSION}`, VERSION), `v${VERSION}`);
  });

  it('forge asset retention plans are idempotent and refuse replacements', () => {
    const localAssets = [
      { name: 'inspr-flow-shell-0.0.0.tgz', sha256: `sha256:${sha256('runtime-tgz')}` },
      { name: 'inspr-flow-shell-0.0.0.manifest.json', sha256: `sha256:${sha256('runtime-manifest')}` },
      { name: 'inspr-flow-shell-source-0.0.0.tgz', sha256: `sha256:${sha256('source-tgz')}` },
      { name: 'inspr-flow-shell-source-0.0.0.manifest.json', sha256: `sha256:${sha256('source-manifest')}` },
    ];
    assert.equal(
      planForgeAssetRetention({ ref: 'refs/heads/main', version: '0.0.0', localAssets }).action,
      'skip',
    );
    assert.equal(
      planForgeAssetRetention({ ref: 'refs/tags/v0.0.0', version: '0.0.0', localAssets }).action,
      'create',
    );
    const conflict = planForgeAssetRetention({
      ref: 'refs/tags/0.0.0',
      version: '0.0.0',
      localAssets,
      existingAssetDigests: {
        ...Object.fromEntries(localAssets.map((asset) => [asset.name, asset.sha256])),
        'inspr-flow-shell-0.0.0.tgz': `sha256:${sha256('other-bytes')}`,
      },
    });
    assert.equal(conflict.action, 'conflict');
    const unexpected = planForgeAssetRetention({
      ref: 'refs/tags/v0.0.0',
      version: '0.0.0',
      localAssets,
      existingRemoteNames: [...localAssets.map((asset) => asset.name), 'unexpected-remote.txt'],
    });
    assert.equal(unexpected.action, 'unexpected-remote');
    assert.deepEqual(unexpected.unexpected, ['unexpected-remote.txt']);
    assert.deepEqual(
      findUnexpectedForgeAssetNames([...expectedForgeAssetNames('0.0.0'), 'extra.tgz'], '0.0.0'),
      ['extra.tgz'],
    );

    const workflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    assert.match(workflow, /retain-forge-assets\.mjs/);
    assert.match(workflow, /admit-consumer-proof\.mjs/);
    assert.match(workflow, /npm test/);
    assert.match(workflow, /FLOW_SHELL_CANONICAL_RELEASE: '1'/);
    assert.match(workflow, /upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
    assert.equal(workflow.includes('--clobber'), false);
    const ciWorkflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    assert.match(ciWorkflow, /node-version: '24'/);
    assert.match(ciWorkflow, /npm test/);
  });

  it('retains admitted forge assets through a synthetic adapter without replacing bytes', () => {
    const { repo, pkgRoot } = seededUmbrella('flow-forge-retain-');
    const distRoot = join(pkgRoot, 'dist');
    try {
      buildRelease({ repoRoot: pkgRoot, outDir: distRoot });
      buildSourceExport({ repoRoot: pkgRoot, outDir: distRoot });
      git(repo, ['tag', `v${VERSION}`]);
      const created = [];
      const uploaded = [];
      const store = new Map();
      const forge = {
        viewRelease() {
          if (!store.size) return null;
          return { names: [...store.keys()] };
        },
        downloadAsset(_tag, name) {
          return store.get(name);
        },
        createRelease({ files }) {
          created.push(files);
          for (const file of files) {
            store.set(file.split('/').pop(), readFileSync(file));
          }
        },
        uploadAssets(_tag, files) {
          uploaded.push(files);
          for (const file of files) {
            store.set(file.split('/').pop(), readFileSync(file));
          }
        },
      };
      const first = retainForgeAssets({
        repoRoot: pkgRoot,
        distRoot,
        version: VERSION,
        ref: `refs/tags/v${VERSION}`,
        forge,
      });
      assert.equal(first.action, 'create');
      assert.equal(created.length, 1);
      const repeat = retainForgeAssets({
        repoRoot: pkgRoot,
        distRoot,
        version: VERSION,
        ref: `refs/tags/v${VERSION}`,
        forge,
      });
      assert.equal(repeat.action, 'identical');
      assert.equal(uploaded.length, 0);
      store.set('unexpected-remote.txt', Buffer.from('stray\n'));
      assert.throws(
        () => retainForgeAssets({
          repoRoot: pkgRoot,
          distRoot,
          version: VERSION,
          ref: `refs/tags/v${VERSION}`,
          forge,
        }),
        /unexpected assets/,
      );
      store.delete('unexpected-remote.txt');
      store.delete(`inspr-flow-shell-${VERSION}.manifest.json`);
      const recovered = retainForgeAssets({
        repoRoot: pkgRoot,
        distRoot,
        version: VERSION,
        ref: `refs/tags/v${VERSION}`,
        forge,
      });
      assert.equal(recovered.action, 'upload-missing');
      assert.deepEqual(recovered.missing, [`inspr-flow-shell-${VERSION}.manifest.json`]);
      assert.equal(uploaded.length, 1);
      store.set(`inspr-flow-shell-${VERSION}.tgz`, Buffer.from('mutated-release-bytes\n'));
      assert.throws(
        () => retainForgeAssets({
          repoRoot: pkgRoot,
          distRoot,
          version: VERSION,
          ref: `refs/tags/v${VERSION}`,
          forge,
        }),
        /refusing to replace non-identical GitHub Release assets/,
      );
    } finally {
      trashTemp(repo);
    }
  });
});
