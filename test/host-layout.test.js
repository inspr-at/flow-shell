import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeShellState } from '../src/state.js';
import {
  applyBoundedGeometry,
  applyFooterSpace,
  clearBoundedGeometry,
  resolveLayoutMode,
} from '../src/host-layout.js';
import { installDomHarness, loadFlowShell, mountShell } from './dom-harness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/flow-shell.css'), 'utf8');

installDomHarness();

test('host layout keeps viewport-fixed footer without transform containment', () => {
  assert.doesNotMatch(css, /transform:\s*translateZ\(0\)/);
  assert.doesNotMatch(css, /contain:\s*layout/);
  assert.match(css, /\.shell-footer\.shell-chrome-fixed/);
  assert.match(css, /bottom:\s*0/);
  assert.match(css, /:host\(\[layout-mode='bounded'\]\)/);
});

test('compact layout uses shell-root container queries, not :host self-query', () => {
  assert.match(css, /\.shell-root\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(css, /@container shell \(max-width: 760px\)/);
  assert.match(css, /@container shell \(max-width: 420px\)/);
  assert.doesNotMatch(css, /@container shell[\s\S]*:host\s*\{/);
  assert.doesNotMatch(css, /\.shell-label-context\s*\{[^}]*display:\s*none/);
});

test('bounded geometry helpers set horizontal viewport-fixed bounds', () => {
  const host = document.createElement('div');
  applyBoundedGeometry(host, { left: 48.4, width: 341.6 });
  assert.equal(host.style.getPropertyValue('--shell-fixed-left'), '48px');
  assert.equal(host.style.getPropertyValue('--shell-fixed-width'), '342px');
  clearBoundedGeometry(host);
  assert.equal(host.style.getPropertyValue('--shell-fixed-left'), '');
});

test('footer space helper rounds measured height up', () => {
  const host = document.createElement('div');
  applyFooterSpace(host, 231.2);
  assert.equal(host.style.getPropertyValue('--shell-footer-space'), '232px');
});

test('layout mode resolves bounded opt-in only', () => {
  assert.equal(resolveLayoutMode(null), 'viewport');
  assert.equal(resolveLayoutMode('bounded'), 'bounded');
  assert.equal(resolveLayoutMode('viewport'), 'viewport');
});

test('header project and context labels expose full values for truncation', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(
    InsprFlowShell,
    normalizeShellState({
      header: {
        projectName: 'Northstar booking experience refresh',
        projectSubtitle: 'Mobile-first delivery batch',
        instanceLabel: 'Paimos dev',
        version: 'shell-0.1.2',
      },
    }),
  );
  const project = shell.shadowRoot.querySelector('[data-action="project"]');
  assert.equal(
    project.getAttribute('title'),
    'Northstar booking experience refresh Mobile-first delivery batch',
  );
  const instance = shell.shadowRoot.querySelector('.shell-label-context[title="Paimos dev"]');
  const version = shell.shadowRoot.querySelector('.shell-label-context[title="shell-0.1.2"]');
  assert.ok(instance);
  assert.ok(version);
});

test('bounded layout mode syncs horizontal geometry custom properties', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell);
  shell.style.width = '342px';
  shell.style.marginLeft = '48px';
  shell.setAttribute('layout-mode', 'bounded');
  shell.getBoundingClientRect = () => ({
    left: 48,
    top: 0,
    width: 342,
    height: 2306,
    right: 390,
    bottom: 2306,
    x: 48,
    y: 0,
    toJSON() {
      return {};
    },
  });
  shell.setAttribute('layout-mode', 'bounded');
  assert.equal(shell.style.getPropertyValue('--shell-fixed-left'), '48px');
  assert.equal(shell.style.getPropertyValue('--shell-fixed-width'), '342px');
});

test('sidebar host example includes bounded mode and tall scroll content', () => {
  const html = readFileSync(join(root, 'examples/host-sidebar/index.html'), 'utf8');
  assert.match(html, /layout-mode="bounded"/);
  assert.match(html, /class="sidebar"/);
  assert.match(html, /id="tall-scroll-fixture"/);
  assert.match(html, /min-height:\s*2000px/);
  assert.match(html, /id="sidebar-toggle"/);
});

test('narrow column shell keeps footer and account controls in the DOM', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(
    InsprFlowShell,
    normalizeShellState({
      header: {
        appName: 'INSPR',
        projectName: 'Very long project title that should truncate in a narrow column',
        userInitials: 'MK',
      },
    }),
  );
  shell.setAttribute('layout-mode', 'bounded');
  const footer = shell.shadowRoot.querySelector('.shell-footer.shell-chrome-fixed');
  const account = shell.shadowRoot.querySelector('[data-action="account"]');
  const review = shell.shadowRoot.querySelector('[data-action="review-batch"]');
  assert.ok(footer);
  assert.ok(account);
  assert.ok(review);
  assert.equal(account.getAttribute('aria-label'), 'Account and authority');
});
