/**
 * Clean consumer proof for an independently installed @inspr/flow-shell artifact.
 *
 * Copy this file INTO the consumer directory before running it. Specifiers must
 * resolve under that consumer's own node_modules so the proof cannot pass against
 * monorepo source. Host authentication and execution stay outside the package.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONSUMER_SPECIFIERS = [
  '@inspr/flow-shell/package.json',
  '@inspr/flow-shell/state',
  '@inspr/flow-shell/intents',
  '@inspr/flow-shell/identity',
  '@inspr/flow-shell/adapter',
  '@inspr/flow-shell/assets/inspr-logo.svg',
];

function assertResolvedFromConsumerInstall() {
  const installRoot = new URL('node_modules/', import.meta.url).href;
  const resolved = {};
  for (const specifier of CONSUMER_SPECIFIERS) {
    const url = import.meta.resolve(specifier);
    if (!url.startsWith(installRoot)) {
      throw new Error(
        `${specifier} did not resolve from the consumer installation: ${url} (expected under ${installRoot})`,
      );
    }
    resolved[specifier] = url;
  }
  return resolved;
}

async function main() {
  const consumerRoot = dirname(fileURLToPath(import.meta.url));
  const resolved = assertResolvedFromConsumerInstall();
  const pkg = JSON.parse(readFileSync(fileURLToPath(resolved['@inspr/flow-shell/package.json']), 'utf8'));
  assert.equal(pkg.name, '@inspr/flow-shell');
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.equal(pkg.dependencies, undefined);
  const svg = readFileSync(fileURLToPath(resolved['@inspr/flow-shell/assets/inspr-logo.svg']), 'utf8');
  assert.match(svg, /<svg/i);
  const css = readFileSync(
    join(consumerRoot, 'node_modules/@inspr/flow-shell/src/flow-shell.css'),
    'utf8',
  );
  assert.match(css, /\.shell-header/);

  const { normalizeShellState, withIdentityContext } = await import('@inspr/flow-shell/state');
  const { createStartIntent, INTENT_TYPES } = await import('@inspr/flow-shell/intents');
  const { identityStartIssues } = await import('@inspr/flow-shell/identity');

  const now = Date.parse('2026-09-07T12:00:00Z');
  const unauthenticated = normalizeShellState({
    evaluatedAt: '2026-09-07T12:00:00Z',
    selectedAction: 'build',
    selectedExecutionMode: 'manual',
  });
  const missingIdentity = createStartIntent(unauthenticated, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    now,
  });
  assert.notEqual(missingIdentity.type, INTENT_TYPES.START_INTENT);
  assert.ok(missingIdentity.error);
  assert.equal(identityStartIssues(null, { now }).length > 0, true);

  const withContext = withIdentityContext(unauthenticated, {
    contract_version: 'inspr.flow-identity/0.1-draft',
    evaluated_at: '2026-09-07T12:00:00Z',
    host_id: 'host_fixture_a',
    principal_kind: 'local_host',
    principal_ref: 'host_fixture_a:principal:labelled-demo',
    binding_ref: 'host_fixture_a:binding:northstar-1',
    organization_ref: null,
    project_ref: 'host_fixture_a:project:northstar',
    actor_kind: 'human',
    issued_at: '2026-09-07T11:55:00Z',
    expires_at: '2026-09-07T20:00:00Z',
    fresh_until: '2026-09-07T12:10:00Z',
    context_revision: 'host_fixture_a:ctxrev:1',
    authority_disclaimer:
      'Schema validity is not authentication. Host must issue this context from a verified principal and revalidate on every consequential intent.',
    display: {
      user_label: 'Labelled fixture person',
      user_initials: 'LF',
      project_label: 'Northstar',
      fixture_label: 'Labelled local-host fixture. No live identity.',
    },
  });
  const start = createStartIntent(withContext, {
    confirmed: false,
    executionMode: 'manual',
    action: 'build',
    now,
  });
  assert.notEqual(start.type, INTENT_TYPES.START_INTENT);
  assert.ok(start.error);
  process.stdout.write('consumer-proof: ok\n');
}

await main();
