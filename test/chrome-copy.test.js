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

test('delivery map toggle references the expanded section id', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  const toggle = shell.shadowRoot.querySelector('[data-action="toggle-map"]');
  const panel = shell.shadowRoot.querySelector('#delivery-expanded');
  assert.ok(toggle);
  assert.ok(panel);
  assert.equal(toggle.getAttribute('aria-controls'), 'delivery-expanded');
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

test('fixed-chrome separation keeps host free of container containment', () => {
  assert.doesNotMatch(css, /:host\s*\{[^}]*container-type:/);
  assert.doesNotMatch(css, /flow-shell-host/);
  assert.match(css, /\.shell-root\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(css, /\.notice\s*\{[^}]*top:\s*var\(--shell-notice-top/);
});

test('resolveNoticeTop tracks measured header bottom with configurable gap', async () => {
  const { resolveNoticeTop, NOTICE_TOP_GAP_PX } = await import('../src/inspr-flow-shell.js');
  assert.equal(resolveNoticeTop(123), 135);
  assert.equal(resolveNoticeTop(56.2), 69);
  assert.equal(resolveNoticeTop(-4), NOTICE_TOP_GAP_PX);
  assert.equal(resolveNoticeTop(100, 0), 100);
});

test('notice geometry sync follows header resize lifecycle', async () => {
  const { resolveNoticeTop } = await import('../src/inspr-flow-shell.js');
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  const header = shell.shadowRoot.querySelector('.shell-header');

  const assertNoticeBelowHeader = () => {
    const headerBottom = header.getBoundingClientRect().bottom;
    const noticeTop = Number.parseFloat(shell.style.getPropertyValue('--shell-notice-top'));
    assert.ok(Number.isFinite(noticeTop));
    assert.equal(noticeTop, resolveNoticeTop(headerBottom));
    assert.ok(noticeTop >= headerBottom - 1);
  };

  assertNoticeBelowHeader();

  header.getBoundingClientRect = () => ({
    bottom: 123,
    top: 0,
    left: 0,
    right: 320,
    width: 272,
    height: 123,
    x: 48,
    y: 0,
    toJSON() {
      return {};
    },
  });
  shell.showNotice('QA: functional status notice');
  assert.equal(Number.parseFloat(shell.style.getPropertyValue('--shell-notice-top')), resolveNoticeTop(123));
  assertNoticeBelowHeader();
});
