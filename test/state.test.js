import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmationSnapshot,
  normalizeShellState,
  snapshotsMatch,
} from '../src/state.js';
import { DIGEST_A, FRESH_UNTIL_ISO, NOW_ISO, NOW_MS, OBSERVED_ISO, passGate } from './helpers.js';

test('normalizeShellState clamps stages and sanitizes header', () => {
  const state = normalizeShellState({
    header: { projectName: '  Northstar  ', userInitials: 'mb' },
    delivery: { activeStage: 9, viewedStage: -2 },
  });
  assert.equal(state.header.projectName, 'Northstar');
  assert.equal(state.header.userInitials, 'MB');
  assert.equal(state.delivery.activeStage, 3);
  assert.equal(state.delivery.viewedStage, 0);
});

test('normalization keeps gate timestamps, refs, and kinds', () => {
  const state = normalizeShellState({
    evaluatedAt: NOW_ISO,
    selectedAction: 'deploy',
    selectedExecutionMode: 'assisted',
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: passGate({
        gateKind: 'artifact',
        evidenceRef: 'artifact_web',
        targetRef: 'target_prod',
        digest: DIGEST_A,
      }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        readiness: 'ready',
        targetRef: 'target_prod',
      }),
      janusGate: passGate({
        gateKind: 'access',
        evidenceRef: 'evidence_access',
        targetRef: 'target_prod',
      }),
    },
  });
  const req = state.prerequisites.requirementsBaseline;
  assert.equal(req.observedAt, OBSERVED_ISO);
  assert.equal(req.freshUntil, FRESH_UNTIL_ISO);
  assert.equal(req.evidenceRef, 'evidence_req');
  assert.equal(req.gateKind, 'requirements_baseline');
  assert.equal(state.prerequisites.pharosTarget.readiness, 'ready');
  assert.equal(state.prerequisites.pharosTarget.targetRef, 'target_prod');
  assert.equal(state.prerequisites.deployArtifact.digest, DIGEST_A);
  assert.equal(state.selectedAction, 'deploy');
});

test('confirmation snapshot binds scope, action, mode, evidence, and expiry', () => {
  const state = normalizeShellState({
    evaluatedAt: NOW_ISO,
    selectedExecutionMode: 'manual',
    selectedAction: 'build',
    delivery: {
      batchRef: 'batch_1',
      baselineRef: 'baseline_7',
      baselineDigest: DIGEST_A,
      scopeItems: ['Simplify booking'],
    },
    prerequisites: {
      requirementsBaseline: passGate(),
    },
  });
  const snap = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  assert.equal(snap.batchRef, 'batch_1');
  assert.equal(snap.baselineRef, 'baseline_7');
  assert.equal(snap.baselineDigest, DIGEST_A);
  assert.equal(snap.executionMode, 'manual');
  assert.equal(snap.action, 'build');
  assert.deepEqual(snap.scopeItems, ['Simplify booking']);
  assert.equal(snap.evidence.requirementsBaseline.evidenceRef, 'evidence_req');
  assert.equal(snap.evidence.requirementsBaseline.observedAt, OBSERVED_ISO);
  assert.ok(snap.expiresAt);
  assert.equal(Date.parse(snap.expiresAt), NOW_MS + 5 * 60 * 1000);

  const current = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  assert.equal(snapshotsMatch(current, snap), true);
  assert.equal(snapshotsMatch(current, { ...snap, action: 'deploy' }), false);
  assert.equal(snapshotsMatch(current, { ...snap, executionMode: 'assisted' }), false);
  assert.equal(
    snapshotsMatch(current, { ...snap, evaluatedAt: '2026-09-07T12:01:00Z' }),
    false,
  );
});
