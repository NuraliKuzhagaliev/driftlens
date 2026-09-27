import test from 'node:test';
import assert from 'node:assert/strict';
import { previewEnvExample, previewCompose, buildPreview, applyPreview } from '../app/repair.js';

// ── Shared fixtures ────────────────────────────────────────────────────────────

const ENV_BROKEN = 'DATABASE_URL=<set-me>\nPORT=8080\n';
const COMPOSE_BROKEN = [
  'services:',
  '  checkout:',
  '    build: .',
  '    environment:',
  '      DATABASE_URL: ${DATABASE_URL}',
  '      PORT: ${PORT:-8080}',
].join('\n');

const PAYMENT_BLOCKER_ENV = {
  severity: 'BLOCKER', key: 'PAYMENT_API_KEY',
  location: '.env.example', title: 'PAYMENT_API_KEY is absent from setup instructions',
  why: 'A developer cannot configure this key.', fix: 'Add PAYMENT_API_KEY=<set-me> to .env.example.',
};
const PAYMENT_BLOCKER_COMPOSE = {
  severity: 'BLOCKER', key: 'PAYMENT_API_KEY',
  location: 'compose.yaml', title: 'PAYMENT_API_KEY is absent from deployment',
  why: 'Container starts without this value.', fix: 'Add PAYMENT_API_KEY: ${PAYMENT_API_KEY} to environment.',
};
const WARN_ONLY = {
  severity: 'WARN', key: 'UNUSED_KEY',
  location: 'app source', title: 'UNUSED_KEY is required but unused',
  why: 'Unused.', fix: 'Remove or wire it.',
};

// ── previewEnvExample ─────────────────────────────────────────────────────────

test('previewEnvExample: adds missing key to the preview', () => {
  const { lines, text } = previewEnvExample(ENV_BROKEN, [PAYMENT_BLOCKER_ENV]);
  assert.deepEqual(lines, ['PAYMENT_API_KEY=<set-me>']);
  assert.ok(text.includes('PAYMENT_API_KEY=<set-me>'));
  assert.ok(text.startsWith(ENV_BROKEN.trimEnd()));
});

test('previewEnvExample: no changes when there are no matching blockers', () => {
  const { lines, text } = previewEnvExample(ENV_BROKEN, [WARN_ONLY]);
  assert.deepEqual(lines, []);
  assert.equal(text, ENV_BROKEN);
});

test('previewEnvExample: ignores BLOCKER for compose.yaml location', () => {
  const { lines } = previewEnvExample(ENV_BROKEN, [PAYMENT_BLOCKER_COMPOSE]);
  assert.deepEqual(lines, []);
});

test('previewEnvExample: does not add PAYMENT_API_KEY when findings list is empty (unrelated project)', () => {
  const { lines } = previewEnvExample('SOMETHING_ELSE=<set-me>\n', []);
  assert.deepEqual(lines, []);
});

// ── previewCompose ────────────────────────────────────────────────────────────

test('previewCompose: adds missing key line after environment:', () => {
  const result = previewCompose(COMPOSE_BROKEN, [PAYMENT_BLOCKER_COMPOSE]);
  assert.ok(!result.error, `unexpected error: ${result.error}`);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].key, 'PAYMENT_API_KEY');
  assert.ok(result.text.includes('PAYMENT_API_KEY: ${PAYMENT_API_KEY}'));
});

test('previewCompose: no changes when there are no matching blockers', () => {
  const result = previewCompose(COMPOSE_BROKEN, [WARN_ONLY]);
  assert.ok(!result.error);
  assert.deepEqual(result.changes, []);
  assert.equal(result.text, COMPOSE_BROKEN);
});

test('previewCompose: returns error when environment: block is absent', () => {
  const noEnvBlock = 'services:\n  checkout:\n    build: .\n';
  const result = previewCompose(noEnvBlock, [PAYMENT_BLOCKER_COMPOSE]);
  assert.ok(result.error);
  assert.ok(!result.text);
});

test('previewCompose: ignores BLOCKER for .env.example location', () => {
  const result = previewCompose(COMPOSE_BROKEN, [PAYMENT_BLOCKER_ENV]);
  assert.deepEqual(result.changes, []);
});

test('previewCompose: does not add PAYMENT_API_KEY when findings list is empty (unrelated project)', () => {
  const result = previewCompose(COMPOSE_BROKEN, []);
  assert.deepEqual(result.changes, []);
});

// ── buildPreview ──────────────────────────────────────────────────────────────

test('buildPreview: hasChanges=true when both files need repair', () => {
  const preview = buildPreview(
    { example: ENV_BROKEN, deployment: COMPOSE_BROKEN },
    [PAYMENT_BLOCKER_ENV, PAYMENT_BLOCKER_COMPOSE],
  );
  assert.equal(preview.hasChanges, true);
  assert.deepEqual(preview.envChanges, ['PAYMENT_API_KEY=<set-me>']);
  assert.deepEqual(preview.composeChanges, ['PAYMENT_API_KEY: ${PAYMENT_API_KEY}']);
  assert.equal(preview.composeError, null);
  assert.ok(preview.newExample.includes('PAYMENT_API_KEY=<set-me>'));
  assert.ok(preview.newDeployment.includes('PAYMENT_API_KEY: ${PAYMENT_API_KEY}'));
});

test('buildPreview: hasChanges=false when no blockers match (unrelated project, cancel scenario)', () => {
  const preview = buildPreview(
    { example: ENV_BROKEN, deployment: COMPOSE_BROKEN },
    [WARN_ONLY],
  );
  assert.equal(preview.hasChanges, false);
  assert.deepEqual(preview.envChanges, []);
  assert.deepEqual(preview.composeChanges, []);
  assert.equal(preview.newExample, ENV_BROKEN);
  assert.equal(preview.newDeployment, COMPOSE_BROKEN);
});

test('buildPreview: exposes composeError when environment: block is absent', () => {
  const noEnvBlock = 'services:\n  checkout:\n    build: .\n';
  const preview = buildPreview(
    { example: ENV_BROKEN, deployment: noEnvBlock },
    [PAYMENT_BLOCKER_ENV, PAYMENT_BLOCKER_COMPOSE],
  );
  assert.ok(preview.composeError);
  // env changes are still computed independently
  assert.deepEqual(preview.envChanges, ['PAYMENT_API_KEY=<set-me>']);
  // deployment is left unchanged when compose repair cannot be applied
  assert.equal(preview.newDeployment, noEnvBlock);
});

// ── applyPreview (confirm) ────────────────────────────────────────────────────

test('applyPreview: returns new state with updated files on confirm', () => {
  const state = { contract: '{}', source: 'src', example: ENV_BROKEN, deployment: COMPOSE_BROKEN };
  const preview = buildPreview(state, [PAYMENT_BLOCKER_ENV, PAYMENT_BLOCKER_COMPOSE]);
  const newState = applyPreview(state, preview);
  // Files changed
  assert.ok(newState.example.includes('PAYMENT_API_KEY=<set-me>'));
  assert.ok(newState.deployment.includes('PAYMENT_API_KEY: ${PAYMENT_API_KEY}'));
  // Other state keys preserved
  assert.equal(newState.contract, '{}');
  assert.equal(newState.source, 'src');
  // Original state is not mutated
  assert.equal(state.example, ENV_BROKEN);
  assert.equal(state.deployment, COMPOSE_BROKEN);
});

test('applyPreview: original state unchanged on cancel (preview discarded, state not applied)', () => {
  const state = { contract: '{}', source: 'src', example: ENV_BROKEN, deployment: COMPOSE_BROKEN };
  const preview = buildPreview(state, [PAYMENT_BLOCKER_ENV, PAYMENT_BLOCKER_COMPOSE]);
  // Simulating cancel: just don't call applyPreview — verify original state is intact
  assert.equal(state.example, ENV_BROKEN);
  assert.equal(state.deployment, COMPOSE_BROKEN);
  // If we did apply, new state should differ — round-trip check
  const newState = applyPreview(state, preview);
  assert.notEqual(newState.example, state.example);
  assert.notEqual(newState.deployment, state.deployment);
});

test('applyPreview: does not add PAYMENT_API_KEY to an unrelated project with no matching blockers', () => {
  const unrelatedState = {
    contract: '{}', source: '',
    example: 'REDIS_URL=<set-me>\n',
    deployment: 'services:\n  web:\n    environment:\n      REDIS_URL: ${REDIS_URL}\n',
  };
  // findings from unrelated project — no PAYMENT_API_KEY blockers
  const preview = buildPreview(unrelatedState, []);
  const newState = applyPreview(unrelatedState, preview);
  assert.ok(!newState.example.includes('PAYMENT_API_KEY'));
  assert.ok(!newState.deployment.includes('PAYMENT_API_KEY'));
  assert.equal(newState.example, unrelatedState.example);
  assert.equal(newState.deployment, unrelatedState.deployment);
});

// ── Repaired sample reaches READY (integration smoke) ────────────────────────

test('repaired sample: applying preview to broken fixtures produces READY gate (integration)', async () => {
  // Dynamically import analyze so this test also exercises the real analysis path
  const { analyze } = await import('../app/core.js');
  const contract = JSON.stringify({ service: 'checkout-api', required: ['DATABASE_URL', 'PAYMENT_API_KEY', 'PORT'] });
  const source = 'import os\nkey = os.getenv("PAYMENT_API_KEY")\nurl = os.environ["DATABASE_URL"]\nport = os.getenv("PORT")';

  const state = { contract, source, example: ENV_BROKEN, deployment: COMPOSE_BROKEN };
  const report = analyze(state);
  assert.equal(report.status, 'HOLD');

  const preview = buildPreview(state, report.findings);
  assert.equal(preview.hasChanges, true);

  const newState = applyPreview(state, preview);
  const newReport = analyze(newState);
  assert.equal(newReport.status, 'READY');
  assert.equal(newReport.metrics.blockers, 0);
});
