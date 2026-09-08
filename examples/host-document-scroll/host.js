import { documentScrollShellState } from './fixture.js';
import { normalizeShellState } from '../../src/state.js';
import '../../src/inspr-flow-shell.js';

const shell = document.querySelector('inspr-flow-shell');
const panel = document.querySelector('#host-panel');
const log = document.querySelector('#intent-log');

shell.shellState = normalizeShellState(documentScrollShellState);

function describeLayout() {
  const host = shell.getBoundingClientRect();
  const flowFooter = shell.shadowRoot.querySelector('.shell-footer')?.getBoundingClientRect();
  const projectFooter = document.querySelector('#project-footer')?.getBoundingClientRect();
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollY: Math.round(window.scrollY),
    hostHeight: Math.round(host.height),
    flowFooterTop: flowFooter ? Math.round(flowFooter.top) : null,
    projectFooterBottom: projectFooter ? Math.round(projectFooter.bottom) : null,
    contentLayout: shell.getAttribute('content-layout'),
  };
}

function refreshPanel() {
  const layout = describeLayout();
  panel.textContent = `document · scrollY=${layout.scrollY} · host ${layout.hostHeight}px · project bottom=${layout.projectFooterBottom} · flow footer top=${layout.flowFooterTop}`;
}

function scheduleRefresh() {
  requestAnimationFrame(() => requestAnimationFrame(refreshPanel));
}

shell.addEventListener('flow-intent', (event) => {
  const detail = event.detail;
  const item = document.createElement('li');
  item.textContent = `${detail.type}${detail.error ? ` · ${detail.error}` : ''}`;
  log.prepend(item);
  scheduleRefresh();
});

document.querySelector('#scroll-bottom')?.addEventListener('click', () => {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
});

window.addEventListener('resize', scheduleRefresh);
window.addEventListener('scroll', scheduleRefresh, { passive: true });

scheduleRefresh();
