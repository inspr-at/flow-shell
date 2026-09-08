import { runningShellState } from './fixture.js';
import { normalizeShellState } from '../../src/state.js';
import '../../src/inspr-flow-shell.js';

const shell = document.querySelector('inspr-flow-shell');
const panel = document.querySelector('#host-panel');

function iso(now, deltaMs) {
  return new Date(now + deltaMs).toISOString();
}

function withAgedEvaluation(state) {
  const now = Date.now();
  return {
    ...state,
    evaluatedAt: iso(now, -14 * 60_000),
    prerequisites: {
      requirementsBaseline: {
        ...state.prerequisites.requirementsBaseline,
        observedAt: iso(now, -20 * 60_000),
        freshUntil: iso(now, -4 * 60_000),
      },
      deployArtifact: {
        ...state.prerequisites.deployArtifact,
        observedAt: iso(now, -16 * 60_000),
      },
      pharosTarget: {
        ...state.prerequisites.pharosTarget,
        observedAt: iso(now, -16 * 60_000),
      },
      janusGate: { ...state.prerequisites.janusGate },
    },
    progress: {
      ...state.progress,
      task: {
        ...state.progress.task,
        progress: {
          ...state.progress.task.progress,
          reported_at: iso(now, -14 * 60_000),
          fresh_until: iso(now, -4 * 60_000),
          freshness: 'fresh',
        },
        forecast: {
          ...state.progress.task.forecast,
          as_of: iso(now, -14 * 60_000),
          estimated_finish: iso(now, 21 * 60_000),
        },
      },
      overall: {
        ...state.progress.overall,
        progress: {
          ...state.progress.overall.progress,
          reported_at: iso(now, -14 * 60_000),
          fresh_until: iso(now, -4 * 60_000),
          freshness: 'fresh',
        },
        forecast: {
          ...state.progress.overall.forecast,
          as_of: iso(now, -14 * 60_000),
          estimated_finish: iso(now, 36 * 60_000),
        },
      },
      freshnessLabel: 'Host string still says fresh',
    },
  };
}

shell.shellState = normalizeShellState(withAgedEvaluation(runningShellState));

shell.addEventListener('flow-intent', (event) => {
  const detail = event.detail;
  panel.textContent = `Last intent: ${detail.type}${detail.error ? ` · ${detail.error}` : ''}`;
});
