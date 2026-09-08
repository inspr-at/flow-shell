import test from 'node:test';
import assert from 'node:assert/strict';
import { canEmitStartIntent, getStageGate } from '../src/gates.js';
import { STAGES } from '../src/stages.js';
import { normalizeShellState } from '../src/state.js';
import {
  DIGEST_A,
  FRESH_UNTIL_ISO,
  NOW_ISO,
  NOW_MS,
  OBSERVED_ISO,
  labelledLocalContext,
  labelledAgentContext,
  passGate,
  unknownGate,
} from './helpers.js';

function draftBuildState(overrides = {}) {
  return normalizeShellState({
    evaluatedAt: NOW_ISO,
    delivery: {
      batchRef: 'batch_1',
      baselineRef: 'baseline_7',
      baselineDigest: DIGEST_A,
      status: 'draft',
      activeStage: 0,
      scopeItems: ['Simplify booking'],
      ...overrides.delivery,
    },
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: unknownGate({
        gateKind: 'artifact',
        message: 'Waiting for build artifact.',
      }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        readiness: 'preliminary',
        targetRef: 'target_prod',
        message: 'Preliminary target.',
      }),
      janusGate: unknownGate({
        gateKind: 'access',
        message: 'Access application is not ready.',
      }),
      ...overrides.prerequisites,
    },
    selectedExecutionMode: 'manual',
    selectedAction: 'build',
    identityContext: labelledLocalContext(),
    ...overrides.rest,
  });
}

test('start intent blocked without confirmation', () => {
  const gate = canEmitStartIntent(draftBuildState(), {
    confirmed: false,
    executionMode: 'manual',
    action: 'build',
    now: NOW_MS,
  });
  assert.equal(gate.allowed, false);
  assert.match(gate.reasons.join(' '), /Explicit confirmation/);
});

test('build start allowed without artifact evidence', () => {
  const gate = canEmitStartIntent(draftBuildState(), {
    confirmed: true,
    executionMode: 'assisted',
    action: 'build',
    now: NOW_MS,
  });
  assert.equal(gate.allowed, true);
});

test('build stage stays gated until explicit start', () => {
  const gate = getStageGate(1, draftBuildState(), { now: NOW_MS });
  assert.equal(gate.gated, true);
  assert.equal(gate.explorable, true);
  assert.match(gate.reason, /explicitly start/i);
});

test('stage 2 unknown artifact and target stay gated', () => {
  const state = draftBuildState({
    delivery: { status: 'in_progress', activeStage: 2, batchRef: 'batch_1', baselineRef: 'baseline_7', baselineDigest: DIGEST_A },
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: unknownGate({ gateKind: 'artifact' }),
      pharosTarget: unknownGate({ gateKind: 'target_readiness', readiness: 'unknown' }),
      janusGate: unknownGate({ gateKind: 'access' }),
    },
  });
  const gate = getStageGate(2, state, { now: NOW_MS });
  assert.equal(gate.gated, true);
  assert.equal(gate.explorable, true);
  assert.deepEqual(gate.allowedActions, []);
  assert.match(gate.reason, /artifact|Pharos|target/i);
});

test('deploy start requires pass artifact and ready Pharos target', () => {
  const missing = canEmitStartIntent(draftBuildState(), {
    confirmed: true,
    executionMode: 'manual',
    action: 'deploy',
    now: NOW_MS,
  });
  assert.equal(missing.allowed, false);
  assert.match(missing.reasons.join(' '), /artifact/i);

  const ready = draftBuildState({
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: passGate({
        gateKind: 'artifact',
        evidenceRef: 'artifact_web',
        message: 'Preview artifact recorded.',
      }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        readiness: 'ready',
        targetRef: 'target_prod',
      }),
      janusGate: unknownGate({ gateKind: 'access' }),
    },
  });
  const deploy = canEmitStartIntent(ready, {
    confirmed: true,
    executionMode: 'manual',
    action: 'deploy',
    now: NOW_MS,
  });
  assert.equal(deploy.allowed, true);
});

test('janus prepare allowed on a preliminary Pharos target, not apply', () => {
  const preliminary = draftBuildState();
  const prepare = canEmitStartIntent(preliminary, {
    confirmed: true,
    executionMode: 'manual',
    action: 'janus_prepare',
    now: NOW_MS,
  });
  assert.equal(prepare.allowed, true);

  const apply = canEmitStartIntent(preliminary, {
    confirmed: true,
    executionMode: 'manual',
    action: 'janus_apply',
    now: NOW_MS,
  });
  assert.equal(apply.allowed, false);
  assert.match(apply.reasons.join(' '), /ready or live/i);

  const stage = getStageGate(3, preliminary, { now: NOW_MS });
  assert.equal(stage.explorable, true);
  assert.deepEqual(stage.allowedActions, ['janus_prepare']);
  assert.match(stage.reason, /preparation only|Access application/i);
});

test('janus apply requires ready or live Pharos target and access evidence', () => {
  const live = draftBuildState({
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: passGate({ gateKind: 'artifact', evidenceRef: 'artifact_web' }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        readiness: 'live',
        targetRef: 'target_prod',
      }),
      janusGate: passGate({
        gateKind: 'access',
        evidenceRef: 'evidence_access',
        targetRef: 'target_prod',
        message: 'Access evidence confirmed.',
      }),
    },
  });
  const apply = canEmitStartIntent(live, {
    confirmed: true,
    executionMode: 'manual',
    action: 'janus_apply',
    now: NOW_MS,
  });
  assert.equal(apply.allowed, true);
  const prepare = canEmitStartIntent(live, {
    confirmed: true,
    executionMode: 'manual',
    action: 'janus_prepare',
    now: NOW_MS,
  });
  assert.equal(prepare.allowed, true);
  const stage = getStageGate(3, live, { now: NOW_MS });
  assert.ok(stage.allowedActions.includes('janus_prepare'));
  assert.ok(stage.allowedActions.includes('janus_apply'));
});

test('stale or unvalidated required evidence never permits start', () => {
  const staleReq = draftBuildState({
    prerequisites: {
      requirementsBaseline: passGate({ freshUntil: '2026-09-07T11:59:00Z' }),
      deployArtifact: unknownGate({ gateKind: 'artifact' }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        readiness: 'preliminary',
        targetRef: 'target_prod',
      }),
      janusGate: unknownGate({ gateKind: 'access' }),
    },
  });
  const stale = canEmitStartIntent(staleReq, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    now: NOW_MS,
  });
  assert.equal(stale.allowed, false);
  assert.match(stale.reasons.join(' '), /stale/i);

  const unvalidated = draftBuildState({
    prerequisites: {
      requirementsBaseline: { status: 'pass', message: 'claimed pass without evidence' },
      deployArtifact: unknownGate({ gateKind: 'artifact' }),
      pharosTarget: unknownGate({ gateKind: 'target_readiness' }),
      janusGate: unknownGate({ gateKind: 'access' }),
    },
  });
  const missing = canEmitStartIntent(unvalidated, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    now: NOW_MS,
  });
  assert.equal(missing.allowed, false);
  assert.match(missing.reasons.join(' '), /missing|unvalidated|evidence/i);
});

test('verify start uses the same artifact and ready-target gates as deploy', () => {
  const ready = draftBuildState({
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: passGate({
        gateKind: 'artifact',
        evidenceRef: 'artifact_web',
        message: 'Preview artifact recorded.',
      }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        readiness: 'ready',
        targetRef: 'target_prod',
      }),
      janusGate: unknownGate({ gateKind: 'access' }),
    },
  });
  const verify = canEmitStartIntent(ready, {
    confirmed: true,
    executionMode: 'manual',
    action: 'verify',
    now: NOW_MS,
  });
  assert.equal(verify.allowed, true);
  const inProgress = draftBuildState({
    delivery: { status: 'in_progress', activeStage: 2, batchRef: 'batch_1', baselineRef: 'baseline_7', baselineDigest: DIGEST_A },
    prerequisites: ready.prerequisites,
  });
  const stage = getStageGate(2, inProgress, { now: NOW_MS });
  assert.deepEqual(stage.allowedActions, ['deploy', 'verify']);
});

test('janus stage states the target failure instead of an unrelated access error', () => {
  const unknownTarget = draftBuildState({
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: unknownGate({ gateKind: 'artifact' }),
      pharosTarget: unknownGate({
        gateKind: 'target_readiness',
        readiness: 'unknown',
        message: 'development target target_dev_ready cannot satisfy a Pharos deployment gate.',
      }),
      janusGate: unknownGate({ gateKind: 'access', message: 'access gate not reported.' }),
    },
  });
  const stage = getStageGate(3, unknownTarget, { now: NOW_MS });
  assert.deepEqual(stage.allowedActions, []);
  assert.match(stage.reason, /development target|Pharos target/i);
  assert.doesNotMatch(stage.reason, /access gate not reported/i);

  const readyWithoutAccess = draftBuildState({
    delivery: { status: 'draft', activeStage: 3 },
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: passGate({ gateKind: 'artifact', evidenceRef: 'artifact_web' }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        readiness: 'ready',
        targetRef: 'target_prod',
      }),
      janusGate: unknownGate({ gateKind: 'access', message: 'access gate not reported.' }),
    },
  });
  const readyStage = getStageGate(3, readyWithoutAccess, { now: NOW_MS });
  assert.deepEqual(readyStage.allowedActions, ['janus_prepare']);
  assert.match(readyStage.reason, /access/i);
});

test('stage labels keep product ownership distinct', () => {
  assert.equal(STAGES[0].product, 'Aithema');
  assert.equal(STAGES[0].label, 'Define');
  assert.equal(STAGES[1].product, 'Paimos');
  assert.equal(STAGES[1].label, 'Build');
  assert.equal(STAGES[2].product, 'Pharos');
  assert.equal(STAGES[2].label, 'Deliver');
  assert.equal(STAGES[3].product, 'Janus');
  assert.equal(STAGES[3].label, 'Access');
  assert.notEqual(STAGES[2].label, 'Try');
  assert.notEqual(STAGES[3].label, 'Launch');
});

test('unauthenticated identity still explores stages but cannot start', () => {
  const state = draftBuildState({ rest: { identityContext: null } });
  assert.equal(state.identity.status, 'absent');
  const explore = getStageGate(1, state, { now: NOW_MS });
  assert.equal(explore.explorable, true);
  const start = canEmitStartIntent(state, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    now: NOW_MS,
  });
  assert.equal(start.allowed, false);
  assert.match(start.reasons.join(' '), /identity context is required/i);
});

test('agent identity cannot start when a human principal is required', () => {
  const start = canEmitStartIntent(draftBuildState({ rest: { identityContext: labelledAgentContext() } }), {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    now: NOW_MS,
  });
  assert.equal(start.allowed, false);
  assert.match(start.reasons.join(' '), /human/i);
});
