import { draftShellState } from './fixture.js';
import { normalizeShellState } from '../../src/state.js';
import { createSaveProposalIntent } from '../../src/intents.js';
import '../../src/inspr-flow-shell.js';

const shell = document.querySelector('inspr-flow-shell');
const log = document.querySelector('#intent-log');
const form = document.querySelector('#proposal-form');

function iso(now, deltaMs) {
  return new Date(now + deltaMs).toISOString();
}

function withLiveEvaluation(state) {
  const now = Date.now();
  const identityContext = state.identityContext
    ? {
        ...state.identityContext,
        evaluated_at: iso(now, 0),
        issued_at: iso(now, -60_000),
        expires_at: iso(now, 8 * 60 * 60_000),
        fresh_until: iso(now, 12 * 60_000),
      }
    : null;
  return {
    ...state,
    identityContext,
    evaluatedAt: iso(now, 0),
    prerequisites: {
      requirementsBaseline: {
        ...state.prerequisites.requirementsBaseline,
        observedAt: iso(now, -60_000),
        freshUntil: iso(now, 12 * 60_000),
      },
      deployArtifact: { ...state.prerequisites.deployArtifact },
      pharosTarget: {
        ...state.prerequisites.pharosTarget,
        observedAt: iso(now, -60_000),
      },
      janusGate: { ...state.prerequisites.janusGate },
    },
    progress: {
      ...state.progress,
      task: {
        ...state.progress.task,
        progress: {
          ...state.progress.task.progress,
          reported_at: iso(now, -60_000),
          fresh_until: iso(now, 12 * 60_000),
        },
        forecast: {
          ...state.progress.task.forecast,
          as_of: iso(now, -60_000),
          estimated_finish: iso(now, -60_000),
        },
      },
      overall: {
        ...state.progress.overall,
        progress: {
          ...state.progress.overall.progress,
          reported_at: iso(now, -60_000),
          fresh_until: iso(now, 12 * 60_000),
        },
        forecast: {
          ...state.progress.overall.forecast,
          as_of: iso(now, -60_000),
          estimated_finish: iso(now, 55 * 60_000),
        },
      },
    },
  };
}

function appendIntent(detail) {
  const item = document.createElement('li');
  item.textContent = JSON.stringify(detail, null, 0);
  log.prepend(item);
}

shell.shellState = normalizeShellState(withLiveEvaluation(draftShellState));

shell.addEventListener('flow-intent', (event) => {
  const detail = event.detail;
  appendIntent(detail);
  if (detail.type === 'flow:start-intent' && !detail.error) {
    appendIntent({ host: 'Host A would revalidate authority here; no execution from UI.' });
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = new FormData(form).get('proposal');
  const intent = createSaveProposalIntent(text);
  if (intent.error) {
    appendIntent(intent);
    return;
  }
  shell.dispatchEvent(new CustomEvent('flow-intent', { bubbles: true, composed: true, detail: intent }));
  form.reset();
  shell.showNotice('Proposal saved as draft intent. No delivery started.');
});
