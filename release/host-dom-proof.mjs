/**
 * Load an installed @inspr/flow-shell Web Component in an isolated process.
 * Usage: node host-dom-proof.mjs <install-root>
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

const installRoot = process.argv[2];
if (!installRoot) {
  throw new Error('usage: node host-dom-proof.mjs <install-root>');
}

const window = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node']) {
  globalThis[key] = window[key];
}

const moduleUrl = pathToFileURL(join(installRoot, 'src/inspr-flow-shell.js')).href;
const shellModule = await import(moduleUrl);
assert.equal(customElements.get('inspr-flow-shell'), shellModule.InsprFlowShell);
const shell = document.createElement('inspr-flow-shell');
document.body.appendChild(shell);
const logo = pathToFileURL(join(installRoot, 'src/assets/inspr-logo.svg')).href;
shell.setAttribute('logo-src', logo);
shell.shellState = shellModule.normalizeShellState({});
const css = shell.shadowRoot.querySelector('link[data-shell-css]');
assert.ok(css?.getAttribute('href')?.includes('flow-shell.css'));
const img = shell.shadowRoot.querySelector('img');
assert.equal(img?.getAttribute('src'), logo);
const intents = [];
shell.addEventListener('flow-intent', (event) => intents.push(event.detail));
shell.openReviewDialog();
const start = shell.shadowRoot.querySelector('[data-action="confirm-start"]');
assert.ok(start);
assert.equal(start.disabled, true);
start.click();
assert.equal(intents.some((intent) => intent.type === 'flow:start-intent' && !intent.error), false);
process.stdout.write('host-dom-proof: ok\n');
