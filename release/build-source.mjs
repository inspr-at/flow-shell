#!/usr/bin/env node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from './lib/digest.mjs';
import {
  canonicalJson,
  collectRuntimeFilesFromGit,
  collectSourceFilesFromGit,
  lockDigestFromFiles,
  opaqueTreeDigest,
} from './lib/files.mjs';
import {
  assertCommitRef,
  commitEpochSeconds,
  readAllowlistFromCommit,
  readBlob,
  resolveCommit,
} from './lib/git.mjs';
import { resolveLayout, toGitPath } from './lib/layout.mjs';
import { resolveDeclaredReleaseMetadata } from './lib/manifest.mjs';
import {
  SOURCE_PROVENANCE_PATH,
  buildSourceProvenanceText,
  inheritPrivateSourceCommit,
} from './lib/provenance.mjs';
import {
  assertSourceManifestBinding,
  buildSourceManifest,
  canonicalSourceManifestText,
  publishImmutableSourcePair,
  stableSourceArtifactFilename,
  stableSourceManifestFilename,
  stableSourceReleaseDirname,
} from './lib/source-manifest.mjs';
import { assertCanonicalReleaseToolchain, createDeterministicSourceTarball, stageSourceTree } from './lib/tarball.mjs';
import { treeDigestFromTree } from './lib/tree.mjs';

const defaultPackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * @param {object} pkg
 * @param {object} inventory
 */
function declaredMetadata(pkg, inventory) {
  const declared = resolveDeclaredReleaseMetadata(pkg, inventory);
  if (pkg.private !== true || declared.npmPrivate !== true) {
    throw new Error('source package must retain private:true; this candidate does not claim an npm namespace');
  }
  if (pkg.license !== 'AGPL-3.0-only') {
    throw new Error('source package license must remain AGPL-3.0-only');
  }
  return declared;
}

/**
 * @param {string} packageRoot
 * @param {string} [commitRef]
 */
export function resolveSourceExport(packageRoot, commitRef) {
  assertCommitRef(commitRef);
  const layout = resolveLayout(packageRoot);
  if (layout.fromTree) {
    throw new Error('source export requires a Git commit; initialize a public repository from the extracted tree first');
  }
  const commit = resolveCommit(layout.gitRoot, commitRef ?? 'HEAD');
  const allowlist = readAllowlistFromCommit(
    layout.gitRoot,
    commit,
    toGitPath(layout.packagePrefix, 'release/source-allowlist.json'),
  );
  collectSourceFilesFromGit({
    gitRoot: layout.gitRoot,
    commit,
    packagePrefix: layout.packagePrefix,
    allowlist,
  });
  return { commit, allowlist, fromTree: false, layout };
}

/**
 * @param {object} [options]
 */
export function buildSourceExport({
  repoRoot = defaultPackageRoot,
  commit,
  allowlist,
  outDir = join(repoRoot, 'dist'),
} = {}) {
  assertCanonicalReleaseToolchain();
  const layout = resolveLayout(repoRoot);
  if (layout.fromTree) {
    throw new Error('source export requires a Git commit; initialize a public repository from the extracted tree first');
  }
  const resolvedCommit = resolveCommit(layout.gitRoot, commit ?? 'HEAD');
  const resolvedAllowlist = readAllowlistFromCommit(
    layout.gitRoot,
    resolvedCommit,
    toGitPath(layout.packagePrefix, 'release/source-allowlist.json'),
  );
  if (allowlist !== undefined && canonicalJson(allowlist) !== canonicalJson(resolvedAllowlist)) {
    throw new Error(
      `caller allowlist does not match the source allowlist committed at ${resolvedCommit}; `
      + 'the export source cannot be widened through build options',
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
  const declared = declaredMetadata(pkg, inventory);
  const version = declared.version;
  const artifactName = stableSourceArtifactFilename(version);
  const manifestName = stableSourceManifestFilename(version);
  const releaseDir = join(outDir, stableSourceReleaseDirname(version));
  const artifactCoordinate = `source:@inspr/flow-shell@${version}.tgz`;

  const files = collectSourceFilesFromGit({
    gitRoot: layout.gitRoot,
    commit: resolvedCommit,
    packagePrefix: layout.packagePrefix,
    allowlist: resolvedAllowlist,
  });
  const runtimeAllowlist = readAllowlistFromCommit(
    layout.gitRoot,
    resolvedCommit,
    toGitPath(layout.packagePrefix, 'release/allowlist.json'),
  );
  const runtimeFiles = collectRuntimeFilesFromGit({
    gitRoot: layout.gitRoot,
    commit: resolvedCommit,
    packagePrefix: layout.packagePrefix,
    allowlist: runtimeAllowlist,
  });
  const existingProvenance = files.get(SOURCE_PROVENANCE_PATH);
  const lineage = inheritPrivateSourceCommit(existingProvenance ?? null, resolvedCommit);
  const runtimeTreeDigest = opaqueTreeDigest(runtimeFiles);
  const lockDigest = lockDigestFromFiles(files);
  const mtimeEpoch = commitEpochSeconds(layout.gitRoot, resolvedCommit);
  files.set(
    SOURCE_PROVENANCE_PATH,
    Buffer.from(buildSourceProvenanceText({
      privateSourceCommit: lineage.privateSourceCommit,
      currentSourceCommit: lineage.currentSourceCommit,
      exportMtimeEpoch: mtimeEpoch,
      runtimeTreeDigest,
      lockDigest,
    }), 'utf8'),
  );
  const exportPaths = [...files.keys()].sort((a, b) => a.localeCompare(b));

  const stageRoot = mkdtempSync(join(tmpdir(), 'flow-shell-source-stage-'));
  const sourceRoot = stageSourceTree(stageRoot, files);
  const sourceTreeDigest = treeDigestFromTree(sourceRoot, exportPaths);
  const probePath = join(stageRoot, 'probe-source.tgz');
  createDeterministicSourceTarball(sourceRoot, probePath, mtimeEpoch);
  const artifactBytes = readFileSync(probePath);
  const artifactSha256 = sha256(artifactBytes);

  const manifest = buildSourceManifest({
    privateSourceCommit: lineage.privateSourceCommit,
    currentSourceCommit: lineage.currentSourceCommit,
    treeDigest: sourceTreeDigest,
    lockDigest,
    version,
    versionScheme: declared.versionScheme,
    releaseChannel: declared.sourceChannel,
    artifactCoordinate,
    artifactPath: artifactName,
    artifactSha256,
    pathCount: exportPaths.length,
    npmPrivate: declared.npmPrivate,
  });
  assertSourceManifestBinding(manifest);
  const manifestText = canonicalSourceManifestText(manifest);
  const publication = publishImmutableSourcePair({
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
    paths: exportPaths,
    commit: lineage.currentSourceCommit,
    publication,
    runtimePaths: [...runtimeFiles.keys()].sort((a, b) => a.localeCompare(b)),
    runtimeTreeDigest,
  };
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
    process.stdout.write('Usage: node release/build-source.mjs [--commit <ref>] [--out-dir <path>]\n');
    process.exit(0);
  }
  const source = resolveSourceExport(defaultPackageRoot, args.commit);
  const result = buildSourceExport({
    repoRoot: defaultPackageRoot,
    commit: source.commit,
    allowlist: source.allowlist,
    outDir: args.outDir ?? join(defaultPackageRoot, 'dist'),
  });
  process.stdout.write(`${JSON.stringify({
    private_source_commit: result.manifest.source.private_source_commit,
    current_source_commit: result.manifest.source.current_source_commit,
    release_dir: result.releaseDir,
    publication: result.publication.status,
    artifact: result.manifest.artifacts[0],
    tree_digest: result.manifest.source.tree_digest,
    lock_digest: result.manifest.source.lock_digest,
    path_count: result.manifest.source.path_count,
  }, null, 2)}\n`);
}
