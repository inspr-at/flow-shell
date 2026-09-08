#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { admitRelease } from './admit-release.mjs';

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const NODE = process.execPath;

function extractTarball(archivePath, dest) {
  mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['-xzf', archivePath, '-C', dest], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Install the admitted runtime tarball into an isolated consumer and run the
 * closed consumer proofs. Does not modify canonical dist bytes.
 *
 * @param {object} input
 * @param {string} input.repoRoot admission and consumer package root
 * @param {string} input.runtimeArtifactPath
 * @param {string} [input.scriptRoot] checkout that owns release proof scripts and devDependencies
 */
export function proveRuntimeConsumer({ repoRoot, runtimeArtifactPath, scriptRoot = repoRoot }) {
  const consumerDir = mkdtempSync(join(tmpdir(), 'flow-shell-runtime-consumer-'));
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(join(consumerDir, 'package.json'), `${JSON.stringify({
    name: 'flow-shell-runtime-consumer-proof',
    private: true,
    type: 'module',
  }, null, 2)}\n`);
  copyFileSync(join(scriptRoot, 'release/consumer-proof.mjs'), join(consumerDir, 'consumer-proof.mjs'));
  const install = spawnSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', runtimeArtifactPath],
    { cwd: consumerDir, encoding: 'utf8', timeout: 300_000 },
  );
  if (install.status !== 0) {
    throw new Error(`runtime consumer install failed: ${install.stderr || install.stdout}`);
  }
  execFileSync(NODE, [join(consumerDir, 'consumer-proof.mjs')], {
    cwd: consumerDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync(NODE, [
    join(scriptRoot, 'release/host-dom-proof.mjs'),
    join(consumerDir, 'node_modules/@inspr/flow-shell'),
  ], {
    cwd: scriptRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return consumerDir;
}

/**
 * Extract the admitted source tarball into an isolated tree and run npm ci &&
 * npm test. Does not modify canonical dist bytes.
 *
 * @param {object} input
 * @param {string} input.repoRoot
 * @param {string} input.sourceArtifactPath
 * @param {string} input.expectedCommit
 */
export function proveSourceConsumer({ repoRoot, sourceArtifactPath, expectedCommit }) {
  const extractDir = mkdtempSync(join(tmpdir(), 'flow-shell-source-consumer-'));
  extractTarball(sourceArtifactPath, extractDir);
  if (existsSync(join(extractDir, '.git'))) {
    throw new Error('source consumer proof must use a non-Git extracted tree');
  }
  const provenancePath = join(extractDir, 'release/source-provenance.json');
  if (!existsSync(provenancePath)) {
    throw new Error('extracted source is missing release/source-provenance.json');
  }
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  if (provenance.current_source_commit !== expectedCommit) {
    throw new Error(
      `extracted source provenance current_source_commit ${provenance.current_source_commit} `
      + `does not match admitted commit ${expectedCommit}`,
    );
  }
  const install = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: extractDir,
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (install.status !== 0) {
    throw new Error(`extracted source npm ci failed: ${install.stderr || install.stdout}`);
  }
  const tests = spawnSync('npm', ['test'], {
    cwd: extractDir,
    encoding: 'utf8',
    timeout: 600_000,
    env: {
      ...process.env,
      FLOW_SHELL_SOURCE_PROOF: '1',
    },
  });
  if (tests.status !== 0) {
    throw new Error(`extracted source npm test failed:\n${tests.stdout}\n${tests.stderr}`);
  }
  return extractDir;
}

/**
 * @param {object} [options]
 */
export function admitConsumerProof({
  repoRoot = defaultRepoRoot,
  version = process.env.RELEASE_VERSION,
  ref = process.env.RELEASE_REF,
  distRoot = join(repoRoot, 'dist'),
  scriptRoot = defaultRepoRoot,
} = {}) {
  const admitted = admitRelease({ repoRoot, version, ref, distRoot });
  proveRuntimeConsumer({
    repoRoot,
    runtimeArtifactPath: admitted.runtime.artifactPath,
    scriptRoot,
  });
  proveSourceConsumer({
    repoRoot,
    sourceArtifactPath: admitted.source.artifactPath,
    expectedCommit: admitted.commit,
  });
  return {
    ok: true,
    version: admitted.version,
    commit: admitted.commit,
  };
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const result = admitConsumerProof();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
