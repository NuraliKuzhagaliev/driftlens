/**
 * CLI integration tests for bin/check-release.js.
 *
 * Each test spawns the CLI as a child process and checks stdout/stderr
 * and the process exit code.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CLI = resolve(ROOT, 'bin', 'check-release.js');

function run(extraArgs = []) {
  return spawnSync(
    process.execPath,
    [CLI, ...extraArgs],
    { cwd: ROOT, encoding: 'utf8' }
  );
}

// ── broken fixtures (originals) ─────────────────────────────────────────────

test('CLI exits 2 (HOLD) for broken fixtures', () => {
  const result = run();
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stdout, /HOLD RELEASE/);
  assert.match(result.stdout, /PAYMENT_API_KEY/);
  assert.match(result.stdout, /\[BLOCK\]/);
});

test('CLI --json exits 2 and outputs valid JSON with status HOLD', () => {
  const result = run(['--json']);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'HOLD');
  assert.ok(report.metrics.blockers > 0);
  assert.ok(Array.isArray(report.findings));
});

test('CLI reports 2 blockers for broken fixtures', () => {
  const result = run(['--json']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.metrics.blockers, 2);
  const locations = report.findings
    .filter(f => f.severity === 'BLOCKER')
    .map(f => f.location);
  assert.deepEqual(locations, ['.env.example', 'compose.yaml']);
});

// ── repaired fixtures ────────────────────────────────────────────────────────

test('CLI exits 0 (READY) when pointing at repaired fixtures', () => {
  const result = run([
    '--source',     'fixtures/app.py',
    '--example',    'fixtures/repaired/.env.example',
    '--deployment', 'fixtures/repaired/compose.yaml',
    '--contract',   'fixtures/contract.json',
  ]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}`);
  assert.match(result.stdout, /READY TO PROCEED/);
});

test('CLI --json exits 0 and reports READY after repair', () => {
  const result = run([
    '--source',     'fixtures/app.py',
    '--example',    'fixtures/repaired/.env.example',
    '--deployment', 'fixtures/repaired/compose.yaml',
    '--contract',   'fixtures/contract.json',
    '--json',
  ]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'READY');
  assert.equal(report.metrics.blockers, 0);
  assert.equal(report.findings.length, 0);
});

// ── invalid input ────────────────────────────────────────────────────────────

test('CLI exits 1 for unknown flag', () => {
  const result = run(['--unknown-flag']);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
  assert.match(result.stderr, /Unknown flag/);
});

test('CLI exits 1 when a file path is missing', () => {
  const result = run(['--source', 'no-such-file.py']);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
  assert.match(result.stderr, /Cannot read/);
});

test('CLI exits 1 for a malformed contract', () => {
  // Pass a source file as the contract to trigger a parse/validation error.
  const result = run(['--contract', 'fixtures/app.py']);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
});
