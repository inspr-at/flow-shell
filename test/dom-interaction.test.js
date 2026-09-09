import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShellState } from '../src/state.js';
import { INTENT_TYPES } from '../src/intents.js';
import {
  clickAction,
  collectIntents,
  freezeNow,
  installDomHarness,
  loadFlowShell,
  mountShell,
  setSelectValue,
  triggerVisibilityRefresh,
} from './dom-harness.js';
import { DIGEST_B, JAN_ISO, NOW_ISO, NOW_MS, labelledLocalContext, passGate, unknownGate } from './helpers.js';

installDomHarness();

test.afterEach(() => {
  document.body.replaceChildren();
});

function readyBuild(overrides = {}) {
  return normalizeShellState({
    evaluatedAt: NOW_ISO,
    delivery: {
      batchRef: 'batch_1',
      baselineRef: 'baseline_7',
      baselineDigest: DIGEST_B,
      batchTitle: 'Make booking effortless',
      status: 'draft',
      scopeItems: ['Clarify banner'],
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
    ...overrides,
  });
}

test('repeated render and reconnect emit one intent per map toggle gesture', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  shell.shellState = readyBuild({ delivery: { batchTitle: 'Reconnect batch' } });
  const intents = collectIntents(shell);

  clickAction(shell, 'toggle-map');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].type, INTENT_TYPES.TOGGLE_MAP);
  assert.equal(shell.shellState.mapExpanded, true);

  clickAction(shell, 'toggle-map');
  assert.equal(intents.length, 2);
  assert.equal(intents[1].type, INTENT_TYPES.TOGGLE_MAP);
  assert.equal(shell.shellState.mapExpanded, false);
});

test('stage navigation keeps the dialog open with gate explanation', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  const intents = collectIntents(shell);

  clickAction(shell, 'stage', { stage: 2 });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].type, INTENT_TYPES.NAVIGATE_STAGE);
  assert.equal(intents[0].detail.stageIndex, 2);

  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /Deployable preview artifact not reported yet|evidence/i);
  assert.ok(dialog.getAttribute('aria-label'));
});

test('review dialog mode change syncs footer mode and refreshes expiry caption', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  clickAction(shell, 'review-batch');

  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  const expiry = dialog.querySelector('[data-review-expiry]');
  const initialExpiry = expiry.textContent;
  assert.match(initialExpiry, /12:05:00/);

  freezeNow(NOW_MS + 3 * 60 * 1000);
  setSelectValue(shell, 'execution-mode', 'assisted');
  assert.equal(dialog.open, true);
  assert.equal(shell.shellState.selectedExecutionMode, 'assisted');
  const footer = shell.shadowRoot.querySelector('[data-action="footer-execution-mode"]');
  assert.equal(footer.value, 'assisted');
  assert.notEqual(dialog.querySelector('[data-review-expiry]').textContent, initialExpiry);
  assert.match(dialog.querySelector('[data-review-expiry]').textContent, /12:08:00/);
  freezeNow(NOW_MS);
});

test('computed stale caption overrides a host fresh label', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(
    InsprFlowShell,
    readyBuild({
      progress: {
        freshnessLabel: 'Host string still says fresh',
        taskLabel: 'Testing preview flow',
        overallLabel: 'Overall',
        task: {
          progress: {
            status: 'in_progress',
            percent_complete: 62,
            eta: null,
            basis: { kind: 'task_assessment', evidence_ref: 'evidence_try' },
            reporter: { kind: 'worker', reporter_ref: 'worker_harbor' },
            reported_at: '2026-09-07T12:00:00Z',
            fresh_until: '2026-09-07T11:50:00Z',
            freshness: 'fresh',
          },
          forecast: {
            percent_complete: 62,
            estimated_finish: '2026-09-07T12:35:00Z',
            kind: 'worker_estimate',
            as_of: '2026-09-07T12:00:00Z',
            basis: { kind: 'worker_assessment', evidence_ref: 'evidence_try_forecast' },
          },
        },
        overall: {
          progress: {
            status: 'in_progress',
            percent_complete: 78,
            eta: null,
            basis: { kind: 'work_breakdown', evidence_ref: 'evidence_overall' },
            reporter: { kind: 'system', reporter_ref: 'reporter_host' },
            reported_at: '2026-09-07T12:00:00Z',
            fresh_until: '2026-09-07T11:50:00Z',
            freshness: 'fresh',
          },
          forecast: {
            percent_complete: 78,
            estimated_finish: '2026-09-07T12:50:00Z',
            kind: 'educated_guess',
            as_of: '2026-09-07T12:00:00Z',
            basis: { kind: 'elapsed_revision', evidence_ref: 'evidence_overall_forecast' },
          },
        },
      },
    }),
  );
  const footer = shell.shadowRoot.querySelector('.bar-bottom').textContent;
  assert.match(footer, /Stale observations/);
  assert.doesNotMatch(footer, /Host string still says fresh/);
});

test('review dialog survives execution mode change and invalidates confirmation', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  clickAction(shell, 'review-batch');

  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  const confirm = dialog.querySelector('[data-review-confirm]');
  const start = dialog.querySelector('[data-action="confirm-start"]');

  confirm.checked = true;
  confirm.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(start.disabled, false);

  setSelectValue(shell, 'execution-mode', 'assisted');
  assert.equal(dialog.open, true);
  assert.equal(shell.shellState.selectedExecutionMode, 'assisted');
  assert.equal(confirm.checked, false);
  assert.equal(start.disabled, true);
});

test('footer execution mode change does not close the review dialog', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  clickAction(shell, 'review-batch');

  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  setSelectValue(shell, 'footer-execution-mode', 'automatic');
  assert.equal(dialog.open, true);
  assert.equal(shell.shellState.selectedExecutionMode, 'automatic');
});

test('confirmed review emits exactly one valid start intent', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  const intents = collectIntents(shell);

  clickAction(shell, 'review-batch');
  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  const confirm = dialog.querySelector('[data-review-confirm]');
  confirm.checked = true;
  confirm.dispatchEvent(new Event('change', { bubbles: true }));
  dialog.querySelector('[data-action="confirm-start"]').click();

  const startIntents = intents.filter((intent) => intent.type === INTENT_TYPES.START_INTENT);
  assert.equal(startIntents.length, 1);
  assert.equal(startIntents[0].detail.executes, false);
  assert.equal(startIntents[0].detail.action, 'build');
  assert.equal(startIntents[0].detail.identity.status, 'present');
  assert.ok(startIntents[0].detail.identity.principalRef.startsWith('host_fixture_a:'));
  assert.equal(dialog.open, false);
});

test('stale evaluation refuses start intent from the review dialog', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(
    InsprFlowShell,
    readyBuild({
      evaluatedAt: JAN_ISO,
      prerequisites: {
        requirementsBaseline: passGate({ observedAt: JAN_ISO, freshUntil: '2026-01-15T09:15:00Z' }),
        deployArtifact: unknownGate({ gateKind: 'artifact' }),
        pharosTarget: passGate({
          gateKind: 'target_readiness',
          evidenceRef: 'evidence_pharos',
          observedAt: JAN_ISO,
          freshUntil: '2026-01-15T09:15:00Z',
          readiness: 'preliminary',
          targetRef: 'target_prod',
        }),
        janusGate: unknownGate({ gateKind: 'access' }),
      },
    }),
  );
  const intents = collectIntents(shell);

  clickAction(shell, 'review-batch');
  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  const confirm = dialog.querySelector('[data-review-confirm]');
  const start = dialog.querySelector('[data-action="confirm-start"]');

  confirm.checked = true;
  confirm.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(start.disabled, true);
  assert.match(dialog.textContent, /expired|stale/i);

  start.click();
  assert.equal(intents.some((intent) => intent.type === INTENT_TYPES.START_INTENT), false);
  assert.equal(intents.some((intent) => intent.error), false);
});

test('completed build/test batch footer distinguishes unused stages and still lets people explore', async () => {
  const { readFileSync } = await import('node:fs');
  const { fromDeliveryContract } = await import('../src/adapter.js');
  const { deliveryValidFile } = await import('./fixture-paths.js');
  const contract = JSON.parse(readFileSync(deliveryValidFile('completed-paimos-build-test.json'), 'utf8'));
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, fromDeliveryContract(contract, { batchRef: 'batch_build_test' }));
  const intents = collectIntents(shell);
  const buttons = [...shell.shadowRoot.querySelectorAll('[data-action="stage"]')];
  assert.equal(buttons.length, 4);
  assert.match(buttons[1].getAttribute('aria-label'), /performed/i);
  assert.match(buttons[2].getAttribute('aria-label'), /not in this batch/i);
  assert.match(buttons[3].getAttribute('aria-label'), /not in this batch/i);
  assert.ok(buttons[2].classList.contains('not-in-batch'));
  assert.equal(buttons[2].classList.contains('done'), false);
  clickAction(shell, 'stage', { stage: 3 });
  assert.equal(intents[0].type, INTENT_TYPES.NAVIGATE_STAGE);
  assert.equal(intents[0].detail.stageIndex, 3);
  assert.equal(shell.shadowRoot.querySelector('dialog[data-shell-dialog]').open, true);
});

test('done requirements task with dangling baseline keeps Define stage out of performed in the footer', async () => {
  const { readFileSync } = await import('node:fs');
  const { fromDeliveryContract } = await import('../src/adapter.js');
  const { deliveryValidFile } = await import('./fixture-paths.js');
  const contract = JSON.parse(readFileSync(deliveryValidFile('completed-paimos-build-test.json'), 'utf8'));
  const batch = contract.batches[0];
  batch.tasks.unshift({
    task_ref: 'task_requirements',
    requirement_refs: ['requirement_preview'],
    operation: 'requirements',
    target_ref: null,
    status: 'done',
    completion_evidence_ref: 'evidence_req_1',
  });
  batch.scope.task_refs.unshift('task_requirements');
  batch.baseline.baseline_ref = 'baseline_missing';
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, fromDeliveryContract(contract, { batchRef: 'batch_build_test' }));
  const define = shell.shadowRoot.querySelector('[data-action="stage"][data-stage="0"]');
  assert.ok(define);
  assert.doesNotMatch(define.getAttribute('aria-label'), /performed/i);
  assert.equal(define.classList.contains('done'), false);
});

test('clock timer re-ages progress at fresh_until + 1ms without visibility refresh', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    mock.timers.setTime(NOW_MS);
    const InsprFlowShell = await loadFlowShell();
    const shell = mountShell(
      InsprFlowShell,
      readyBuild({
        progress: {
          freshnessLabel: 'Host says fresh',
          taskLabel: 'Synthetic observed task',
          overallLabel: 'Overall',
          task: {
            progress: {
              status: 'in_progress',
              percent_complete: 62,
              freshness: 'fresh',
              fresh_until: '2026-09-07T12:00:02Z',
              basis: { kind: 'task_assessment', evidence_ref: 'evidence_try' },
            },
            forecast: {
              percent_complete: 62,
              estimated_finish: '2026-09-07T12:35:00Z',
              kind: 'worker_estimate',
            },
          },
        },
        prerequisites: {
          requirementsBaseline: passGate({ freshUntil: '2026-09-07T12:00:02Z' }),
          deployArtifact: unknownGate({ gateKind: 'artifact' }),
          pharosTarget: passGate({
            gateKind: 'target_readiness',
            evidenceRef: 'evidence_pharos',
            readiness: 'preliminary',
            targetRef: 'target_prod',
          }),
          janusGate: unknownGate({ gateKind: 'access' }),
        },
      }),
    );
    const freshState = readyBuild({
      progress: {
        freshnessLabel: 'Host says fresh',
        taskLabel: 'Synthetic observed task',
        overallLabel: 'Overall',
        task: {
          progress: {
            status: 'in_progress',
            percent_complete: 62,
            freshness: 'fresh',
            fresh_until: '2026-09-07T12:00:02Z',
            basis: { kind: 'task_assessment', evidence_ref: 'evidence_try' },
          },
          forecast: {
            percent_complete: 62,
            estimated_finish: '2026-09-07T12:35:00Z',
            kind: 'worker_estimate',
          },
        },
      },
      prerequisites: {
        requirementsBaseline: passGate({ freshUntil: '2026-09-07T12:00:02Z' }),
        deployArtifact: unknownGate({ gateKind: 'artifact' }),
        pharosTarget: passGate({
          gateKind: 'target_readiness',
          evidenceRef: 'evidence_pharos',
          readiness: 'preliminary',
          targetRef: 'target_prod',
        }),
        janusGate: unknownGate({ gateKind: 'access' }),
      },
    });
    const progress = shell.shadowRoot.querySelector('[data-shell-clock-progress]');
    assert.doesNotMatch(progress.textContent, /Stale observations/);
    mock.timers.tick(2000);
    assert.doesNotMatch(progress.textContent, /Stale observations/);
    mock.timers.tick(1);
    assert.match(progress.textContent, /Stale observations/);
    assert.doesNotMatch(progress.textContent, /Host says fresh/);

    mock.timers.setTime(NOW_MS);
    shell.shellState = freshState;
    clickAction(shell, 'review-batch');
    const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
    const confirm = dialog.querySelector('[data-review-confirm]');
    const start = dialog.querySelector('[data-action="confirm-start"]');
    const expiry = dialog.querySelector('[data-review-expiry]').textContent;
    confirm.checked = true;
    confirm.focus();
    confirm.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(start.disabled, false);
    mock.timers.tick(2001);
    assert.equal(dialog.open, true);
    assert.equal(confirm.checked, true);
    assert.equal(dialog.querySelector('[data-review-expiry]').textContent, expiry);
    assert.equal(start.disabled, true);
    assert.match(dialog.querySelector('[data-review-gate-reason]').textContent, /stale/i);
    shell.remove();
  } finally {
    mock.timers.reset();
    freezeNow(NOW_MS);
  }
});

test('review snapshot expiry schedules clock aging without renewing consent', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    mock.timers.setTime(NOW_MS);
    const InsprFlowShell = await loadFlowShell();
    const shell = mountShell(
      InsprFlowShell,
      readyBuild({
        prerequisites: {
          requirementsBaseline: passGate({ freshUntil: '2026-09-07T12:20:00Z' }),
          deployArtifact: unknownGate({ gateKind: 'artifact' }),
          pharosTarget: passGate({
            gateKind: 'target_readiness',
            evidenceRef: 'evidence_pharos',
            readiness: 'preliminary',
            targetRef: 'target_prod',
          }),
          janusGate: unknownGate({ gateKind: 'access' }),
        },
        progress: {
          task: {
            progress: {
              status: 'in_progress',
              percent_complete: 10,
              freshness: 'fresh',
              fresh_until: '2026-09-07T12:20:00Z',
            },
            forecast: { percent_complete: 10, estimated_finish: '2026-09-07T12:40:00Z' },
          },
        },
      }),
    );
    clickAction(shell, 'review-batch');
    const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
    const confirm = dialog.querySelector('[data-review-confirm]');
    const expiry = dialog.querySelector('[data-review-expiry]').textContent;
    confirm.checked = true;
    confirm.focus();
    confirm.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(dialog.querySelector('[data-action="confirm-start"]').disabled, false);
    mock.timers.tick(5 * 60 * 1000 + 1);
    assert.equal(dialog.querySelector('[data-review-expiry]').textContent, expiry);
    assert.equal(confirm.checked, true);
    assert.equal(dialog.querySelector('[data-action="confirm-start"]').disabled, true);
    assert.match(dialog.querySelector('[data-review-gate-reason]').textContent, /Confirmation snapshot has expired/i);
    shell.remove();
  } finally {
    mock.timers.reset();
    freezeNow(NOW_MS);
  }
});

test('visibility refresh re-ages progress without a host state push', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(
    InsprFlowShell,
    readyBuild({
      progress: {
        freshnessLabel: 'Host string still says fresh',
        taskLabel: 'Testing preview flow',
        overallLabel: 'Overall',
        task: {
          progress: {
            status: 'in_progress',
            percent_complete: 62,
            freshness: 'fresh',
            fresh_until: '2026-09-07T12:10:00Z',
            basis: { kind: 'task_assessment', evidence_ref: 'evidence_try' },
          },
          forecast: {
            percent_complete: 62,
            estimated_finish: '2026-09-07T12:35:00Z',
            kind: 'worker_estimate',
          },
        },
        overall: {
          progress: {
            status: 'in_progress',
            percent_complete: 78,
            freshness: 'fresh',
            fresh_until: '2026-09-07T12:10:00Z',
            basis: { kind: 'work_breakdown', evidence_ref: 'evidence_overall' },
          },
          forecast: {
            percent_complete: 78,
            estimated_finish: '2026-09-07T12:50:00Z',
            kind: 'educated_guess',
          },
        },
      },
    }),
  );
  const progress = shell.shadowRoot.querySelector('[data-shell-clock-progress]');
  assert.doesNotMatch(progress.textContent, /Stale observations/);
  freezeNow(NOW_MS + 11 * 60 * 1000);
  triggerVisibilityRefresh(shell);
  assert.match(progress.textContent, /Stale observations/);
  assert.doesNotMatch(progress.textContent, /Host string still says fresh/);
  freezeNow(NOW_MS);
  shell.remove();
});

test('clock refresh preserves open review confirmation and blocks expired snapshots', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild());
  clickAction(shell, 'review-batch');
  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  const confirm = dialog.querySelector('[data-review-confirm]');
  const start = dialog.querySelector('[data-action="confirm-start"]');
  const expiry = dialog.querySelector('[data-review-expiry]').textContent;

  confirm.checked = true;
  confirm.focus();
  confirm.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(start.disabled, false);

  freezeNow(NOW_MS + 6 * 60 * 1000);
  triggerVisibilityRefresh(shell);
  assert.equal(dialog.open, true);
  assert.equal(confirm.checked, true);
  assert.equal(dialog.querySelector('[data-review-expiry]').textContent, expiry);
  assert.equal(start.disabled, true);
  assert.match(dialog.textContent, /Confirmation snapshot has expired/i);
  freezeNow(NOW_MS);
  shell.remove();
});

test('visibility refresh re-ages stage gates when prerequisite evidence expires', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(
    InsprFlowShell,
    readyBuild({
      prerequisites: {
        requirementsBaseline: passGate({ freshUntil: '2026-09-07T12:10:00Z' }),
        deployArtifact: unknownGate({ gateKind: 'artifact' }),
        pharosTarget: passGate({
          gateKind: 'target_readiness',
          evidenceRef: 'evidence_pharos',
          readiness: 'preliminary',
          targetRef: 'target_prod',
        }),
        janusGate: unknownGate({ gateKind: 'access' }),
      },
    }),
  );
  clickAction(shell, 'stage', { stage: 0 });
  let dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  assert.doesNotMatch(dialog.textContent, /stale/i);
  dialog.close();
  freezeNow(NOW_MS + 11 * 60 * 1000);
  triggerVisibilityRefresh(shell);
  clickAction(shell, 'stage', { stage: 0 });
  dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  assert.match(dialog.textContent, /stale/i);
  freezeNow(NOW_MS);
  shell.remove();
});

test('disconnect clears clock aging and reconnect still refreshes on visibility', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(
    InsprFlowShell,
    readyBuild({
      progress: {
        taskLabel: 'Current task',
        overallLabel: 'Overall',
        task: {
          progress: {
            status: 'in_progress',
            percent_complete: 10,
            freshness: 'fresh',
            fresh_until: '2026-09-07T12:10:00Z',
          },
          forecast: { percent_complete: 10, estimated_finish: '2026-09-07T12:40:00Z' },
        },
      },
    }),
  );
  shell.remove();
  freezeNow(NOW_MS + 11 * 60 * 1000);
  triggerVisibilityRefresh(shell);
  document.body.appendChild(shell);
  const progress = shell.shadowRoot.querySelector('[data-shell-clock-progress]');
  triggerVisibilityRefresh(shell);
  assert.match(progress.textContent, /Stale observations/);
  freezeNow(NOW_MS);
  shell.remove();
});

test('host consumer can read and navigate without identity but cannot emit start', async () => {
  const InsprFlowShell = await loadFlowShell();
  const shell = mountShell(InsprFlowShell, readyBuild({ identityContext: null }));
  const intents = collectIntents(shell);
  clickAction(shell, 'stage', { stage: 1 });
  assert.equal(intents[0].type, INTENT_TYPES.NAVIGATE_STAGE);
  clickAction(shell, 'review-batch');
  const dialog = shell.shadowRoot.querySelector('dialog[data-shell-dialog]');
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /No host identity context/i);
  const confirm = dialog.querySelector('[data-review-confirm]');
  const start = dialog.querySelector('[data-action="confirm-start"]');
  confirm.checked = true;
  confirm.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(start.disabled, true);
  start.click();
  assert.equal(intents.some((intent) => intent.type === INTENT_TYPES.START_INTENT), false);
});
