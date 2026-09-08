import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartIntent, createSaveProposalIntent, INTENT_TYPES } from '../src/intents.js';
import { normalizeShellState, confirmationSnapshot } from '../src/state.js';
import { JAN_ISO, JAN_MS, NOW_ISO, NOW_MS, DIGEST_B, labelledAgentContext, labelledLocalContext, passGate, unknownGate } from './helpers.js';

function readyBuild(overrides = {}) {
  return normalizeShellState({
    evaluatedAt: NOW_ISO,
    delivery: {
      batchRef: 'batch_1',
      baselineRef: 'baseline_7',
      baselineDigest: DIGEST_B,
      status: 'draft',
      scopeItems: ['Clarify banner'],
    },
    prerequisites: {
      requirementsBaseline: passGate(),
      deployArtifact: unknownGate({ gateKind: 'artifact' }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        readiness: 'preliminary',
        targetRef: 'target_prod',
      }),
      janusGate: unknownGate({ gateKind: 'access' }),
    },
    selectedExecutionMode: 'manual',
    selectedAction: 'build',
    identityContext: labelledLocalContext(),
    ...overrides,
  });
}

test('save proposal never executes', () => {
  const intent = createSaveProposalIntent('  Add calendar reminder  ');
  assert.equal(intent.type, INTENT_TYPES.SAVE_PROPOSAL);
  assert.equal(intent.detail.executes, false);
  assert.equal(intent.detail.proposal, 'Add calendar reminder');
});

test('start intent rejects confirmation after expiry', () => {
  const state = readyBuild();
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  const later = NOW_MS + 6 * 60 * 1000;
  const intent = createStartIntent(state, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: later,
  });
  assert.equal(intent.stale, true);
  assert.match(intent.error, /expir|stale/i);
});

test('January evaluation cannot start in September', () => {
  const state = readyBuild({
    evaluatedAt: JAN_ISO,
    prerequisites: {
      requirementsBaseline: passGate({ observedAt: JAN_ISO, freshUntil: '2026-01-15T09:15:00Z' }),
      deployArtifact: unknownGate({ gateKind: 'artifact' }),
      pharosTarget: passGate({
        gateKind: 'target_readiness',
        evidenceRef: 'evidence_pharos',
        observedAt: JAN_ISO,
        freshUntil: '2026-01-15T09:15:00Z',
        readiness: 'preliminary',
        targetRef: 'target_prod',
      }),
      janusGate: unknownGate({ gateKind: 'access' }),
    },
  });
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  const intent = createStartIntent(state, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.ok(intent.error);
  assert.match(intent.error, /expir|stale|evaluation/i);
  assert.notEqual(intent.type, INTENT_TYPES.START_INTENT);
});

test('start intent rejects scope, mode, and action changes', () => {
  const state = readyBuild();
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });

  const scopeChanged = readyBuild({
    delivery: {
      batchRef: 'batch_1',
      baselineRef: 'baseline_7',
      baselineDigest: DIGEST_B,
      status: 'draft',
      scopeItems: ['Different scope'],
    },
  });
  const scopeIntent = createStartIntent(scopeChanged, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(scopeIntent.stale, true);

  const actionIntent = createStartIntent(state, {
    confirmed: true,
    executionMode: 'manual',
    action: 'deploy',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(actionIntent.stale, true);

  const modeIntent = createStartIntent(state, {
    confirmed: true,
    executionMode: 'assisted',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(modeIntent.stale, true);
});

test('start intent includes authority note and snapshot and never executes', () => {
  const state = readyBuild();
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  const intent = createStartIntent(state, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(intent.type, INTENT_TYPES.START_INTENT);
  assert.equal(intent.detail.executes, false);
  assert.equal(intent.detail.action, 'build');
  assert.equal(intent.detail.snapshot.baselineDigest, state.delivery.baselineDigest);
  assert.equal(intent.detail.snapshot.executionMode, 'manual');
  assert.ok(intent.detail.snapshot.expiresAt);
  assert.match(intent.authorityNote, /revalidate authority/i);
});

test('captured January snapshot used months later is expired', () => {
  const state = readyBuild({ evaluatedAt: JAN_ISO });
  const captured = confirmationSnapshot(state, { now: JAN_MS, action: 'build' });
  const intent = createStartIntent(readyBuild({ evaluatedAt: JAN_ISO }), {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(intent.stale, true);
  assert.match(intent.error, /expir|stale/i);
});

test('start intent carries opaque identity binding for the host to revalidate', () => {
  const state = readyBuild();
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  const intent = createStartIntent(state, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(intent.detail.identity.status, 'present');
  assert.equal(intent.detail.identity.principalRef, state.identity.value.principalRef);
  assert.equal(intent.detail.identity.email, undefined);
  assert.ok(intent.detail.hostMust.includes('revalidate host identity context'));
});

test('principal or context revision change between review and confirm is stale', () => {
  const state = readyBuild();
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  const switched = readyBuild({
    identityContext: labelledLocalContext({ context_revision: 'host_fixture_a:ctxrev:2' }),
  });
  const revisionIntent = createStartIntent(switched, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(revisionIntent.stale, true);

  const agentIntent = createStartIntent(readyBuild({ identityContext: labelledAgentContext() }), {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(agentIntent.stale, true);
});

test('wrong host or project binding cannot keep the captured confirmation', () => {
  const state = readyBuild();
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  const wrongProject = readyBuild({
    identityContext: labelledLocalContext({ project_ref: 'host_fixture_a:project:other' }),
  });
  const intent = createStartIntent(wrongProject, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(intent.stale, true);
});

test('display label changes do not grant and do not by themselves invalidate confirmation', () => {
  const state = readyBuild();
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  const relabelled = readyBuild({
    identityContext: labelledLocalContext({
      display: {
        user_label: 'Forged operator',
        user_initials: 'FO',
        project_label: 'Forged project',
        fixture_label: 'Labelled local-host fixture. No live identity.',
      },
    }),
  });
  const intent = createStartIntent(relabelled, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.equal(intent.type, INTENT_TYPES.START_INTENT);
  assert.notEqual(relabelled.identity.value.display.userLabel, state.identity.value.display.userLabel);
});

test('unauthenticated start is refused without treating missing context as stale confirmation', () => {
  const state = readyBuild({ identityContext: null });
  const captured = confirmationSnapshot(state, { now: NOW_MS, action: 'build' });
  const intent = createStartIntent(state, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.ok(intent.error);
  assert.equal(intent.stale, undefined);
  assert.match(intent.error, /identity context is required/i);
});
