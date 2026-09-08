#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCommit } from './lib/git.mjs';
import { resolveLayout } from './lib/layout.mjs';
import {
  resolveDeclaredReleaseMetadata,
  stableArtifactFilename,
  stableManifestFilename,
  verifyReleasePair,
} from './lib/manifest.mjs';
import {
  stableSourceArtifactFilename,
  stableSourceManifestFilename,
  verifySourceReleasePair,
} from './lib/source-manifest.mjs';
import { assertCanonicalReleaseToolchain } from './lib/tarball.mjs';

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * @param {string} version
 * @returns {string}
 */
export function assertStrictSemVer(version) {
  if (typeof version !== 'string' || !STRICT_SEMVER.test(version)) {
    throw new Error(`invalid strict SemVer coordinate: ${JSON.stringify(version)}`);
  }
  return version;
}

/**
 * @param {string} ref
 * @returns {string}
 */
export function assertAdmissibleReleaseRef(ref) {
  if (ref === 'refs/heads/main') return ref;
  if (typeof ref === 'string' && /^refs\/tags\/v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(ref)) {
    return ref;
  }
  throw new Error(`release admission is limited to main or version tags, got ${JSON.stringify(ref)}`);
}

/**
 * A version tag must be exactly `{version}` or `v{version}`. A syntactically
 * valid tag for a different coordinate is refused before any forge I/O.
 * @param {string} [ref]
 * @param {string} version
 * @returns {string | null} tag name, or null for main / absent ref
 */
export function assertReleaseRefMatchesVersion(ref, version) {
  const coordinate = assertStrictSemVer(version);
  if (!ref) return null;
  assertAdmissibleReleaseRef(ref);
  if (ref === 'refs/heads/main') return null;
  const tag = ref.slice('refs/tags/'.length);
  if (tag !== coordinate && tag !== `v${coordinate}`) {
    throw new Error(
      `release tag ${JSON.stringify(tag)} does not match coordinate ${coordinate}; `
      + `expected refs/tags/${coordinate} or refs/tags/v${coordinate}`,
    );
  }
  return tag;
}

/**
 * Resolve the Git commit that public admission must bind to. Uses the actual
 * checked-out repository state; caller-supplied SHAs are never trusted.
 *
 * @param {object} input
 * @param {string} input.repoRoot
 * @param {string} [input.ref]
 * @returns {{ commit: string, gitRoot: string, tag: string | null }}
 */
export function resolveAdmissionSourceCommit({ repoRoot, ref }) {
  const layout = resolveLayout(repoRoot);
  if (layout.fromTree) {
    throw new Error('public GitHub admission requires an actual Git checkout, not an extracted tree');
  }
  const headCommit = resolveCommit(layout.gitRoot, 'HEAD');
  if (ref && ref.startsWith('refs/tags/')) {
    const tag = assertReleaseRefMatchesVersion(ref, readPackageVersion(repoRoot));
    const tagCommit = resolveCommit(layout.gitRoot, tag);
    if (tagCommit !== headCommit) {
      throw new Error(
        `checked-out commit ${headCommit} does not match tag ${tag} target ${tagCommit}; `
        + 'release admission requires the workflow checkout to be exactly the tagged commit',
      );
    }
    return { commit: tagCommit, gitRoot: layout.gitRoot, tag };
  }
  return { commit: headCommit, gitRoot: layout.gitRoot, tag: null };
}

/**
 * @param {string} repoRoot
 * @returns {string}
 */
function readPackageVersion(repoRoot) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  if (typeof pkg.version !== 'string' || !pkg.version) {
    throw new Error('package.json is the authoritative version source');
  }
  return pkg.version;
}

/**
 * Cross-check admitted runtime/source manifests against the selected coordinate,
 * declared channels, package coordinate, and the actual exported Git commit.
 *
 * @param {object} input
 */
export function assertAdmissionBinding({
  coordinate,
  expectedCommit,
  runtimeManifest,
  sourceManifest,
  inventory,
  pkg,
}) {
  const declared = resolveDeclaredReleaseMetadata(pkg, inventory);
  if (declared.version !== coordinate) {
    throw new Error(`declared inventory version ${declared.version} does not match coordinate ${coordinate}`);
  }
  if (pkg.version !== coordinate) {
    throw new Error(`package.json version ${pkg.version} does not match coordinate ${coordinate}`);
  }
  if (runtimeManifest.version !== coordinate || sourceManifest.version !== coordinate) {
    throw new Error('runtime and source manifests must bind the same admitted coordinate');
  }
  if (runtimeManifest.version_scheme !== declared.versionScheme
    || sourceManifest.version_scheme !== declared.versionScheme) {
    throw new Error('admitted manifests must use the declared legacy-semver discriminator');
  }
  if (runtimeManifest.release_channel !== declared.runtimeChannel) {
    throw new Error(
      `runtime manifest release_channel ${runtimeManifest.release_channel} `
      + `does not match inventory ${declared.runtimeChannel}`,
    );
  }
  if (sourceManifest.release_channel !== declared.sourceChannel) {
    throw new Error(
      `source manifest release_channel ${sourceManifest.release_channel} `
      + `does not match inventory ${declared.sourceChannel}`,
    );
  }
  if (runtimeManifest.private !== true || sourceManifest.private !== true || pkg.private !== true) {
    throw new Error('admitted coordinate must retain private:true; this release does not claim an npm namespace');
  }
  if (runtimeManifest.source.commit !== expectedCommit) {
    throw new Error(
      `runtime manifest source.commit ${runtimeManifest.source.commit} `
      + `does not match the actual admitted Git commit ${expectedCommit}`,
    );
  }
  if (sourceManifest.source.current_source_commit !== expectedCommit) {
    throw new Error(
      `source manifest current_source_commit ${sourceManifest.source.current_source_commit} `
      + `does not match the actual admitted Git commit ${expectedCommit}`,
    );
  }
  if (runtimeManifest.source.commit !== sourceManifest.source.current_source_commit) {
    throw new Error('runtime and source manifests must bind the same current_source_commit');
  }

  const [runtimeArtifact] = runtimeManifest.artifacts;
  const [sourceArtifact] = sourceManifest.artifacts;
  const runtimeCoordinate = `npm:@inspr/flow-shell@${coordinate}.tgz`;
  const sourceCoordinate = `source:@inspr/flow-shell@${coordinate}.tgz`;
  if (runtimeArtifact.coordinate !== runtimeCoordinate) {
    throw new Error(`runtime artifact coordinate must be ${runtimeCoordinate}`);
  }
  if (sourceArtifact.coordinate !== sourceCoordinate) {
    throw new Error(`source artifact coordinate must be ${sourceCoordinate}`);
  }
  if (runtimeArtifact.path !== stableArtifactFilename(coordinate)) {
    throw new Error(`runtime artifact path must be ${stableArtifactFilename(coordinate)}`);
  }
  if (sourceArtifact.path !== stableSourceArtifactFilename(coordinate)) {
    throw new Error(`source artifact path must be ${stableSourceArtifactFilename(coordinate)}`);
  }
}

/**
 * @param {object} [options]
 */
export function admitRelease({
  repoRoot = defaultRepoRoot,
  version = process.env.RELEASE_VERSION,
  ref = process.env.RELEASE_REF,
  distRoot = join(repoRoot, 'dist'),
} = {}) {
  const coordinate = assertStrictSemVer(version);
  if (ref) assertReleaseRefMatchesVersion(ref, coordinate);
  assertCanonicalReleaseToolchain();
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  if (pkg.version !== coordinate) {
    throw new Error(`package.json version ${pkg.version} does not match coordinate ${coordinate}`);
  }
  const inventory = JSON.parse(readFileSync(join(repoRoot, 'release/publication-inventory.json'), 'utf8'));
  const { commit: expectedCommit } = resolveAdmissionSourceCommit({ repoRoot, ref });

  const releaseDir = join(distRoot, `inspr-flow-shell-${coordinate}`);
  const sourceDir = join(distRoot, `inspr-flow-shell-source-${coordinate}`);
  const runtimeManifestName = stableManifestFilename(coordinate);
  const sourceManifestName = stableSourceManifestFilename(coordinate);
  const runtime = verifyReleasePair(releaseDir, runtimeManifestName);
  const source = verifySourceReleasePair(sourceDir, sourceManifestName);
  assertAdmissionBinding({
    coordinate,
    expectedCommit,
    runtimeManifest: runtime.manifest,
    sourceManifest: source.manifest,
    inventory,
    pkg,
  });
  return {
    version: coordinate,
    commit: expectedCommit,
    runtime,
    source,
  };
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const result = admitRelease();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    version: result.version,
    commit: result.commit,
    runtime_sha256: result.runtime.sha256,
    source_sha256: result.source.sha256,
  }, null, 2)}\n`);
}
