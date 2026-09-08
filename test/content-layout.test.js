import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeShellState } from '../src/state.js';
import {
  resolveContentLayout,
  CONTENT_LAYOUTS,
  resolveFillFooterHeight,
  resolveFillFooterCapacity,
  resolveFillFooterReservation,
  measureHostLocalTopOffset,
  measureFillContentMinimumFromMetrics,
} from '../src/host-layout.js';
import {
  clickAction,
  installDomHarness,
  loadFlowShell,
  mountShell,
} from './dom-harness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

installDomHarness();

function mountTwoNodeFillHost(InsprFlowShell, { height = 600, width = 390 } = {}) {
  const frame = document.createElement('div');
  frame.style.display = 'flex';
  frame.style.flexDirection = 'column';
  frame.style.height = `${height}px`;
  frame.style.width = `${width}px`;
  frame.style.overflow = 'hidden';
  document.body.appendChild(frame);

  const shell = document.createElement('inspr-flow-shell');
  shell.setAttribute('content-layout', 'fill');
  shell.setAttribute('layout-mode', 'bounded');
  shell.style.flex = '1';
  shell.style.minHeight = '0';
  shell.style.width = '100%';

  const toolbar = document.createElement('header');
  toolbar.setAttribute('data-flow-host-region', 'toolbar');
  toolbar.textContent = 'Toolbar';

  const body = document.createElement('div');
  body.setAttribute('data-flow-host-region', 'body');
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.minHeight = '0';
  body.style.height = '100%';

  const scrollBody = document.createElement('div');
  scrollBody.className = 'host-scroll-body';
  scrollBody.style.flex = '1';
  scrollBody.style.minHeight = '0';
  scrollBody.style.overflow = 'auto';
  const tall = document.createElement('div');
  tall.style.minHeight = '2400px';
  tall.textContent = 'tall';
  scrollBody.appendChild(tall);

  const projectFooter = document.createElement('footer');
  projectFooter.className = 'project-footer';
  projectFooter.id = 'project-footer';
  projectFooter.style.flexShrink = '0';
  const link = document.createElement('a');
  link.href = '#settings';
  link.id = 'link-settings';
  link.textContent = 'Settings';
  projectFooter.appendChild(link);

  body.appendChild(scrollBody);
  body.appendChild(projectFooter);
  shell.appendChild(toolbar);
  shell.appendChild(body);
  frame.appendChild(shell);
  shell.shellState = normalizeShellState({
    header: { appName: 'INSPR', projectName: 'Fill test', userInitials: 'MK' },
  });
  return { frame, shell, scrollBody, projectFooter, link, toolbar, body };
}

test('content layout resolves fill opt-in only', () => {
  assert.deepEqual(CONTENT_LAYOUTS, ['document', 'fill']);
  assert.equal(resolveContentLayout(null), 'document');
  assert.equal(resolveContentLayout('document'), 'document');
  assert.equal(resolveContentLayout('fill'), 'fill');
  assert.equal(resolveContentLayout('viewport'), 'document');
});

test('fill layout shadow tree keeps scaffold between root and chrome', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = new InsprFlowShell();
  shell.setAttribute('content-layout', 'fill');
  document.body.appendChild(shell);
  shell.shellState = normalizeShellState({
    header: { appName: 'INSPR', projectName: 'Structure', userInitials: 'MK' },
  });

  const shellRoot = shell.shadowRoot.querySelector('.shell-root');
  const scaffold = shell.shadowRoot.querySelector('.shell-scaffold');
  const header = shell.shadowRoot.querySelector('.shell-header');
  const shellMain = shell.shadowRoot.querySelector('.shell-main');
  const hostSlot = shell.shadowRoot.querySelector('.host-slot');
  const footer = shell.shadowRoot.querySelector('.shell-footer');

  assert.ok(shellRoot?.contains(scaffold));
  assert.ok(scaffold?.contains(header));
  assert.ok(scaffold?.contains(shellMain));
  assert.ok(shellMain?.contains(hostSlot));
  assert.ok(footer);
  assert.equal(shellRoot?.contains(footer), false);
});

test('fill layout accepts two direct slotted nodes with host region markers', async () => {
  const InsprFlowShell = await loadFlowShell();
  const { frame, shell, toolbar, body, projectFooter, link } = mountTwoNodeFillHost(InsprFlowShell);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  assert.equal(shell.matches('[content-layout="fill"]'), true);
  assert.equal(toolbar.getAttribute('data-flow-host-region'), 'toolbar');
  assert.equal(body.getAttribute('data-flow-host-region'), 'body');
  assert.equal(body.contains(projectFooter), true);
  assert.equal(link.getAttribute('href'), '#settings');

  frame.remove();
});

test('document layout keeps default host contract without fill attribute', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, normalizeShellState({
    header: { appName: 'INSPR', projectName: 'Document', userInitials: 'MK' },
  }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  assert.equal(shell.matches('[content-layout="fill"]'), false);
  assert.equal(resolveContentLayout(shell.getAttribute('content-layout')), 'document');
});

test('removing content-layout attribute restores document host contract', async () => {
  const InsprFlowShell = await loadFlowShell();
  const { frame, shell } = mountTwoNodeFillHost(InsprFlowShell);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  shell.removeAttribute('content-layout');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  assert.equal(shell.getAttribute('content-layout'), null);
  assert.equal(resolveContentLayout(shell.getAttribute('content-layout')), 'document');
  assert.equal(shell.matches('[content-layout="fill"]'), false);
  assert.equal(shell.style.getPropertyValue('--shell-footer-max-height'), '');

  frame.remove();
});

test('content-layout is an observed attribute', async () => {
  const InsprFlowShell = await loadFlowShell();
  assert.ok(InsprFlowShell.observedAttributes.includes('content-layout'));
});

async function waitForLayout() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function establishCappedFillFooter(shell, metrics) {
  if (!shell.shellState.mapExpanded) {
    clickAction(shell, 'toggle-map');
  }
  mockFillHostMetrics(shell, metrics);
  shell.removeAttribute('content-layout');
  shell.setAttribute('content-layout', 'fill');
  await waitForLayout();
}

test('fill layout restores capped footer reservation at 320x568 without layout-mode toggle', async () => {
  const InsprFlowShell = await loadFlowShell();
  const { frame, shell } = mountTwoNodeFillHost(InsprFlowShell, { height: 568, width: 320 });
  await establishCappedFillFooter(shell, { hostHeight: 568, expandedFooter: 639 });

  const cappedMax = Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10);
  const cappedSpace = Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10);
  assert.equal(cappedMax, 189);
  assert.equal(cappedSpace, 189);

  shell.removeAttribute('content-layout');
  await waitForLayout();
  assert.equal(shell.style.getPropertyValue('--shell-footer-max-height'), '');
  assert.ok(Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10) > cappedSpace);

  shell.setAttribute('content-layout', 'fill');
  await waitForLayout();
  assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10), 189);
  assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10), 189);

  frame.remove();
});

test('fill layout restores capped footer reservation at 390x844 without layout-mode toggle', async () => {
  const InsprFlowShell = await loadFlowShell();
  const { frame, shell } = mountTwoNodeFillHost(InsprFlowShell, { height: 844, width: 390 });
  await establishCappedFillFooter(shell, {
    hostHeight: 844,
    chromeAboveSlot: 123,
    expandedFooter: 639,
    collapsedFooter: 328,
  });

  const cappedMax = Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10);
  const cappedSpace = Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10);
  assert.equal(cappedMax, 516);
  assert.equal(cappedSpace, 516);

  shell.removeAttribute('content-layout');
  await waitForLayout();
  assert.equal(shell.style.getPropertyValue('--shell-footer-max-height'), '');
  assert.ok(Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10) > cappedSpace);

  shell.setAttribute('content-layout', 'fill');
  await waitForLayout();
  assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10), 516);
  assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10), 516);

  frame.remove();
});

test('fill layout keeps footer cap after layout-mode leaves bounded', async () => {
  const InsprFlowShell = await loadFlowShell();
  const { frame, shell } = mountTwoNodeFillHost(InsprFlowShell, { height: 568, width: 320 });
  await establishCappedFillFooter(shell, { hostHeight: 568, expandedFooter: 639 });
  assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10), 189);

  shell.removeAttribute('layout-mode');
  await waitForLayout();
  assert.equal(shell.matches('[content-layout="fill"]'), true);
  assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10), 189);
  assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10), 189);

  frame.remove();
});

test('fill layout applies footer cap when content-layout is set without ResizeObserver', async () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = undefined;
  try {
    const InsprFlowShell = await loadFlowShell();
    const { frame, shell } = mountTwoNodeFillHost(InsprFlowShell, { height: 568, width: 320 });
    shell.removeAttribute('content-layout');
    await waitForLayout();
    clickAction(shell, 'toggle-map');
    mockFillHostMetrics(shell, { hostHeight: 568, expandedFooter: 639 });
    shell.setAttribute('content-layout', 'fill');
    await waitForLayout();
    assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10), 189);
    assert.equal(Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10), 189);
    frame.remove();
  } finally {
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

test('fill layout separates footer capacity from reservation', () => {
  assert.equal(resolveFillFooterCapacity(844, 379), 465);
  assert.equal(resolveFillFooterReservation(246, 465), 246);
  assert.equal(resolveFillFooterReservation(639, 465), 465);
  assert.equal(resolveFillFooterHeight(844, 639, 341), 503);
  assert.equal(resolveFillFooterHeight(844, 246, 341), 246);
});

test('fill layout measures chrome above slot in host-local coordinates', () => {
  assert.equal(measureHostLocalTopOffset({ top: 0 }, { top: 174 }), 174);
  assert.equal(measureHostLocalTopOffset({ top: 51 }, { top: 174 }), 123);
  assert.equal(
    measureFillContentMinimumFromMetrics({
      chromeAboveSlot: 174,
      slottedFixedHeight: 157,
      scrollReserve: 48,
    }),
    379,
  );
  assert.equal(resolveFillFooterCapacity(844, 379), 465);
});

function mockFillHostMetrics(shell, {
  hostHeight = 844,
  hostTop = 0,
  chromeAboveSlot = 174,
  toolbarHeight = 66,
  projectFooterHeight = 91,
  collapsedFooter = 246,
  expandedFooter = 520,
} = {}) {
  const footer = shell.shadowRoot.querySelector('.shell-footer');
  const hostSlot = shell.shadowRoot.querySelector('.host-slot');
  const toolbar = shell.querySelector('[data-flow-host-region="toolbar"]');
  const projectFooter = shell.querySelector('#project-footer');
  assert.ok(footer);
  assert.ok(hostSlot);

  shell.getBoundingClientRect = () => ({
    height: hostHeight,
    width: 342,
    top: hostTop,
    left: 0,
    right: 342,
    bottom: hostTop + hostHeight,
    x: 0,
    y: hostTop,
    toJSON() {
      return {};
    },
  });
  Object.defineProperty(shell, 'clientHeight', { configurable: true, value: hostHeight });
  Object.defineProperty(shell, 'offsetHeight', { configurable: true, value: hostHeight });
  Object.defineProperty(hostSlot, 'offsetTop', { configurable: true, value: 51 });
  hostSlot.getBoundingClientRect = () => ({
    top: hostTop + chromeAboveSlot,
    height: 267,
    left: 0,
    width: 342,
    right: 342,
    bottom: hostTop + chromeAboveSlot + 267,
    x: 0,
    y: hostTop + chromeAboveSlot,
    toJSON() {
      return {};
    },
  });
  if (toolbar) {
    toolbar.getBoundingClientRect = () => ({
      height: toolbarHeight,
      top: hostTop + chromeAboveSlot,
      left: 0,
      width: 342,
      right: 342,
      bottom: hostTop + chromeAboveSlot + toolbarHeight,
      x: 0,
      y: hostTop + chromeAboveSlot,
      toJSON() {
        return {};
      },
    });
  }
  if (projectFooter) {
    const footerTop = hostTop + chromeAboveSlot + toolbarHeight + 267 - projectFooterHeight;
    projectFooter.getBoundingClientRect = () => ({
      height: projectFooterHeight,
      top: footerTop,
      left: 0,
      width: 342,
      right: 342,
      bottom: footerTop + projectFooterHeight,
      x: 0,
      y: footerTop,
      toJSON() {
        return {};
      },
    });
  }

  footer.getBoundingClientRect = () => {
    const expanded = shell.shellState.mapExpanded;
    const height = expanded ? expandedFooter : collapsedFooter;
    const top = hostTop + hostHeight - height;
    return {
      height,
      width: 342,
      top,
      left: 0,
      right: 342,
      bottom: hostTop + hostHeight,
      x: 0,
      y: top,
      toJSON() {
        return {};
      },
    };
  };
}

test('fill layout ignores nested offsetParent when reserving footer capacity', async () => {
  const InsprFlowShell = await loadFlowShell();
  const { frame, shell } = mountTwoNodeFillHost(InsprFlowShell, { height: 844, width: 342 });
  resyncFillFooter(shell);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const max = Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10);
  assert.equal(max, 465);

  frame.remove();
});

test('fill layout keeps expanded map from shrinking in footer flex chain', () => {
  const css = readFileSync(join(root, 'src/flow-shell.css'), 'utf8');
  const fillPanelRule = css.match(/:host\(\[content-layout='fill'\]\)\s*\.expanded-panel\s*\{[^}]+\}/);
  assert.ok(fillPanelRule, 'fill expanded-panel rule exists');
  assert.match(fillPanelRule[0], /flex:\s*0\s+0\s+auto/);
  assert.doesNotMatch(fillPanelRule[0], /flex:\s*0\s+1\s+auto/);
});

test('fill layout scrolls footer scaffold when controls exceed available capacity', () => {
  const css = readFileSync(join(root, 'src/flow-shell.css'), 'utf8');
  assert.match(css, /:host\(\[content-layout='fill'\]\)\s*\.shell-footer-scaffold[\s\S]*overflow:\s*auto/);
  assert.doesNotMatch(css, /:host\(\[content-layout='fill'\]\)\s*\.shell-footer-scaffold[\s\S]*overflow:\s*hidden/);
});

function resyncFillFooter(shell, metrics = {}) {
  mockFillHostMetrics(shell, metrics);
  shell.removeAttribute('layout-mode');
  shell.setAttribute('layout-mode', 'bounded');
}

test('dynamic footer map expansion grows reservation without latching capacity', async () => {
  const InsprFlowShell = await loadFlowShell();
  const { frame, shell } = mountTwoNodeFillHost(InsprFlowShell, { height: 844, width: 342 });
  resyncFillFooter(shell);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const initialSpace = Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10);
  const initialMax = Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10);
  assert.ok(initialSpace > 0);
  assert.ok(initialMax > initialSpace);

  clickAction(shell, 'toggle-map');
  resyncFillFooter(shell);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const expandedSpace = Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10);
  const expandedMax = Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10);
  assert.ok(expandedSpace > initialSpace);
  assert.equal(expandedMax, initialMax);

  clickAction(shell, 'toggle-map');
  resyncFillFooter(shell);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const collapsedSpace = Number.parseInt(shell.style.getPropertyValue('--shell-footer-space'), 10);
  const collapsedMax = Number.parseInt(shell.style.getPropertyValue('--shell-footer-max-height'), 10);
  assert.ok(collapsedSpace > 0);
  assert.equal(collapsedMax, initialMax);
  assert.ok(collapsedMax > collapsedSpace);

  frame.remove();
});

test('footer-space attribute override still works in fill layout', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell);
  shell.setAttribute('content-layout', 'fill');
  shell.setAttribute('footer-space', '240px');
  assert.equal(shell.style.getPropertyValue('--shell-footer-space'), '240px');

  shell.removeAttribute('footer-space');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const restored = shell.style.getPropertyValue('--shell-footer-space');
  assert.ok(restored);
  assert.notEqual(restored, '240px');
});

test('fill host example uses global padding reset and two-node slot shape', () => {
  const html = readFileSync(join(root, 'examples/host-fill/index.html'), 'utf8');
  assert.match(html, /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*padding:\s*0/);
  assert.match(html, /content-layout="fill"/);
  assert.match(html, /layout-mode="bounded"/);
  assert.match(html, /content-padding="0"/);
  assert.match(html, /data-flow-host-region="toolbar"/);
  assert.match(html, /data-flow-host-region="body"/);
  assert.match(html, /class="sidebar"/);
  assert.match(html, /id="project-footer"/);
  assert.match(html, /id="link-settings"/);
  assert.match(html, /id="tall-scroll-fixture"/);
  assert.match(html, /min-height:\s*2400px/);
  assert.match(html, /height:\s*900px/);
  assert.match(html, /inspr-flow-shell\s*\{[^}]*padding-bottom:\s*var\(--shell-footer-space\)/);
  const shellStart = html.indexOf('<inspr-flow-shell');
  const toolbarIndex = html.indexOf('class="host-toolbar"');
  assert.ok(shellStart >= 0 && toolbarIndex > shellStart, 'toolbar must be slotted inside inspr-flow-shell');
});

test('document scroll host example keeps default layout without fill attribute', () => {
  const html = readFileSync(join(root, 'examples/host-document-scroll/index.html'), 'utf8');
  assert.doesNotMatch(html, /<inspr-flow-shell[^>]*content-layout="fill"/);
  assert.match(html, /id="project-footer"/);
  assert.match(html, /id="tall-scroll-fixture"/);
});

test('fill layout preserves footer stage navigation controls', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, normalizeShellState({
    header: { appName: 'INSPR', projectName: 'Stages', userInitials: 'MK' },
  }));
  shell.setAttribute('content-layout', 'fill');
  const stages = shell.shadowRoot.querySelectorAll('[data-action="stage"]');
  const review = shell.shadowRoot.querySelector('[data-action="review-batch"]');
  assert.equal(stages.length, 4);
  assert.ok(review);
});
