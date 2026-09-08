import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromDeliveryContract, ADAPTER_BOUNDARY, deriveActiveWork, stageForOperation } from '../src/adapter.js';
import { deliveryValidDir } from './fixture-paths.js';
import { formatProgressLine } from '../src/forecast.js';
import { buildStagePresentation, canEmitStartIntent, getStageGate } from '../src/gates.js';
import { STAGES } from '../src/stages.js';
import { withIdentityContext } from '../src/state.js';
import { DIGEST_A, DIGEST_B, NOW_ISO, NOW_MS, identityContextAt } from './helpers.js';

function withHostIdentity(shell, nowIso = NOW_ISO) {
  return withIdentityContext(shell, identityContextAt(nowIso));
}

function contractFixture(overrides = {}) {
  return {
    contract_version: 'inspr.delivery-stream/0.1-draft',
    evaluated_at: NOW_ISO,
    stream: { stream_ref: 'stream_sample', project_kinds: ['iteration'] },
    parties: [],
    requirements_baselines: [
      {
        baseline_ref: 'baseline_7',
        revision: 7,
        content_digest: DIGEST_A,
        approved_by: 'party_customer',
        approved_at: '2026-09-07T09:00:00Z',
        requirements: [
          {
            requirement_ref: 'req_1',
            statement: 'Preview change',
            acceptance_criteria: ['visible'],
            constraint_refs: [],
          },
        ],
        constraints: [],
      },
    ],
    targets: [
      {
        target_ref: 'target_dev',
        kind: 'development',
        readiness: 'ready',
        observed_at: '2026-09-07T11:55:00Z',
        evidence_ref: 'evidence_dev',
      },
      {
        target_ref: 'target_prod',
        kind: 'deployment',
        readiness: overrides.deploymentReadiness ?? 'preliminary',
        observed_at: '2026-09-07T11:55:00Z',
        evidence_ref: 'evidence_prod',
      },
    ],
    accounts: [],
    workers: [],
    harnesses: [],
    batches: [
      {
        batch_ref: 'batch_42',
        status: 'authorized',
        baseline: { baseline_ref: 'baseline_7', content_digest: DIGEST_A },
        scope: { requirement_refs: ['req_1'], constraint_refs: [], task_refs: ['task_build'] },
        tasks: [
          {
            task_ref: 'task_build',
            requirement_refs: ['req_1'],
            operation: 'build',
            target_ref: null,
            status: 'pending',
            completion_evidence_ref: null,
          },
        ],
        operating_mode: 'customer_operated',
        responsibilities: {
          delivery_party_ref: 'party_delivery',
          operator_party_ref: 'party_customer',
          support_party_ref: null,
        },
        authorization: {
          authorization_ref: 'auth_1',
          decision: 'start',
          selected_by: 'party_customer',
          selected_at: '2026-09-07T10:00:00Z',
          baseline: { baseline_ref: 'baseline_7', content_digest: DIGEST_A },
          autonomy_mode: 'manual',
          authority_scope: { scope_ref: 'scope_1', statement: 'bounded' },
        },
        assignments: [],
        prerequisite_gates: [
          {
            gate_ref: 'gate_req',
            gate_class: 'technical',
            gate_kind: 'requirements_baseline',
            target_ref: null,
            affected_task_refs: ['task_build'],
            status: 'pass',
            observed_at: '2026-09-07T11:55:00Z',
            evidence_ref: 'evidence_req',
          },
          {
            gate_ref: 'gate_target',
            gate_class: 'technical',
            gate_kind: 'target_readiness',
            target_ref: 'target_prod',
            affected_task_refs: ['task_build'],
            status: 'pass',
            observed_at: '2026-09-07T11:55:00Z',
            evidence_ref: 'evidence_target',
          },
        ],
      },
    ],
    progress_reports: [
      {
        report_ref: 'progress_42',
        batch_ref: 'batch_42',
        overall: {
          progress: {
            status: 'unknown',
            percent_complete: null,
            eta: null,
            basis: { kind: 'unknown', evidence_ref: null },
            reporter: { kind: 'system', reporter_ref: 'reporter_orchestrator' },
            reported_at: NOW_ISO,
            fresh_until: '2026-09-07T12:10:00Z',
            freshness: 'fresh',
          },
          forecast: {
            percent_complete: 25,
            estimated_finish: '2026-09-07T12:55:00Z',
            kind: 'educated_guess',
            as_of: NOW_ISO,
            basis: { kind: 'work_breakdown', evidence_ref: 'evidence_overall_forecast' },
            conditional_on: null,
            previous_target: null,
          },
        },
        tasks: [
          {
            task_ref: 'task_build',
            progress: {
              status: 'pending',
              percent_complete: null,
              eta: null,
              basis: { kind: 'unknown', evidence_ref: null },
              reporter: { kind: 'worker', reporter_ref: 'worker_builder' },
              reported_at: NOW_ISO,
              fresh_until: '2026-09-07T12:10:00Z',
              freshness: 'fresh',
            },
            forecast: {
              percent_complete: 15,
              estimated_finish: '2026-09-07T12:45:00Z',
              kind: 'worker_estimate',
              as_of: NOW_ISO,
              basis: { kind: 'worker_assessment', evidence_ref: 'evidence_task_forecast' },
              conditional_on: null,
              previous_target: null,
            },
          },
        ],
      },
    ],
    releases: overrides.releases ?? [],
    acceptances: [],
    advisory_risks: [],
  };
}

test('adapter boundary documents read-only scope', () => {
  assert.match(ADAPTER_BOUNDARY.scope, /display and gating hints/i);
  assert.match(ADAPTER_BOUNDARY.notIncluded, /JSON Schema validation/i);
  assert.match(ADAPTER_BOUNDARY.notIncluded, /host identity context/i);
});

test('fromDeliveryContract does not treat parties as runtime identity', () => {
  const shell = fromDeliveryContract(contractFixture(), { batchRef: 'batch_42' });
  assert.equal(shell.identity.status, 'absent');
});

test('fromDeliveryContract maps batch refs, baseline digest, and typed forecasts', () => {
  const shell = fromDeliveryContract(contractFixture(), { batchRef: 'batch_42' });
  assert.equal(shell.delivery.batchRef, 'batch_42');
  assert.equal(shell.delivery.baselineDigest, DIGEST_A);
  assert.equal(shell.prerequisites.requirementsBaseline.observedAt, '2026-09-07T11:55:00Z');
  assert.equal(shell.prerequisites.requirementsBaseline.evidenceRef, 'evidence_req');
  assert.equal(shell.prerequisites.requirementsBaseline.gateKind, 'requirements_baseline');
  assert.equal(shell.progress.overall.forecast.percent_complete, 25);
  assert.equal(shell.progress.overall.forecast.estimated_finish, '2026-09-07T12:55:00Z');
  assert.equal(shell.progress.task.forecast.kind, 'worker_estimate');
  const line = formatProgressLine(shell.progress.overall, { now: NOW_MS });
  assert.match(line, /25%/);
  assert.match(line, /ETA/i);
  assert.match(line, /educated guess/);
});

test('adapter does not treat target_readiness or missing releases as artifact evidence', () => {
  const shell = withHostIdentity(fromDeliveryContract(contractFixture(), { batchRef: 'batch_42' }));
  assert.equal(shell.prerequisites.deployArtifact.status, 'unknown');
  const deploy = canEmitStartIntent(shell, {
    confirmed: true,
    executionMode: 'manual',
    action: 'deploy',
    now: NOW_MS,
  });
  assert.equal(deploy.allowed, false);
  const build = canEmitStartIntent(shell, {
    confirmed: true,
    executionMode: 'manual',
    action: 'build',
    now: NOW_MS,
  });
  assert.equal(build.allowed, true);
});

test('adapter maps release artifacts and ready targets for deploy/apply gates', () => {
  const fixture = contractFixture({
    deploymentReadiness: 'ready',
    releases: [
      {
        release_ref: 'release_42',
        batch_ref: 'batch_42',
        state: 'built',
        created_at: '2026-09-07T11:58:00Z',
        artifacts: [
          {
            artifact_ref: 'artifact_web_42',
            digest: DIGEST_B,
            provenance: {
              origin: 'imported',
              producing_task_ref: null,
              import_receipt_ref: 'receipt_existing_42',
              observed_at: '2026-09-07T11:58:00Z',
              evidence_ref: 'evidence_import_42',
            },
          },
        ],
      },
    ],
  });
  fixture.batches[0].tasks.push({
    task_ref: 'task_deploy',
    requirement_refs: ['req_1'],
    operation: 'deploy',
    target_ref: 'target_prod',
    status: 'pending',
    completion_evidence_ref: null,
  });
  fixture.batches[0].prerequisite_gates.push({
    gate_ref: 'gate_access',
    gate_class: 'authority',
    gate_kind: 'access',
    target_ref: 'target_prod',
    affected_task_refs: ['task_build'],
    status: 'pass',
    observed_at: '2026-09-07T11:55:00Z',
    evidence_ref: 'evidence_access',
  });
  const shell = fromDeliveryContract(fixture, { batchRef: 'batch_42' });
  assert.equal(shell.prerequisites.deployArtifact.status, 'pass');
  assert.equal(shell.prerequisites.deployArtifact.evidenceRef, 'evidence_import_42');
  assert.equal(shell.prerequisites.deployArtifact.digest, DIGEST_B);
  assert.equal(shell.prerequisites.deployArtifact.observedAt, '2026-09-07T11:58:00Z');
  assert.notEqual(shell.prerequisites.deployArtifact.observedAt, fixture.evaluated_at);
  assert.equal(shell.prerequisites.deployArtifact.origin, 'imported');
  assert.equal(shell.prerequisites.pharosTarget.readiness, 'ready');
  const deliver = getStageGate(2, shell, { now: NOW_MS });
  assert.equal(deliver.explorable, true);
  assert.deepEqual(deliver.allowedActions, ['deploy', 'verify']);
});

const VALID_FIXTURES = deliveryValidDir();

function loadValidContract(name) {
  return JSON.parse(readFileSync(join(VALID_FIXTURES, name), 'utf8'));
}

function mapped(name, batchRef) {
  return fromDeliveryContract(loadValidContract(name), { batchRef });
}

function etaMinutes(snapshot, now) {
  const finish = snapshot?.forecast?.estimated_finish;
  if (!finish) return null;
  return Math.round((Date.parse(finish) - now) / 60000);
}

test('adapter refuses a wrong requested batch id instead of selecting another batch', () => {
  const contract = loadValidContract('canonical-stream.json');
  contract.batches.push({
    ...contract.batches[0],
    batch_ref: 'batch_other',
  });
  assert.equal(fromDeliveryContract(contract, { batchRef: 'batch_42' }).delivery.batchRef, 'batch_42');
  assert.throws(
    () => fromDeliveryContract(contract, { batchRef: 'batch_does_not_exist' }),
    /batch_does_not_exist/,
  );
  assert.notEqual(fromDeliveryContract(contract, { batchRef: 'batch_42' }).delivery.batchRef, 'batch_other');
});

test('validated fixtures map manual, Pharos deploy/verify, Paimos test, and Janus prep/apply', () => {
  const manual = mapped('manual-human-assignment.json', 'batch_advisory');
  assert.equal(manual.delivery.batchRef, 'batch_advisory');
  assert.equal(manual.delivery.baselineRef, 'baseline_advisory');
  assert.equal(manual.delivery.activeStage, 0);
  assert.equal(manual.delivery.activeOperation, 'requirements');
  assert.equal(manual.selectedExecutionMode, 'manual');
  assert.equal(manual.prerequisites.deployArtifact.status, 'unknown');

  const testWork = mapped('active-paimos-test.json', 'batch_test');
  assert.equal(testWork.delivery.activeStage, 1);
  assert.equal(testWork.delivery.activeOperation, 'test');
  assert.equal(testWork.selectedAction, 'test');
  assert.equal(STAGES[testWork.delivery.activeStage].product, 'Paimos');

  const deploy = mapped('active-pharos-deploy.json', 'batch_deploy');
  const deployNow = Date.parse(loadValidContract('active-pharos-deploy.json').evaluated_at);
  assert.equal(deploy.delivery.batchRef, 'batch_deploy');
  assert.equal(deploy.delivery.baselineDigest, loadValidContract('active-pharos-deploy.json').batches[0].baseline.content_digest);
  assert.equal(deploy.delivery.activeStage, 2);
  assert.equal(deploy.delivery.activeOperation, 'deploy');
  assert.equal(deploy.delivery.activeTaskRef, 'task_deploy');
  assert.equal(deploy.selectedAction, 'deploy');
  assert.equal(STAGES[deploy.delivery.activeStage].product, 'Pharos');
  assert.equal(deploy.prerequisites.pharosTarget.targetRef, 'target_prod_ready');
  assert.equal(deploy.prerequisites.pharosTarget.readiness, 'ready');
  assert.equal(deploy.prerequisites.deployArtifact.evidenceRef, 'evidence_artifact_observe_42');
  assert.equal(
    deploy.prerequisites.deployArtifact.digest,
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  );
  assert.equal(etaMinutes(deploy.progress.task, deployNow), 20);
  assert.equal(etaMinutes(deploy.progress.overall, deployNow), 25);
  const deployLine = formatProgressLine(deploy.progress.task, { now: deployNow });
  assert.match(deployLine, /ETA ~20 min/);
  assert.equal(getStageGate(2, deploy, { now: deployNow }).gated, false);

  const verify = mapped('active-pharos-verify.json', 'batch_verify');
  assert.equal(verify.delivery.activeStage, 2);
  assert.equal(verify.delivery.activeOperation, 'verify');
  assert.equal(verify.selectedAction, 'verify');
  assert.equal(verify.selectedExecutionMode, 'assisted');
  assert.equal(verify.prerequisites.deployArtifact.evidenceRef, 'evidence_artifact_observe_42');
  assert.equal(STAGES[verify.delivery.activeStage].product, 'Pharos');

  const prepare = mapped('preliminary-target-preparation.json', 'batch_prepare');
  const prepareNow = Date.parse(loadValidContract('preliminary-target-preparation.json').evaluated_at);
  assert.equal(prepare.delivery.activeStage, 3);
  assert.equal(prepare.delivery.activeOperation, 'janus_prepare');
  assert.equal(prepare.selectedAction, 'janus_prepare');
  assert.equal(prepare.prerequisites.pharosTarget.readiness, 'preliminary');
  assert.equal(prepare.prerequisites.pharosTarget.targetRef, 'target_preliminary');
  assert.equal(STAGES[prepare.delivery.activeStage].product, 'Janus');
  assert.equal(etaMinutes(prepare.progress.task, prepareNow), 20);
  assert.equal(etaMinutes(prepare.progress.overall, prepareNow), 30);

  const apply = mapped('ready-janus-apply.json', 'batch_apply');
  assert.equal(apply.delivery.activeStage, 3);
  assert.equal(apply.delivery.activeOperation, 'apply');
  assert.equal(apply.selectedAction, 'janus_apply');
  assert.equal(apply.prerequisites.pharosTarget.readiness, 'ready');
  assert.equal(apply.prerequisites.janusGate.status, 'pass');
  assert.equal(apply.prerequisites.janusGate.evidenceRef, 'evidence_access_gate_42');
  assert.equal(STAGES[apply.delivery.activeStage].product, 'Janus');
});

test('active or blocked work is selected before completed prerequisite tasks', () => {
  const deploy = loadValidContract('active-pharos-deploy.json');
  const work = deriveActiveWork(deploy.batches[0]);
  assert.equal(work.operation, 'deploy');
  assert.equal(work.task.task_ref, 'task_deploy');
  assert.equal(work.stage, 2);
  assert.equal(stageForOperation('test'), 1);
  assert.equal(stageForOperation('build'), 1);

  const mixed = {
    status: 'in_progress',
    tasks: [
      { task_ref: 'task_apply_done', operation: 'apply', status: 'done' },
      { task_ref: 'task_test_active', operation: 'test', status: 'in_progress' },
    ],
  };
  const selected = deriveActiveWork(mixed);
  assert.equal(selected.operation, 'test');
  assert.equal(selected.stage, 1);

  const blocked = {
    status: 'blocked',
    tasks: [
      { task_ref: 'task_build_done', operation: 'build', status: 'done' },
      { task_ref: 'task_verify_blocked', operation: 'verify', status: 'blocked' },
    ],
  };
  assert.equal(deriveActiveWork(blocked).operation, 'verify');
});

test('adapter keeps exact artifact and target refs and does not invent another', () => {
  const contract = loadValidContract('active-pharos-deploy.json');
  contract.targets.push({
    target_ref: 'target_other_ready',
    kind: 'deployment',
    readiness: 'live',
    observed_at: '2026-09-07T09:06:00Z',
    fresh_until: '2026-09-07T13:00:00Z',
    evidence_ref: 'evidence_other',
  });
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_deploy' });
  assert.equal(shell.prerequisites.pharosTarget.targetRef, 'target_prod_ready');
  assert.notEqual(shell.prerequisites.pharosTarget.targetRef, 'target_other_ready');
  assert.equal(shell.prerequisites.deployArtifact.evidenceRef, 'evidence_artifact_observe_42');
  assert.notEqual(shell.prerequisites.deployArtifact.evidenceRef, 'artifact_web_other');
  assert.equal(shell.prerequisites.deployArtifact.observedAt, '2026-09-07T12:12:00Z');
  assert.notEqual(shell.prerequisites.deployArtifact.observedAt, contract.evaluated_at);
});

test('explicit empty, null, or invalid batchRef refuses instead of selecting the last batch', () => {
  const contract = loadValidContract('canonical-stream.json');
  contract.batches.push({
    ...contract.batches[0],
    batch_ref: 'batch_other',
  });
  assert.equal(fromDeliveryContract(contract).delivery.batchRef, 'batch_other');
  assert.throws(() => fromDeliveryContract(contract, { batchRef: '' }), /batch not found/);
  assert.throws(() => fromDeliveryContract(contract, { batchRef: null }), /batch not found/);
  assert.throws(() => fromDeliveryContract(contract, { batchRef: 'batch 42!!' }), /batch not found/);
});

test('completed build/test batch stays on Paimos and does not mark unused stages performed', () => {
  const shell = mapped('completed-paimos-build-test.json', 'batch_build_test');
  assert.equal(shell.delivery.status, 'completed');
  assert.equal(shell.delivery.activeStage, 1);
  assert.equal(shell.delivery.activeOperation, 'test');
  assert.equal(STAGES[shell.delivery.activeStage].product, 'Paimos');
  assert.deepEqual(shell.delivery.stageEvidence, ['performed', 'performed', 'not_in_batch', 'not_in_batch']);
  const define = buildStagePresentation(0, shell, 1, { now: NOW_MS });
  const build = buildStagePresentation(1, shell, 1, { now: NOW_MS });
  const deliver = buildStagePresentation(2, shell, 1, { now: NOW_MS });
  const access = buildStagePresentation(3, shell, 1, { now: NOW_MS });
  assert.equal(define.done, true);
  assert.equal(build.done, true);
  assert.equal(deliver.done, false);
  assert.equal(deliver.notInBatch, true);
  assert.equal(deliver.explorable, true);
  assert.match(deliver.ariaLabel, /not in this batch/i);
  assert.equal(access.done, false);
  assert.equal(access.notInBatch, true);
  assert.equal(access.explorable, true);
  assert.match(access.ariaLabel, /not in this batch/i);
});

test('completed task array order does not force a Janus stage', () => {
  const contract = loadValidContract('completed-paimos-build-test.json');
  contract.batches[0].tasks = [...contract.batches[0].tasks].reverse();
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.activeStage, 1);
  assert.equal(STAGES[shell.delivery.activeStage].product, 'Paimos');
  assert.notEqual(shell.delivery.activeOperation, 'apply');
  assert.deepEqual(shell.delivery.stageEvidence, ['performed', 'performed', 'not_in_batch', 'not_in_batch']);
});

test('canonical completed batch keeps unused Pharos stage not performed', () => {
  const shell = mapped('canonical-stream.json', 'batch_42');
  assert.equal(shell.delivery.activeStage, 3);
  assert.equal(shell.delivery.activeOperation, 'apply');
  assert.deepEqual(shell.delivery.stageEvidence, ['performed', 'performed', 'not_in_batch', 'performed']);
  const deliver = buildStagePresentation(2, shell, 3, { now: NOW_MS });
  assert.equal(deliver.done, false);
  assert.equal(deliver.notInBatch, true);
});

test('development target cannot populate a pass Pharos deployment gate', () => {
  const contract = loadValidContract('active-pharos-deploy.json');
  const bound = contract.targets.find((item) => item.target_ref === 'target_prod_ready');
  bound.kind = 'development';
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_deploy' });
  assert.equal(shell.prerequisites.pharosTarget.status, 'unknown');
  assert.equal(shell.prerequisites.pharosTarget.readiness, 'unknown');
  assert.match(shell.prerequisites.pharosTarget.message, /development target/i);
  assert.notEqual(shell.prerequisites.pharosTarget.status, 'pass');
  const deliver = getStageGate(2, shell, { now: Date.parse(contract.evaluated_at) });
  assert.equal(deliver.gated, true);
  assert.deepEqual(deliver.allowedActions, []);
});

test('imported artifact maps provenance observation and not document evaluated_at', () => {
  const contract = loadValidContract('imported-artifact-pharos-deploy.json');
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_imported' });
  assert.equal(shell.delivery.activeOperation, 'deploy');
  assert.equal(shell.prerequisites.deployArtifact.status, 'pass');
  assert.equal(shell.prerequisites.deployArtifact.origin, 'imported');
  assert.equal(shell.prerequisites.deployArtifact.importReceiptRef, 'receipt_vendor_web_42');
  assert.equal(shell.prerequisites.deployArtifact.observedAt, '2026-09-07T11:40:00Z');
  assert.notEqual(shell.prerequisites.deployArtifact.observedAt, contract.evaluated_at);
});

test('artifact identity without provenance or observation stays unknown', () => {
  const identityOnly = loadValidContract('active-pharos-deploy.json');
  delete identityOnly.artifacts[0].provenance;
  const missingTime = loadValidContract('active-pharos-deploy.json');
  missingTime.artifacts[0].provenance.observed_at = null;
  for (const contract of [identityOnly, missingTime]) {
    const shell = withHostIdentity(fromDeliveryContract(contract, { batchRef: 'batch_deploy' }), contract.evaluated_at);
    assert.equal(shell.prerequisites.deployArtifact.status, 'unknown');
    assert.equal(shell.prerequisites.deployArtifact.observedAt, null);
    assert.notEqual(shell.prerequisites.deployArtifact.observedAt, contract.evaluated_at);
    const start = canEmitStartIntent(shell, {
      confirmed: true,
      executionMode: 'automatic',
      action: 'deploy',
      now: Date.parse(contract.evaluated_at),
    });
    assert.equal(start.allowed, false);
  }
});

test('ready and live Janus preparation maps with prepare allowed', () => {
  const ready = mapped('ready-janus-prepare.json', 'batch_ready_prepare');
  const readyNow = Date.parse(loadValidContract('ready-janus-prepare.json').evaluated_at);
  assert.equal(ready.delivery.activeOperation, 'janus_prepare');
  assert.equal(ready.prerequisites.pharosTarget.readiness, 'ready');
  const readyGate = getStageGate(3, ready, { now: readyNow });
  assert.ok(readyGate.allowedActions.includes('janus_prepare'));
  assert.equal(readyGate.explorable, true);

  const liveContract = loadValidContract('ready-janus-prepare.json');
  liveContract.targets.find((item) => item.kind === 'deployment').readiness = 'live';
  const live = fromDeliveryContract(liveContract, { batchRef: 'batch_ready_prepare' });
  const liveGate = getStageGate(3, live, { now: readyNow });
  assert.ok(liveGate.allowedActions.includes('janus_prepare'));
});

test('pending planned deploy without artifact stays a valid mapped draft that cannot start deploy', () => {
  const contract = loadValidContract('pending-pharos-deploy.json');
  const shell = withHostIdentity(fromDeliveryContract(contract, { batchRef: 'batch_pending_deploy' }), contract.evaluated_at);
  assert.equal(shell.delivery.status, 'draft');
  assert.equal(shell.prerequisites.deployArtifact.status, 'unknown');
  const deploy = canEmitStartIntent(shell, {
    confirmed: true,
    executionMode: 'automatic',
    action: 'deploy',
    now: Date.parse(contract.evaluated_at),
  });
  assert.equal(deploy.allowed, false);
  assert.match(deploy.reasons.join(' '), /artifact/i);
});

test('dangling baseline_ref does not mark Define performed without a resolved baseline', () => {
  const contract = loadValidContract('completed-paimos-build-test.json');
  contract.batches[0].baseline.baseline_ref = 'baseline_missing';
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  const define = buildStagePresentation(0, shell, 1, { now: NOW_MS });
  assert.equal(define.done, false);
  assert.equal(define.unknown, true);
});

test('absent requirements_baseline gate keeps Define unknown even when baseline_ref matches', () => {
  const contract = loadValidContract('completed-paimos-build-test.json');
  contract.batches[0].prerequisite_gates = contract.batches[0].prerequisite_gates.filter(
    (gate) => gate.gate_kind !== 'requirements_baseline',
  );
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  const define = buildStagePresentation(0, shell, 1, { now: NOW_MS });
  assert.equal(define.done, false);
  assert.match(shell.prerequisites.requirementsBaseline.message, /not reported/i);
});

function contractWithRequirementsTask(overrides = {}) {
  const contract = loadValidContract('completed-paimos-build-test.json');
  const batch = contract.batches[0];
  batch.tasks.unshift({
    task_ref: 'task_requirements',
    requirement_refs: ['requirement_preview'],
    operation: 'requirements',
    target_ref: null,
    status: 'done',
    completion_evidence_ref: 'evidence_req_1',
    ...(overrides.task ?? {}),
  });
  batch.scope.task_refs.unshift('task_requirements');
  if (overrides.batch) Object.assign(batch, overrides.batch);
  if (overrides.gate) {
    const gate = batch.prerequisite_gates.find((item) => item.gate_kind === 'requirements_baseline');
    Object.assign(gate, overrides.gate);
  }
  return contract;
}

test('done requirements task with resolved baseline gate marks Define performed', () => {
  const shell = fromDeliveryContract(contractWithRequirementsTask(), { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'performed');
  const define = buildStagePresentation(0, shell, 1, { now: NOW_MS });
  assert.equal(define.done, true);
});

test('done requirements task cannot bypass dangling baseline_ref for Define performed', () => {
  const contract = contractWithRequirementsTask({
    batch: { baseline: { ...loadValidContract('completed-paimos-build-test.json').batches[0].baseline, baseline_ref: 'baseline_missing' } },
  });
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  const define = buildStagePresentation(0, shell, 1, { now: NOW_MS });
  assert.equal(define.done, false);
  assert.equal(define.unknown, true);
});

test('done requirements task cannot bypass baseline digest mismatch for Define performed', () => {
  const contract = contractWithRequirementsTask({
    batch: {
      baseline: {
        ...loadValidContract('completed-paimos-build-test.json').batches[0].baseline,
        content_digest: DIGEST_B,
      },
    },
  });
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  assert.equal(buildStagePresentation(0, shell, 1, { now: NOW_MS }).done, false);
});

test('done requirements task cannot bypass missing requirements_baseline gate', () => {
  const contract = contractWithRequirementsTask();
  contract.batches[0].prerequisite_gates = contract.batches[0].prerequisite_gates.filter(
    (gate) => gate.gate_kind !== 'requirements_baseline',
  );
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  assert.equal(buildStagePresentation(0, shell, 1, { now: NOW_MS }).done, false);
});

test('done requirements task cannot bypass missing gate evidence_ref', () => {
  const contract = contractWithRequirementsTask({ gate: { evidence_ref: null } });
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  assert.equal(buildStagePresentation(0, shell, 1, { now: NOW_MS }).done, false);
});

test('done requirements task cannot bypass future requirements gate observation', () => {
  const contract = contractWithRequirementsTask({ gate: { observed_at: '2099-01-01T00:00:00Z' } });
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  assert.equal(shell.prerequisites.requirementsBaseline.status, 'unknown');
  assert.equal(buildStagePresentation(0, shell, 1, { now: NOW_MS }).done, false);
});

test('pending requirements task cannot become Define performed from baseline gate alone', () => {
  const contract = contractWithRequirementsTask({
    task: { status: 'in_progress', completion_evidence_ref: null },
  });
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  assert.equal(buildStagePresentation(0, shell, 1, { now: NOW_MS }).done, false);
});

test('failed requirements task cannot become Define performed from baseline gate alone', () => {
  const contract = contractWithRequirementsTask({
    task: { status: 'failed', completion_evidence_ref: null },
  });
  const shell = fromDeliveryContract(contract, { batchRef: 'batch_build_test' });
  assert.equal(shell.delivery.stageEvidence[0], 'unknown');
  assert.equal(buildStagePresentation(0, shell, 1, { now: NOW_MS }).done, false);
});

test('missing provenance evidence_ref does not borrow artifact identity for deploy gates', () => {
  const contract = loadValidContract('active-pharos-deploy.json');
  delete contract.artifacts[0].provenance.evidence_ref;
  const shell = withHostIdentity(fromDeliveryContract(contract, { batchRef: 'batch_deploy' }), contract.evaluated_at);
  assert.equal(shell.prerequisites.deployArtifact.status, 'unknown');
  assert.equal(shell.prerequisites.deployArtifact.evidenceRef, null);
  const deploy = canEmitStartIntent(shell, {
    confirmed: true,
    executionMode: 'automatic',
    action: 'deploy',
    now: Date.parse(contract.evaluated_at),
  });
  assert.equal(deploy.allowed, false);
  assert.match(deploy.reasons.join(' '), /evidence reference is missing/i);
});

test('future artifact observed_at stays unknown in the adapter', () => {
  const contract = loadValidContract('active-pharos-deploy.json');
  contract.artifacts[0].provenance.observed_at = '2099-01-01T00:00:00Z';
  const shell = withHostIdentity(fromDeliveryContract(contract, { batchRef: 'batch_deploy' }), contract.evaluated_at);
  assert.equal(shell.prerequisites.deployArtifact.status, 'unknown');
  assert.equal(shell.prerequisites.deployArtifact.observedAt, null);
  const deploy = canEmitStartIntent(shell, {
    confirmed: true,
    executionMode: 'automatic',
    action: 'deploy',
    now: Date.parse(contract.evaluated_at),
  });
  assert.equal(deploy.allowed, false);
});

test('build/test-only batch does not borrow document deployment target readiness', () => {
  const shell = mapped('completed-paimos-build-test.json', 'batch_build_test');
  assert.equal(shell.prerequisites.pharosTarget.status, 'unknown');
  assert.equal(shell.prerequisites.pharosTarget.readiness, 'unknown');
  assert.match(shell.prerequisites.pharosTarget.message, /not reported for this batch/i);
  const deliver = buildStagePresentation(2, shell, 1, { now: NOW_MS });
  assert.equal(deliver.notInBatch, true);
  assert.equal(deliver.explorable, true);
  assert.equal(deliver.done, false);
});
