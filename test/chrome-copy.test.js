import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeShellState } from '../src/state.js';
import { installDomHarness, loadFlowShell, mountShell, clickAction, teardownMountedNodes } from './dom-harness.js';
import { labelledLocalContext, passGate, unknownGate } from './helpers.js';
import { DIGEST_B, NOW_ISO } from './helpers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/flow-shell.css'), 'utf8');
const shellSource = readFileSync(join(root, 'src/inspr-flow-shell.js'), 'utf8');

installDomHarness();

test.afterEach(() => {
  teardownMountedNodes();
});

function readyBuild() {
  return normalizeShellState({
    evaluatedAt: NOW_ISO,
    delivery: {
      batchRef: 'batch_1',
      baselineRef: 'baseline_7',
      baselineDigest: DIGEST_B,
      batchTitle: 'Make booking effortless',
      status: 'draft',
      scopeItems: ['Clarify banner'],
      draftCount: 2,
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
  });
}

test('primary chrome omits marketing hero copy and blanket boundary labels', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  const chrome = shell.shadowRoot.textContent;

  assert.doesNotMatch(shellSource, /One live product\. A considered next step\./);
  assert.doesNotMatch(shellSource, /YOUR DELIVERY MAP/);
  assert.doesNotMatch(shellSource, /Flow shell · intent boundary/);
  assert.doesNotMatch(shellSource, /one stream/);
  assert.doesNotMatch(shellSource, /ideas waiting outside this delivery/);

  assert.doesNotMatch(chrome, /One live product/);
  assert.doesNotMatch(chrome, /YOUR DELIVERY MAP/);
  assert.doesNotMatch(chrome, /Flow shell · intent boundary/);
  assert.doesNotMatch(chrome, /one stream/);
  assert.doesNotMatch(chrome, /ideas waiting outside this delivery/);

  assert.ok(shell.shadowRoot.querySelector('.map-heading-inline'));
  assert.match(chrome, /2 drafts outside batch/);
});

test('expanded delivery map uses a concise functional heading', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  clickAction(shell, 'toggle-map');

  const heading = shell.shadowRoot.querySelector('.expanded-panel .map-heading');
  assert.ok(heading);
  assert.equal(heading.textContent, 'Delivery map');
  assert.doesNotMatch(shell.shadowRoot.querySelector('.expanded-panel').textContent, /considered next step/i);
});

test('review dialog keeps scope and authority explanation at confirmation', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  clickAction(shell, 'review-batch');

  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  assert.match(dialog.textContent, /host must revalidate authority/i);
  assert.match(dialog.textContent, /not a security or auth backend/i);
  assert.ok(dialog.querySelector('[data-identity-caption]'));
});

test('chrome spacing stays compact in primary shell regions', () => {
  assert.match(css, /\.shell-header\s*\{[^}]*height:\s*56px/);
  assert.match(css, /\.health\s*\{[^}]*padding:\s*12px/);
  assert.doesNotMatch(css, /\.shell-header\s*\{[^}]*height:\s*88px/);
});

test('narrow host width lowers notice below wrapped header', () => {
  assert.match(css, /@container flow-shell-host \(max-width: 760px\)[\s\S]*\.notice\.shell-chrome-fixed[\s\S]*top:\s*96px/);
});
