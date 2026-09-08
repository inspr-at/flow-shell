import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSERVATIVE_FALLBACK_ETA_MINUTES,
  formatFreshnessLabel,
  formatProgressLine,
  isStaleSnapshot,
} from '../src/forecast.js';
import { NOW_MS, snapshot } from './helpers.js';

test('typed forecast percent and ETA are rendered when observation is missing', () => {
  const line = formatProgressLine(snapshot(), { now: NOW_MS });
  assert.match(line, /40%/);
  assert.match(line, /ETA ~40 min/);
  assert.match(line, /educated guess/);
  assert.match(line, /work breakdown/);
  assert.match(line, /forecast/);
  assert.match(line, /observed percent missing/);
});

test('stale observation still shows forecast ETA and stops claiming live measurement', () => {
  const stale = snapshot(
    {
      percent_complete: 60,
      eta: null,
      freshness: 'stale',
      fresh_until: '2026-09-07T11:50:00Z',
      basis: { kind: 'task_assessment', evidence_ref: 'evidence_1' },
    },
    {
      percent_complete: 60,
      estimated_finish: '2026-09-07T12:20:00Z',
      kind: 'worker_estimate',
      basis: { kind: 'worker_assessment', evidence_ref: 'evidence_forecast' },
    },
  );
  const line = formatProgressLine(stale, { now: NOW_MS });
  assert.match(line, /60%/);
  assert.match(line, /ETA ~20 min/);
  assert.match(line, /stale observation/);
  assert.match(line, /worker estimate/);
  assert.equal(isStaleSnapshot(stale, NOW_MS), true);
});

test('freshness ages from fresh_until even when the string still says fresh', () => {
  const aged = snapshot({
    freshness: 'fresh',
    fresh_until: '2026-09-07T11:59:00Z',
    percent_complete: 10,
  });
  assert.equal(isStaleSnapshot(aged, NOW_MS), true);
  assert.match(formatFreshnessLabel(aged.progress, NOW_MS), /Stale/);
  assert.match(formatProgressLine(aged, { now: NOW_MS }), /stale observation/);
});

test('missing snapshot still prints conservative fallback percent and numeric ETA', () => {
  const line = formatProgressLine(null, { now: NOW_MS });
  assert.match(line, /0%/);
  assert.match(line, new RegExp(`ETA ~${CONSERVATIVE_FALLBACK_ETA_MINUTES} min conservative fallback`));
  assert.match(line, /conservative fallback/);
  assert.doesNotMatch(line, /ETA unavailable/);
  assert.doesNotMatch(line, /^missing telemetry$/);
});

test('missing forecast finish still prints conservative fallback numeric ETA', () => {
  const line = formatProgressLine(
    snapshot({ percent_complete: 10 }, { estimated_finish: null, percent_complete: null }),
    { now: NOW_MS },
  );
  assert.match(line, /0%/);
  assert.match(line, new RegExp(`ETA ~${CONSERVATIVE_FALLBACK_ETA_MINUTES} min conservative fallback`));
  assert.doesNotMatch(line, /ETA unavailable/);
});

test('forecast 100 percent is never treated as completion', () => {
  const line = formatProgressLine(
    snapshot(
      { status: 'in_progress', percent_complete: 80, eta: null },
      {
        percent_complete: 100,
        estimated_finish: '2026-09-07T12:00:00Z',
        kind: 'educated_guess',
      },
    ),
    { now: NOW_MS },
  );
  assert.match(line, /100%/);
  assert.match(line, /guess is not completion/);
  assert.doesNotMatch(line, /observed done/);
});

test('evidenced done observation is labelled observed done, not an unknown completion', () => {
  const line = formatProgressLine(
    snapshot(
      {
        status: 'done',
        percent_complete: 100,
        eta: null,
        basis: { kind: 'observed_work', evidence_ref: 'evidence_done' },
      },
      {
        percent_complete: 100,
        estimated_finish: '2026-09-07T12:00:00Z',
        kind: 'worker_estimate',
        basis: { kind: 'worker_assessment', evidence_ref: 'evidence_done_forecast' },
      },
    ),
    { now: NOW_MS },
  );
  assert.match(line, /observed done/);
  assert.doesNotMatch(line, /guess is not completion/);
  assert.doesNotMatch(line, /unknown completion/);
});
