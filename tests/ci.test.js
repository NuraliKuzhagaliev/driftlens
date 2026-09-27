/**
 * CI integration tests for bin/ci-gate.js and the healthy fixtures.
 *
 * These tests cover:
 *   1. Healthy fixtures → exit 0 (READY)
 *   2. Healthy fixtures with a key removed from the contract → exit 2 (HOLD)
 *   3. Broken demo fixtures → exit 2 (HOLD) — they must remain broken
 *   4. GitHub Actions annotation format when GITHUB_ACTIONS=true
 *   5. JSON output for the healthy fixture set
 *   6. Error path (missing file, bad contract)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const GATE      = resolve(ROOT, 'bin', 'ci-gate.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Spawn ci-gate.js with the given extra arguments and optional extra env vars.
 * Always runs with cwd = repository root.
 */
function runGate(extraArgs = [], extraEnv = {}) {
  return spawnSync(
    process.execPath,
    [GATE, ...extraArgs],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    }
  );
}

/**
 * Write a temporary contract file containing `required` keys and return its path.
 * The temp directory is cleaned up by the OS; we do not bother with cleanup here.
 */
function writeTempContract(required) {
  const dir  = resolve(tmpdir(), `driftlens-ci-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'contract.json');
  writeFileSync(path, JSON.stringify({ service: 'test-svc', required }), 'utf8');
  return path;
}

// Paths for healthy fixtures
const HEALTHY = {
  source:     'fixtures/healthy/app.py',
  example:    'fixtures/healthy/.env.example',
  deployment: 'fixtures/healthy/compose.yaml',
  contract:   'fixtures/healthy/contract.json',
};

function healthyArgs(overrides = {}) {
  const merged = { ...HEALTHY, ...overrides };
  return [
    '--source',     merged.source,
    '--example',    merged.example,
    '--deployment', merged.deployment,
    '--contract',   merged.contract,
  ];
}

// ── 1. Healthy fixtures — green path ─────────────────────────────────────────

test('CI gate: healthy fixtures exit 0 (READY)', () => {
  const result = runGate(healthyArgs());
  assert.equal(result.status, 0,
    `Expected exit 0, got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /READY TO PROCEED/);
});

test('CI gate: healthy fixtures --json reports status READY with 0 blockers', () => {
  const result = runGate([...healthyArgs(), '--json']);
  assert.equal(result.status, 0,
    `Expected exit 0, got ${result.status}.\nstdout: ${result.stdout}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'READY');
  assert.equal(report.metrics.blockers, 0);
  assert.equal(report.findings.length, 0);
  assert.equal(report.metrics.required, 4, 'healthy contract has 4 required keys');
});

test('CI gate: healthy fixtures report covers all 4 required keys', () => {
  const result = runGate([...healthyArgs(), '--json']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.metrics.required, 4);
  assert.equal(report.metrics.documented, 4);
  assert.equal(report.metrics.deployed, 4);
});

// ── 2. Healthy fixtures — removing a required key causes HOLD ────────────────
//
// We replace the contract with one that adds a fifth key absent from all other
// files.  CI must fail (exit 2) and report blockers.

test('CI gate: exits 2 (HOLD) when a required key is absent from healthy .env.example', () => {
  // Add a new required key not present in any fixture file
  const contract = writeTempContract([
    'DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'API_SECRET_KEY',
    'MISSING_REQUIRED_KEY',  // intentionally absent everywhere else
  ]);
  const result = runGate(healthyArgs({ contract }));
  assert.equal(result.status, 2,
    `Expected exit 2, got ${result.status}.\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /HOLD RELEASE/);
  assert.match(result.stdout, /MISSING_REQUIRED_KEY/);
});

test('CI gate: blockers include both .env.example and compose.yaml when key is fully absent', () => {
  const contract = writeTempContract([
    'DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'API_SECRET_KEY', 'MISSING_REQUIRED_KEY',
  ]);
  const result = runGate([...healthyArgs({ contract }), '--json']);
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.metrics.blockers, 2,
    `Expected 2 blockers (env + compose), got ${report.metrics.blockers}`);
  const locations = report.findings
    .filter(f => f.severity === 'BLOCKER' && f.key === 'MISSING_REQUIRED_KEY')
    .map(f => f.location);
  assert.ok(locations.includes('.env.example'), '.env.example blocker expected');
  assert.ok(locations.includes('compose.yaml'),  'compose.yaml blocker expected');
});

test('CI gate: exits 2 when an existing required key is removed from healthy contract', () => {
  // Remove API_SECRET_KEY — this key IS defined in the files, but removing it
  // from the contract changes the check. However the more important direction is
  // that adding a missing key to the contract causes failure. Here we simulate a
  // PR that removes a key from the files: we drop DATABASE_URL from the contract
  // but it's still in the files — that would not fail. The correct scenario
  // for "CI fails when a required key is removed from the healthy fixture" is:
  //   • contract still declares the key
  //   • the .env.example or compose.yaml no longer defines it
  // We simulate this by pointing at a custom env file that lacks one key.
  const dir = resolve(tmpdir(), `driftlens-ci-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  // .env.example missing API_SECRET_KEY
  writeFileSync(resolve(dir, '.env.example'), 'DATABASE_URL=<set-me>\nSMTP_HOST=<set-me>\nSMTP_PORT=587\n', 'utf8');
  const result = runGate(healthyArgs({ example: resolve(dir, '.env.example') }));
  assert.equal(result.status, 2,
    `Expected exit 2, got ${result.status}.\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /HOLD RELEASE/);
  assert.match(result.stdout, /API_SECRET_KEY/);
});

// ── 3. Broken demo fixtures must remain broken ────────────────────────────────

test('CI gate: broken checkout fixtures still exit 2 (HOLD) — demo must remain broken', () => {
  const result = runGate([
    '--source',     'fixtures/app.py',
    '--example',    'fixtures/.env.example',
    '--deployment', 'fixtures/compose.yaml',
    '--contract',   'fixtures/contract.json',
  ]);
  assert.equal(result.status, 2,
    `Broken fixtures must exit 2. Got ${result.status}.\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /HOLD RELEASE/);
  assert.match(result.stdout, /PAYMENT_API_KEY/);
});

test('CI gate: broken checkout fixtures have exactly 2 blockers', () => {
  const result = runGate([
    '--source',     'fixtures/app.py',
    '--example',    'fixtures/.env.example',
    '--deployment', 'fixtures/compose.yaml',
    '--contract',   'fixtures/contract.json',
    '--json',
  ]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.metrics.blockers, 2);
  assert.deepEqual(
    report.findings.filter(f => f.severity === 'BLOCKER').map(f => f.location),
    ['.env.example', 'compose.yaml'],
  );
});

test('CI gate: --json stays valid in GitHub Actions when findings exist', () => {
  const result = runGate(['--json'], { GITHUB_ACTIONS: 'true' });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'HOLD');
  assert.equal(report.metrics.blockers, 2);
});

// ── 4. GitHub Actions annotation format ──────────────────────────────────────

test('CI gate: emits ::error annotations when GITHUB_ACTIONS=true and HOLD', () => {
  const contract = writeTempContract([
    'DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'API_SECRET_KEY', 'ANNOTATED_MISSING_KEY',
  ]);
  const result = runGate(healthyArgs({ contract }), { GITHUB_ACTIONS: 'true' });
  assert.equal(result.status, 2);
  // stdout must contain at least one ::error annotation
  assert.match(result.stdout, /^::error /m,
    'Expected at least one ::error annotation in stdout');
  // annotation must reference the affected file
  assert.match(result.stdout, /file=fixtures\/healthy\/\.env\.example/,
    'Annotation must identify the .env.example file');
  // annotation title must name the key
  assert.match(result.stdout, /ANNOTATED_MISSING_KEY/,
    'Annotation must name the missing key');
});

test('CI gate: emits ::warning annotations for WARN-level findings', () => {
  // Add a key to the contract that is not referenced in source — this yields a WARN.
  // The healthy source references DATABASE_URL, SMTP_HOST, SMTP_PORT, API_SECRET_KEY.
  // Adding EXTRA_WARN_KEY to the contract causes a WARN (required but unused).
  const contract = writeTempContract([
    'DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'API_SECRET_KEY', 'EXTRA_WARN_KEY',
  ]);
  // Also add it to both env and compose so there are no blockers, only a warn.
  const dir = resolve(tmpdir(), `driftlens-ci-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, '.env.example'),
    'DATABASE_URL=<set-me>\nSMTP_HOST=<set-me>\nSMTP_PORT=587\nAPI_SECRET_KEY=<set-me>\nEXTRA_WARN_KEY=<set-me>\n', 'utf8');
  writeFileSync(resolve(dir, 'compose.yaml'),
    'services:\n  notifications:\n    environment:\n      DATABASE_URL: ${DATABASE_URL}\n' +
    '      SMTP_HOST: ${SMTP_HOST}\n      SMTP_PORT: ${SMTP_PORT:-587}\n' +
    '      API_SECRET_KEY: ${API_SECRET_KEY}\n      EXTRA_WARN_KEY: ${EXTRA_WARN_KEY}\n', 'utf8');

  const result = runGate(healthyArgs({ contract, example: resolve(dir, '.env.example'), deployment: resolve(dir, 'compose.yaml') }),
    { GITHUB_ACTIONS: 'true' });
  // WARN only → REVIEW or READY, exit 0
  assert.equal(result.status, 0,
    `Expected exit 0, got ${result.status}.\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /::warning /,
    'Expected ::warning annotation for WARN-level finding');
});

test('CI gate: no annotations emitted when GITHUB_ACTIONS is not set', () => {
  const contract = writeTempContract([
    'DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'API_SECRET_KEY', 'MISSING_NO_ANNOT',
  ]);
  // unset GITHUB_ACTIONS
  const { GITHUB_ACTIONS: _removed, ...envWithout } = process.env;
  const result = runGate(healthyArgs({ contract }), { GITHUB_ACTIONS: '' });
  // should still fail with HOLD
  assert.equal(result.status, 2);
  // but should NOT emit any :: workflow commands
  assert.doesNotMatch(result.stdout, /^::/m,
    'No GHA workflow commands expected when GITHUB_ACTIONS is not "true"');
});

// ── 5. JSON output for healthy fixtures ──────────────────────────────────────

test('CI gate: healthy --json output is valid JSON with expected shape', () => {
  const result = runGate([...healthyArgs(), '--json']);
  assert.equal(result.status, 0);
  let report;
  assert.doesNotThrow(() => { report = JSON.parse(result.stdout); }, 'Output must be valid JSON');
  assert.ok(typeof report.status === 'string', 'report.status must be a string');
  assert.ok(typeof report.metrics === 'object', 'report.metrics must be an object');
  assert.ok(Array.isArray(report.findings), 'report.findings must be an array');
  assert.ok(typeof report.checkedAt === 'string', 'report.checkedAt must be a string');
});

// ── 6. Error paths ────────────────────────────────────────────────────────────

test('CI gate: exits 1 for unknown flag', () => {
  const result = runGate(['--no-such-flag']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown flag/);
});

test('CI gate: exits 1 when a fixture file is missing', () => {
  const result = runGate([...healthyArgs({ source: 'no-such-file.py' })]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot read/);
});

test('CI gate: exits 1 for a malformed contract file', () => {
  // Pass source file as the contract — not valid JSON
  const result = runGate([...healthyArgs({ contract: 'fixtures/healthy/app.py' })]);
  assert.equal(result.status, 1);
});

// ── 7. Annotation format correctness (unit-level) ────────────────────────────

test('CI gate: annotation file param matches actual fixture path, not internal location label', () => {
  const contract = writeTempContract([
    'DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'API_SECRET_KEY', 'FILE_PATH_CHECK_KEY',
  ]);
  const result = runGate(healthyArgs({ contract }), { GITHUB_ACTIONS: 'true' });
  // The annotation should use the real path passed via --example, not a bare ".env.example"
  const lines = result.stdout.split('\n').filter(l => l.startsWith('::error'));
  assert.ok(lines.length >= 1, 'At least one ::error line expected');
  const envAnnotation = lines.find(l => l.includes('.env.example'));
  assert.ok(envAnnotation, 'At least one annotation must reference .env.example');
  // The file= value must not be just ".env.example" but the full relative path
  assert.match(envAnnotation, /file=fixtures\/healthy\//,
    'file= must use the resolved fixture path, not just ".env.example"');
});
