import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY_DISCLAIMER,
  IDENTITY_CONTRACT_VERSION,
  identityBinding,
  identityStartIssues,
  isValidatedIdentity,
  normalizeIdentityContext,
} from '../src/identity.js';
import { canEmitStartIntent } from '../src/gates.js';
import { createStartIntent, INTENT_TYPES } from '../src/intents.js';
import {
  confirmationSnapshot,
  normalizeShellState,
  withMapExpanded,
  withSelectedAction,
  withViewedStage,
} from '../src/state.js';
import {
  DIGEST_B,
  NOW_ISO,
  NOW_MS,
  labelledAgentContext,
  labelledLocalContext,
  labelledOidcContext,
  loadIdentityFixture,
  loadInvalidIdentityPatches,
  passGate,
  unknownGate,
} from './helpers.js';

function startableState(overrides = {}) {
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

test('labelled local-host fixture normalizes without requiring OIDC subject', () => {
  const identity = normalizeIdentityContext(loadIdentityFixture('labelled-local-host.json'));
  assert.equal(identity.status, 'present');
  assert.equal(identity.value.principalKind, 'local_host');
  assert.equal(identity.value.issuerRef, null);
  assert.equal(identity.value.organizationRef, null);
  assert.equal(identity.value.actorKind, 'human');
  assert.match(identity.value.display.fixtureLabel, /no live identity/i);
  assert.equal(identity.value.principalRef.startsWith(`${identity.value.hostId}:`), true);
  assert.equal(isValidatedIdentity(identity), true);
});

test('labelled oidc-backed fixture keeps issuer mapping host-scoped and opaque', () => {
  const identity = normalizeIdentityContext(labelledOidcContext());
  assert.equal(identity.status, 'present');
  assert.equal(identity.value.principalKind, 'oidc_backed');
  assert.ok(identity.value.issuerRef.startsWith(`${identity.value.hostId}:`));
  assert.equal(identityBinding(identity).email, undefined);
  assert.equal(identityBinding(identity).subject, undefined);
});

test('tokens, email, raw subject, and unknown secret fields are rejected not stripped', () => {
  for (const payload of [
    { ...labelledLocalContext(), access_token: 'header.payload.signature' },
    { ...labelledLocalContext(), email: 'person@example.test' },
    { ...labelledLocalContext(), subject: 'oidc-sub' },
    { ...labelledLocalContext(), session_secret: 'nope' },
  ]) {
    const identity = normalizeIdentityContext(payload);
    assert.equal(identity.status, 'rejected');
    assert.equal(identity.value, null);
    assert.ok(identity.reasons.length > 0);
  }
});

test('local_host cannot claim an issuer descriptor; oidc_backed requires one', () => {
  const local = normalizeIdentityContext({
    ...labelledLocalContext(),
    issuer_descriptor: { kind: 'verified_issuer_descriptor', issuer_ref: 'host_fixture_a:issuer:x' },
  });
  assert.equal(local.status, 'rejected');
  const oidc = normalizeIdentityContext({ ...labelledOidcContext(), issuer_descriptor: undefined });
  assert.equal(oidc.status, 'rejected');
});

test('wrong host project and invented organization are rejected', () => {
  const wrongHost = normalizeIdentityContext(labelledLocalContext({ project_ref: 'other_host:project:northstar' }));
  assert.equal(wrongHost.status, 'rejected');
  const invented = normalizeIdentityContext(
    labelledLocalContext({ organization_ref: 'host_fixture_a:project:northstar' }),
  );
  assert.equal(invented.status, 'rejected');
  const domain = normalizeIdentityContext(
    labelledOidcContext({ organization_ref: 'host_fixture_b:org:harbor.example.test' }),
  );
  assert.equal(domain.status, 'rejected');
});

test('agent context is valid but cannot start when a human is required', () => {
  const identity = normalizeIdentityContext(labelledAgentContext());
  assert.equal(identity.status, 'present');
  const issues = identityStartIssues(identity, { now: NOW_MS, requireHuman: true });
  assert.match(issues.join(' '), /human/i);
  assert.equal(identityStartIssues(identity, { now: NOW_MS, requireHuman: false }).join(''), '');
});

test('expired, not-yet-valid, and stale identity fail closed', () => {
  const expired = normalizeIdentityContext(labelledLocalContext({ expires_at: '2026-09-07T11:59:00Z' }));
  assert.match(identityStartIssues(expired, { now: NOW_MS }).join(' '), /expired/i);
  const future = normalizeIdentityContext(labelledLocalContext({ issued_at: '2026-09-07T12:05:00Z' }));
  assert.match(identityStartIssues(future, { now: NOW_MS }).join(' '), /not yet valid/i);
  const stale = normalizeIdentityContext(labelledLocalContext({ fresh_until: '2026-09-07T11:59:00Z' }));
  assert.match(identityStartIssues(stale, { now: NOW_MS }).join(' '), /stale/i);
});

test('absent identity is not treated as authenticated because the schema exists', () => {
  const identity = normalizeIdentityContext(null);
  assert.equal(identity.status, 'absent');
  assert.equal(IDENTITY_CONTRACT_VERSION, 'inspr.flow-identity/0.1-draft');
  assert.match(AUTHORITY_DISCLAIMER, /not authentication/i);
  assert.match(identityStartIssues(identity, { now: NOW_MS }).join(' '), /required/i);
});

test('shared invalid identity fixtures are rejected by the runtime normalizer', () => {
  const patches = loadInvalidIdentityPatches();
  assert.equal(patches.length, 12);
  for (const { name, document } of patches) {
    const identity = normalizeIdentityContext(document);
    assert.equal(identity.status, 'rejected', name);
    assert.equal(identity.value, null, name);
  }
});

test('required contract version, disclaimer, and evaluated_at are enforced', () => {
  const { contract_version: _version, ...noVersion } = labelledLocalContext();
  const missingVersion = normalizeIdentityContext(noVersion);
  assert.equal(missingVersion.status, 'rejected');
  assert.equal(missingVersion.value, null);

  const { authority_disclaimer: _disclaimer, ...noDisclaimer } = labelledLocalContext();
  assert.equal(normalizeIdentityContext(noDisclaimer).status, 'rejected');

  const { evaluated_at: _evaluated, ...noEvaluated } = labelledLocalContext();
  assert.equal(normalizeIdentityContext(noEvaluated).status, 'rejected');
});

test('coerced refs, domain-shaped refs, and email labels are rejected', () => {
  assert.equal(
    normalizeIdentityContext(
      labelledLocalContext({ principal_ref: ['host_fixture_a:principal:labelled-demo'] }),
    ).status,
    'rejected',
  );
  assert.equal(
    normalizeIdentityContext(labelledLocalContext({ principal_ref: 'host_fixture_a:person.example.test' })).status,
    'rejected',
  );
  assert.equal(
    normalizeIdentityContext(
      labelledLocalContext({
        display: {
          user_label: 'person@example.test',
          user_initials: 'PE',
          project_label: 'Northstar',
          fixture_label: 'Labelled local-host fixture. No live identity.',
        },
      }),
    ).status,
    'rejected',
  );
});

test('overlong host refs are rejected instead of truncated into valid bindings', () => {
  const longA = `host_fixture_a:binding:${'a'.repeat(200)}AAA`;
  const longB = `host_fixture_a:binding:${'a'.repeat(200)}BBB`;
  assert.equal(normalizeIdentityContext(labelledLocalContext({ binding_ref: longA })).status, 'rejected');
  assert.equal(normalizeIdentityContext(labelledLocalContext({ binding_ref: longB })).status, 'rejected');

  const review = startableState({ identityContext: labelledLocalContext({ binding_ref: longA }) });
  const confirm = startableState({ identityContext: labelledLocalContext({ binding_ref: longB }) });
  const captured = confirmationSnapshot(review, { now: NOW_MS, action: 'build' });
  const intent = createStartIntent(confirm, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: captured,
    now: NOW_MS,
  });
  assert.notEqual(intent.type, INTENT_TYPES.START_INTENT);
  assert.ok(intent.error);
  assert.equal(intent.detail?.identity, undefined);
});

test('forged normalized identity cannot start and null value does not throw', () => {
  const delivery = {
    batchRef: 'batch_1',
    baselineRef: 'baseline_7',
    baselineDigest: DIGEST_B,
    status: 'draft',
    scopeItems: ['Clarify banner'],
  };
  const prerequisites = {
    requirementsBaseline: passGate(),
    deployArtifact: unknownGate({ gateKind: 'artifact' }),
    pharosTarget: passGate({
      gateKind: 'target_readiness',
      evidenceRef: 'evidence_pharos',
      readiness: 'preliminary',
      targetRef: 'target_prod',
    }),
    janusGate: unknownGate({ gateKind: 'access' }),
  };
  const forged = normalizeShellState({
    evaluatedAt: NOW_ISO,
    delivery,
    prerequisites,
    selectedExecutionMode: 'manual',
    selectedAction: 'build',
    identity: {
      status: 'present',
      value: {
        hostId: 'evil host',
        principalKind: 'local_host',
        principalRef: 'not-scoped@example.com',
        bindingRef: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        projectRef: 'other_host:project:not-yours',
        actorKind: 'human',
        issuedAt: NOW_ISO,
        expiresAt: '2026-09-07T20:00:00Z',
        freshUntil: '2026-09-07T12:10:00Z',
        contextRevision: 'evil:ctxrev:1',
        access_token: 'nope',
      },
    },
  });
  assert.equal(forged.identity.status, 'rejected');
  assert.equal(isValidatedIdentity(forged.identity), true);
  const start = canEmitStartIntent(forged, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    now: NOW_MS,
  });
  assert.equal(start.allowed, false);
  const intent = createStartIntent(forged, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    capturedSnapshot: confirmationSnapshot(forged, { now: NOW_MS, action: 'build' }),
    now: NOW_MS,
  });
  assert.notEqual(intent.type, INTENT_TYPES.START_INTENT);

  const nullValue = normalizeShellState({
    evaluatedAt: NOW_ISO,
    delivery,
    prerequisites,
    selectedExecutionMode: 'manual',
    selectedAction: 'build',
    identity: { status: 'present', value: null },
  });
  assert.equal(nullValue.identity.status, 'rejected');
  assert.doesNotThrow(() =>
    canEmitStartIntent(nullValue, {
      confirmed: true,
      executionMode: 'manual',
      action: 'build',
      now: NOW_MS,
    }),
  );
  assert.equal(
    canEmitStartIntent(nullValue, {
      confirmed: true,
      executionMode: 'manual',
      action: 'build',
      now: NOW_MS,
    }).allowed,
    false,
  );
});

test('internal navigation preserves validated identity', () => {
  const state = startableState();
  const principal = state.identity.value.principalRef;
  const navigated = withViewedStage(withMapExpanded(withSelectedAction(state, 'build'), true), 2);
  assert.equal(navigated.identity.status, 'present');
  assert.equal(navigated.identity.value.principalRef, principal);
  assert.equal(isValidatedIdentity(navigated.identity), true);
  assert.equal(
    canEmitStartIntent(navigated, {
      confirmed: true,
      executionMode: 'manual',
      action: 'build',
      now: NOW_MS,
    }).allowed,
    true,
  );
});
