import { fillShellState } from './fixture.js';
import { normalizeShellState } from '../../src/state.js';
import '../../src/inspr-flow-shell.js';

const shell = document.querySelector('inspr-flow-shell');
const panel = document.querySelector('#host-panel');
const log = document.querySelector('#intent-log');
const scrollBody = document.querySelector('#scroll-body');
const projectFooter = document.querySelector('#project-footer');

shell.shellState = normalizeShellState(fillShellState);

function shellStylesReady() {
  const cssLink = shell.shadowRoot?.querySelector('link[data-shell-css="true"]');
  return Boolean(cssLink?.sheet);
}

function footerVisible(footerRect) {
  const viewportHeight = window.innerHeight;
  return footerRect.top < viewportHeight && footerRect.bottom > 0;
}

function describeLayout() {
  const host = shell.getBoundingClientRect();
  const shellRoot = shell.shadowRoot.querySelector('.shell-root')?.getBoundingClientRect();
  const shellScaffold = shell.shadowRoot.querySelector('.shell-scaffold')?.getBoundingClientRect();
  const hostSlot = shell.shadowRoot.querySelector('.host-slot')?.getBoundingClientRect();
  const flowFooter = shell.shadowRoot.querySelector('.shell-footer')?.getBoundingClientRect();
  const projectRect = projectFooter?.getBoundingClientRect();
  const scrollRect = scrollBody?.getBoundingClientRect();
  const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
  const main = document.querySelector('.main')?.getBoundingClientRect();
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollY: Math.round(window.scrollY),
    mainHeight: main ? Math.round(main.height) : null,
    sidebarWidth: sidebar ? Math.round(sidebar.width) : null,
    hostHeight: Math.round(host.height),
    shellRootHeight: shellRoot ? Math.round(shellRoot.height) : null,
    shellScaffoldHeight: shellScaffold ? Math.round(shellScaffold.height) : null,
    hostSlotHeight: hostSlot ? Math.round(hostSlot.height) : null,
    scrollBodyHeight: scrollRect ? Math.round(scrollRect.height) : null,
    scrollBodyScrollHeight: scrollBody ? Math.round(scrollBody.scrollHeight) : null,
    flowFooterTop: flowFooter ? Math.round(flowFooter.top) : null,
    flowFooterVisible: flowFooter ? footerVisible(flowFooter) : null,
    projectFooterTop: projectRect ? Math.round(projectRect.top) : null,
    projectFooterBottom: projectRect ? Math.round(projectRect.bottom) : null,
    projectAboveFlowFooter: projectRect && flowFooter ? projectRect.bottom <= flowFooter.top + 1 : null,
    fixedLeft: shell.style.getPropertyValue('--shell-fixed-left'),
    fixedWidth: shell.style.getPropertyValue('--shell-fixed-width'),
    footerSpace: shell.style.getPropertyValue('--shell-footer-space'),
    hostPaddingBottom: Math.round(parseFloat(getComputedStyle(shell).paddingBottom) || 0),
    contentLayout: shell.getAttribute('content-layout'),
  };
}

function refreshPanel() {
  if (!shellStylesReady()) {
    panel.textContent = 'Waiting for shell styles…';
    return;
  }
  const layout = describeLayout();
  panel.textContent = `fill · scrollY=${layout.scrollY} · main ${layout.mainHeight}px · host ${layout.hostHeight}px · host padding-bottom=${layout.hostPaddingBottom}px · footer-space=${layout.footerSpace} · root ${layout.shellRootHeight}px · scaffold ${layout.shellScaffoldHeight}px · slot ${layout.hostSlotHeight}px · scroll ${layout.scrollBodyHeight}/${layout.scrollBodyScrollHeight}px · project y=${layout.projectFooterTop}..${layout.projectFooterBottom} · flow footer top=${layout.flowFooterTop} · project above flow=${layout.projectAboveFlowFooter}`;
}

function scheduleRefresh() {
  requestAnimationFrame(() => requestAnimationFrame(refreshPanel));
}

function whenLayoutSettled(callback) {
  const cssLink = shell.shadowRoot?.querySelector('link[data-shell-css="true"]');
  if (!cssLink || cssLink.sheet) {
    scheduleRefresh();
    callback?.();
    return;
  }
  cssLink.addEventListener(
    'load',
    () => {
      scheduleRefresh();
      callback?.();
    },
    { once: true },
  );
}

shell.addEventListener('flow-intent', (event) => {
  const detail = event.detail;
  const item = document.createElement('li');
  item.textContent = `${detail.type}${detail.error ? ` · ${detail.error}` : ''}`;
  log.prepend(item);
  scheduleRefresh();
});

document.querySelector('#sidebar-toggle')?.addEventListener('click', () => {
  document.body.classList.toggle('sidebar-expanded');
  scheduleRefresh();
});

document.querySelector('#scroll-top')?.addEventListener('click', () => {
  scrollBody.scrollTo({ top: 0, behavior: 'smooth' });
});

document.querySelector('#scroll-mid')?.addEventListener('click', () => {
  scrollBody.scrollTo({ top: scrollBody.scrollHeight / 2, behavior: 'smooth' });
});

document.querySelector('#scroll-bottom')?.addEventListener('click', () => {
  scrollBody.scrollTo({ top: scrollBody.scrollHeight, behavior: 'smooth' });
});

document.querySelector('#toggle-map')?.addEventListener('click', () => {
  shell.shadowRoot.querySelector('[data-action="toggle-map"]')?.click();
  scheduleRefresh();
});

document.querySelector('#clear-fill')?.addEventListener('click', () => {
  shell.removeAttribute('content-layout');
  scheduleRefresh();
});

document.querySelector('#restore-fill')?.addEventListener('click', () => {
  shell.setAttribute('content-layout', 'fill');
  scheduleRefresh();
});

window.addEventListener('resize', scheduleRefresh);

const layoutObserver = new ResizeObserver(() => scheduleRefresh());
layoutObserver.observe(shell);
if (scrollBody) layoutObserver.observe(scrollBody);

whenLayoutSettled();
