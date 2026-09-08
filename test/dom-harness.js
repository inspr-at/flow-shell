import { Window } from 'happy-dom';
import { NOW_MS } from './helpers.js';

let domWindow = null;
let restoreNow = null;

export function installDomHarness({ nowMs = NOW_MS } = {}) {
  if (domWindow) return domWindow;
  domWindow = new Window({ url: 'http://localhost/' });
  const globals = ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
  for (const key of globals) {
    globalThis[key] = domWindow[key];
  }
  freezeNow(nowMs);
  return domWindow;
}

export function freezeNow(nowMs = NOW_MS) {
  restoreNow?.();
  const original = Date.now;
  Date.now = () => nowMs;
  restoreNow = () => {
    Date.now = original;
    restoreNow = null;
  };
}

export async function loadFlowShell() {
  installDomHarness();
  const module = await import('../src/inspr-flow-shell.js');
  return module.InsprFlowShell;
}

export function mountShell(InsprFlowShell, shellState = {}) {
  const shell = new InsprFlowShell();
  document.body.appendChild(shell);
  if (Object.keys(shellState).length > 0) {
    shell.shellState = shellState;
  }
  return shell;
}

export function collectIntents(shell) {
  const intents = [];
  shell.addEventListener('flow-intent', (event) => {
    intents.push(event.detail);
  });
  return intents;
}

export function clickAction(shell, action, { stage } = {}) {
  const selector =
    stage == null ? `[data-action="${action}"]` : `[data-action="${action}"][data-stage="${stage}"]`;
  const target = shell.shadowRoot.querySelector(selector);
  assertPresent(target, selector);
  target.click();
  return target;
}

export function setSelectValue(shell, action, value) {
  const select = shell.shadowRoot.querySelector(`[data-action="${action}"]`);
  assertPresent(select, `[data-action="${action}"]`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select;
}

function assertPresent(value, label) {
  if (!value) {
    throw new Error(`Missing element: ${label}`);
  }
}
