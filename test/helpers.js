import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { identityInvalidDir, identityValidDir } from './fixture-paths.js';

export const DIGEST_A = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const DIGEST_B = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const NOW_ISO = '2026-09-07T12:00:00Z';
export const NOW_MS = Date.parse(NOW_ISO);
export const OBSERVED_ISO = '2026-09-07T11:55:00Z';
export const FRESH_UNTIL_ISO = '2026-09-07T12:10:00Z';
export const JAN_ISO = '2026-01-15T09:00:00Z';
export const JAN_MS = Date.parse(JAN_ISO);

const IDENTITY_FIXTURE_DIR = identityValidDir();
const IDENTITY_INVALID_DIR = identityInvalidDir();

export function loadIdentityFixture(name) {
  return JSON.parse(readFileSync(join(IDENTITY_FIXTURE_DIR, name), 'utf8'));
}

function applyJsonPointer(document, pointer, op, value) {
  const parts = pointer
    .replace(/^\//, '')
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let target = document;
  for (const part of parts.slice(0, -1)) {
    target = Array.isArray(target) ? target[Number(part)] : target[part];
  }
  const leaf = parts.at(-1);
  if (op === 'remove') {
    if (Array.isArray(target)) target.splice(Number(leaf), 1);
    else delete target[leaf];
    return;
  }
  if (Array.isArray(target)) target[Number(leaf)] = value;
  else target[leaf] = value;
}

export function loadInvalidIdentityPatches() {
  return readdirSync(IDENTITY_INVALID_DIR)
    .filter((name) => name.endsWith('.patch.json'))
    .sort()
    .map((name) => {
      const fixture = JSON.parse(readFileSync(join(IDENTITY_INVALID_DIR, name), 'utf8'));
      const document = JSON.parse(readFileSync(join(IDENTITY_INVALID_DIR, fixture.base), 'utf8'));
      for (const operation of fixture.operations) {
        applyJsonPointer(document, operation.path, operation.op, operation.value);
      }
      return { name, document, expectedCodes: fixture.expected_codes };
    });
}

export function labelledLocalContext(overrides = {}) {
  const fixture = loadIdentityFixture('labelled-local-host.json');
  const display = { ...fixture.display, ...(overrides.display ?? {}) };
  return { ...fixture, ...overrides, display };
}

export function labelledAgentContext(overrides = {}) {
  const fixture = loadIdentityFixture('labelled-local-agent.json');
  const display = { ...fixture.display, ...(overrides.display ?? {}) };
  return { ...fixture, ...overrides, display };
}

export function labelledOidcContext(overrides = {}) {
  const fixture = loadIdentityFixture('labelled-oidc-backed.json');
  const display = { ...fixture.display, ...(overrides.display ?? {}) };
  const issuer = { ...fixture.issuer_descriptor, ...(overrides.issuer_descriptor ?? {}) };
  return { ...fixture, ...overrides, display, issuer_descriptor: issuer };
}

export function identityContextAt(nowIso, overrides = {}) {
  const now = Date.parse(nowIso);
  return labelledLocalContext({
    evaluated_at: nowIso,
    issued_at: new Date(now - 5 * 60 * 1000).toISOString(),
    expires_at: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
    fresh_until: new Date(now + 15 * 60 * 1000).toISOString(),
    ...overrides,
  });
}

export function passGate(overrides = {}) {
  return {
    status: 'pass',
    message: 'Evidence confirmed.',
    evidenceRef: 'evidence_req',
    observedAt: OBSERVED_ISO,
    freshUntil: FRESH_UNTIL_ISO,
    gateKind: 'requirements_baseline',
    targetRef: null,
    ...overrides,
  };
}

export function unknownGate(overrides = {}) {
  return {
    status: 'unknown',
    message: 'Evidence not reported.',
    evidenceRef: null,
    observedAt: null,
    freshUntil: null,
    gateKind: overrides.gateKind ?? 'unknown',
    targetRef: null,
    ...overrides,
  };
}

export function typedForecast(overrides = {}) {
  return {
    percent_complete: 40,
    estimated_finish: '2026-09-07T12:40:00Z',
    kind: 'educated_guess',
    as_of: NOW_ISO,
    basis: { kind: 'work_breakdown', evidence_ref: 'evidence_forecast' },
    conditional_on: null,
    previous_target: null,
    ...overrides,
  };
}

export function rawProgress(overrides = {}) {
  return {
    status: 'in_progress',
    percent_complete: null,
    eta: null,
    basis: { kind: 'unknown', evidence_ref: null },
    reporter: { kind: 'system', reporter_ref: 'reporter_shell' },
    reported_at: NOW_ISO,
    fresh_until: FRESH_UNTIL_ISO,
    freshness: 'fresh',
    ...overrides,
  };
}

export function snapshot(progressOverrides = {}, forecastOverrides = {}) {
  return {
    progress: rawProgress(progressOverrides),
    forecast: typedForecast(forecastOverrides),
  };
}
