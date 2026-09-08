#!/usr/bin/env node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from './lib/digest.mjs';
import {
  canonicalJson,
  collectRuntimeFilesFromGit,
  collectRuntimeFilesFromTree,
  lockDigestFromFiles,
  opaqueTreeDigest,
} from './lib/files.mjs';
import { assertCommitRef, commitEpochSeconds, readAllowlistFromCommit, readBlob, resolveCommit } from './lib/git.mjs';
import { resolveLayout, toGitPath } from './lib/layout.mjs';
import {
  assertManifestBinding,
  buildManifest,
  canonicalManifestText,
  publishImmutableReleasePair,
  resolveDeclaredReleaseMetadata,
  stableArtifactFilename,
  stableManifestFilename,
  stableReleaseDirname,
} from './lib/manifest.mjs';
import { SOURCE_PROVENANCE_PATH, assertRuntimeProvenanceBinding, parseSourceProvenance } from './lib/provenance.mjs';
import { assertCanonicalReleaseToolchain, createDeterministicTarball, stagePackageTree } from './lib/tarball.mjs';

const defaultPackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * @param {object} pkg
 * @param {object} inventory
 */
function declaredMetadata(pkg, inventory) {
  const declared = resolveDeclaredReleaseMetadata(pkg, inventory);
  if (pkg.private !== true || declared.npmPrivate !== true) {
    throw new Error('runtime package must retain private:true; this candidate does not claim an npm namespace');
  }
  if (pkg.license !== 'AGPL-3.0-only') {
    throw new Error('runtime package license must remain AGPL-3.0-only');
  }
  return declared;
}

/**
 * @param {string} packageRoot
 * @param {string} [commitRef]
 */
export function resolveReleaseSource(packageRoot, commitRef) {
  assertCommitRef(commitRef);
  const layout = resolveLayout(packageRoot);
  if (layout.fromTree) {
    const allowlist = JSON.parse(readFileSync(join(packageRoot, 'release/allowlist.json'), 'utf8'));
    collectRuntimeFilesFromTree({ packageRoot, allowlist });
    const provenance = parseSourceProvenance(readFileSync(join(packageRoot, SOURCE_PROVENANCE_PATH), 'utf8'));
    return { commit: provenance.current_source_commit, allowlist, fromTree: true, layout };
  }
  const commit = resolveCommit(layout.gitRoot, commitRef ?? 'HEAD');
  const allowlist = readAllowlistFromCommit(
    layout.gitRoot,
    commit,
    toGitPath(layout.packagePrefix, 'release/allowlist.json'),
  );
  collectRuntimeFilesFromGit({
    gitRoot: layout.gitRoot,
    commit,
    packagePrefix: layout.packagePrefix,
    allowlist,
  });
  return { commit, allowlist, fromTree: false, layout };
}

function publishRuntime({
  files,
  commit,
  treeDigest,
  lockDigest,
  mtimeEpoch,
  pkg,
  inventory,
  outDir,
}) {
  const declared = declaredMetadata(pkg, inventory);
  const version = declared.version;
  const artifactName = stableArtifactFilename(version);
  const manifestName = stableManifestFilename(version);
  const releaseDir = join(outDir, stableReleaseDirname(version));
  const artifactCoordinate = `npm:@inspr/flow-shell@${version}.tgz`;

  const stageRoot = mkdtempSync(join(tmpdir(), 'flow-shell-release-stage-'));
  const packageRoot = stagePackageTree(stageRoot, files);
  const probePath = join(stageRoot, 'probe.tgz');
  createDeterministicTarball(packageRoot, probePath, mtimeEpoch);
  const artifactBytes = readFileSync(probePath);
  const artifactSha256 = sha256(artifactBytes);

  const manifest = buildManifest({
    commit,
    treeDigest,
    lockDigest,
    version,
    versionScheme: declared.versionScheme,
    releaseChannel: declared.runtimeChannel,
    artifactCoordinate,
    artifactPath: artifactName,
    artifactSha256,
    npmPrivate: declared.npmPrivate,
  });
  assertManifestBinding(manifest);
  const manifestText = canonicalManifestText(manifest);
  const publication = publishImmutableReleasePair({
    releaseDir,
    artifactName,
    artifactBytes,
    manifestName,
    manifestText,
    artifactCoordinate,
  });
  return {
    releaseDir,
    artifactPath: join(releaseDir, artifactName),
    manifestPath: join(releaseDir, manifestName),
    manifest,
    manifestText,
    artifactSha256,
    artifactBytes,
    paths: [...files.keys()].sort((a, b) => a.localeCompare(b)),
    commit,
    publication,
  };
}

function buildReleaseFromTree({ packageRoot, allowlist, outDir, provenance }) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const inventory = JSON.parse(readFileSync(join(packageRoot, 'release/publication-inventory.json'), 'utf8'));
  const files = collectRuntimeFilesFromTree({ packageRoot, allowlist });
  const lockDigest = lockDigestFromFiles(files);
  const sourceTreeDigest = opaqueTreeDigest(files);
  assertRuntimeProvenanceBinding(provenance, { treeDigest: sourceTreeDigest, lockDigest });
  return publishRuntime({
    files,
    commit: provenance.current_source_commit,
    treeDigest: sourceTreeDigest,
    lockDigest,
    mtimeEpoch: provenance.export_mtime_epoch,
    pkg,
    inventory,
    outDir,
  });
}

/**
 * @param {object} [options]
 */
export function buildRelease({
  repoRoot = defaultPackageRoot,
  commit,
  allowlist,
  outDir = join(repoRoot, 'dist'),
} = {}) {
  assertCanonicalReleaseToolchain();
  const layout = resolveLayout(repoRoot);
  if (layout.fromTree) {
    const resolvedAllowlist = JSON.parse(readFileSync(join(repoRoot, 'release/allowlist.json'), 'utf8'));
    if (allowlist !== undefined && canonicalJson(allowlist) !== canonicalJson(resolvedAllowlist)) {
      throw new Error('caller allowlist does not match release/allowlist.json on disk');
    }
    const provenance = parseSourceProvenance(readFileSync(join(repoRoot, SOURCE_PROVENANCE_PATH), 'utf8'));
    if (commit !== undefined && commit !== provenance.current_source_commit) {
      throw new Error(
        'caller commit does not match current_source_commit in provenance; '
        + 'runtime source.commit binds the exported Git commit, not private lineage',
      );
    }
    return buildReleaseFromTree({
      packageRoot: repoRoot,
      allowlist: resolvedAllowlist,
      outDir,
      provenance,
    });
  }

  const resolvedCommit = resolveCommit(layout.gitRoot, commit ?? 'HEAD');
  const resolvedAllowlist = readAllowlistFromCommit(
    layout.gitRoot,
    resolvedCommit,
    toGitPath(layout.packagePrefix, 'release/allowlist.json'),
  );
  if (allowlist !== undefined && canonicalJson(allowlist) !== canonicalJson(resolvedAllowlist)) {
    throw new Error(
      `caller allowlist does not match the allowlist committed at ${resolvedCommit}; `
      + 'the release source cannot be widened through build options',
    );
  }
  const pkg = JSON.parse(
    readBlob(layout.gitRoot, resolvedCommit, toGitPath(layout.packagePrefix, 'package.json')).toString('utf8'),
  );
  const inventory = JSON.parse(
    readBlob(
      layout.gitRoot,
      resolvedCommit,
      toGitPath(layout.packagePrefix, 'release/publication-inventory.json'),
    ).toString('utf8'),
  );
  const files = collectRuntimeFilesFromGit({
    gitRoot: layout.gitRoot,
    commit: resolvedCommit,
    packagePrefix: layout.packagePrefix,
    allowlist: resolvedAllowlist,
  });
  const lockDigest = lockDigestFromFiles(files);
  const sourceTreeDigest = opaqueTreeDigest(files);
  return publishRuntime({
    files,
    commit: resolvedCommit,
    treeDigest: sourceTreeDigest,
    lockDigest,
    mtimeEpoch: commitEpochSeconds(layout.gitRoot, resolvedCommit),
    pkg,
    inventory,
    outDir,
  });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--commit') options.commit = argv[++index];
    else if (arg === '--out-dir') options.outDir = resolve(argv[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node release/build-release.mjs [--commit <ref>] [--out-dir <path>]\n');
    process.exit(0);
  }
  const source = resolveReleaseSource(defaultPackageRoot, args.commit);
  const result = buildRelease({
    repoRoot: defaultPackageRoot,
    commit: source.commit,
    allowlist: source.allowlist,
    outDir: args.outDir ?? join(defaultPackageRoot, 'dist'),
  });
  process.stdout.write(`${JSON.stringify({
    commit: result.commit,
    release_dir: result.releaseDir,
    publication: result.publication.status,
    artifact: result.manifest.artifacts[0],
    tree_digest: result.manifest.source.tree_digest,
    lock_digest: result.manifest.source.lock_digest,
  }, null, 2)}\n`);
}
