import { sidebarShellState } from './fixture.js';
import { normalizeShellState } from '../../src/state.js';
import '../../src/inspr-flow-shell.js';

const shell = document.querySelector('inspr-flow-shell');
const panel = document.querySelector('#host-panel');
const log = document.querySelector('#intent-log');
const sidebarToggle = document.querySelector('#sidebar-toggle');

shell.shellState = normalizeShellState(sidebarShellState);

function footerVisible(footerRect) {
  const viewportHeight = window.innerHeight;
  return footerRect.top < viewportHeight && footerRect.bottom > 0;
}

function describeLayout() {
  const host = shell.getBoundingClientRect();
  const footer = shell.shadowRoot.querySelector('.shell-footer')?.getBoundingClientRect();
  const account = shell.shadowRoot.querySelector('[data-action="account"]')?.getBoundingClientRect();
  const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollY: Math.round(window.scrollY),
    sidebarWidth: sidebar ? Math.round(sidebar.width) : null,
    hostLeft: Math.round(host.left),
    hostWidth: Math.round(host.width),
    footerLeft: footer ? Math.round(footer.left) : null,
    footerWidth: footer ? Math.round(footer.width) : null,
    footerTop: footer ? Math.round(footer.top) : null,
    footerVisible: footer ? footerVisible(footer) : null,
    accountRight: account ? Math.round(account.right) : null,
    fixedLeft: shell.style.getPropertyValue('--shell-fixed-left'),
    fixedWidth: shell.style.getPropertyValue('--shell-fixed-width'),
    footerSpace: shell.style.getPropertyValue('--shell-footer-space'),
  };
}

function refreshPanel() {
  const layout = describeLayout();
  panel.textContent = `scrollY=${layout.scrollY} · column ${layout.hostWidth}px at x=${layout.hostLeft} · footer ${layout.footerWidth}px at x=${layout.footerLeft}, top=${layout.footerTop}, visible=${layout.footerVisible} · account right=${layout.accountRight}px · bounds ${layout.fixedLeft}/${layout.fixedWidth}`;
}

shell.addEventListener('flow-intent', (event) => {
  const detail = event.detail;
  const item = document.createElement('li');
  item.textContent = `${detail.type}${detail.error ? ` · ${detail.error}` : ''}`;
  log.prepend(item);
  refreshPanel();
});

sidebarToggle?.addEventListener('click', () => {
  document.body.classList.toggle('sidebar-expanded');
  refreshPanel();
});

document.querySelector('#scroll-top')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
document.querySelector('#scroll-mid')?.addEventListener('click', () => {
  window.scrollTo({ top: 1000, behavior: 'smooth' });
});
document.querySelector('#scroll-bottom')?.addEventListener('click', () => {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
});

window.addEventListener('resize', refreshPanel);
window.addEventListener('scroll', refreshPanel, { passive: true });
refreshPanel();
