/**
 * Incident-to-Guard tests.
 *
 * Three required scenarios:
 *   1. Matched incident — PAYMENT_API_KEY KeyError correlates with open gate findings.
 *   2. Unrelated key    — a variable that appears in the log but is not in the contract/findings.
 *   3. Unrecognized log — a log that matches no documented pattern.
 *
 * Tests exercise matchLog() and correlate() from incident.js (pure functions, no DOM).
 * analyze() from core.js provides a realistic scan report for correlation tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLog, correlate, PATTERNS } from '../app/incident.js';
import { analyze } from '../app/core.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const BASE_INPUT = {
  source:     'os.environ["DATABASE_URL"]\nos.getenv("PAYMENT_API_KEY")\nprocess.env.PORT',
  example:    'DATABASE_URL=<set-me>\nPORT=8080',
  deployment: 'services:\n  checkout:\n    environment:\n      DATABASE_URL: ${DATABASE_URL}\n      PORT: ${PORT}',
  contract:   { required: ['DATABASE_URL', 'PAYMENT_API_KEY', 'PORT'] },
};

// A report with the two open blockers (PAYMENT_API_KEY missing from both places).
const BROKEN_REPORT = analyze(BASE_INPUT);

// The sample incident log text (matches Python KeyError pattern).
const SAMPLE_LOG = `2024-06-12T09:14:32Z [checkout-api] ERROR Traceback (most recent call last):
  File "/app/app.py", line 4, in <module>
    PAYMENT_API_KEY = os.environ["PAYMENT_API_KEY"]
KeyError: 'PAYMENT_API_KEY'
2024-06-12T09:14:32Z [checkout-api] FATAL Service failed to start.`;

// ── matchLog tests ────────────────────────────────────────────────────────────

test('matchLog: recognises Python KeyError pattern', () => {
  const result = matchLog(`KeyError: 'PAYMENT_API_KEY'`);
  assert.equal(result.matched, true);
  assert.equal(result.variable, 'PAYMENT_API_KEY');
  assert.equal(result.patternId, 'py-keyerror');
  assert.equal(result.runtime, 'python');
});

test('matchLog: recognises Node.js process.env.… is not defined', () => {
  const result = matchLog('process.env.PAYMENT_API_KEY is not defined');
  assert.equal(result.matched, true);
  assert.equal(result.variable, 'PAYMENT_API_KEY');
  assert.equal(result.runtime, 'node');
});

test('matchLog: recognises Node.js "Missing required environment variable" message', () => {
  const result = matchLog('Missing required environment variable: SECRET_KEY');
  assert.equal(result.matched, true);
  assert.equal(result.variable, 'SECRET_KEY');
});

test('matchLog: returns matched:false for an unrecognized log', () => {
  const result = matchLog('NullPointerException at com.example.Service.init(Service.java:42)');
  assert.equal(result.matched, false);
});

test('matchLog: returns matched:false for empty input', () => {
  assert.equal(matchLog('').matched, false);
  assert.equal(matchLog('   ').matched, false);
});

test('matchLog: returns matched:false for non-string input', () => {
  assert.equal(matchLog(null).matched, false);
  assert.equal(matchLog(undefined).matched, false);
});

// ── correlate tests ───────────────────────────────────────────────────────────

test('correlate: finds open findings for PAYMENT_API_KEY in broken report', () => {
  const result = correlate('PAYMENT_API_KEY', BROKEN_REPORT);
  assert.equal(result.variable, 'PAYMENT_API_KEY');
  assert.ok(result.scanFindings.length >= 1, 'Expected at least one finding for PAYMENT_API_KEY');
  assert.ok(result.scanFindings.every(f => f.key === 'PAYMENT_API_KEY'));
});

test('correlate: returns empty findings for a variable not in the scan', () => {
  const result = correlate('STRIPE_WEBHOOK_SECRET', BROKEN_REPORT);
  assert.equal(result.scanFindings.length, 0);
});

test('correlate: handles null report gracefully', () => {
  const result = correlate('PAYMENT_API_KEY', null);
  assert.equal(result.scanFindings.length, 0);
  assert.equal(result.noScanYet, true);
});

// ── Scenario 1: Matched incident ─────────────────────────────────────────────
// The sample log contains KeyError: 'PAYMENT_API_KEY'.
// The broken scan has two open blockers for that variable.
// Expected: status 'matched', two scanFindings, two repair strings.

test('Scenario 1 — matched incident: PAYMENT_API_KEY KeyError correlates with gate findings', () => {
  const match = matchLog(SAMPLE_LOG);
  assert.equal(match.matched, true, 'Log should be matched');
  assert.equal(match.variable, 'PAYMENT_API_KEY');

  const chain = correlate(match.variable, BROKEN_REPORT);
  assert.ok(chain.scanFindings.length >= 1, 'Expected at least one gate finding');

  // All findings must relate to the extracted variable
  assert.ok(chain.scanFindings.every(f => f.key === 'PAYMENT_API_KEY'), 'All findings must be for PAYMENT_API_KEY');

  // At least one finding should be a BLOCKER
  assert.ok(chain.scanFindings.some(f => f.severity === 'BLOCKER'), 'Expected at least one BLOCKER finding');

  // Each finding should carry a fix suggestion
  assert.ok(chain.scanFindings.every(f => typeof f.fix === 'string' && f.fix.length > 0), 'Every finding should have a fix');
});

// ── Scenario 2: Unrelated key ────────────────────────────────────────────────
// The log contains a reference to a variable that is NOT in the contract / scan.
// Expected: matchLog succeeds, correlate returns no findings.

test('Scenario 2 — unrelated key: STRIPE_WEBHOOK_SECRET not in contract has no findings', () => {
  const unrelatedLog = `KeyError: 'STRIPE_WEBHOOK_SECRET'`;
  const match = matchLog(unrelatedLog);
  assert.equal(match.matched, true, 'Pattern should still match');
  assert.equal(match.variable, 'STRIPE_WEBHOOK_SECRET');

  const chain = correlate(match.variable, BROKEN_REPORT);
  assert.equal(chain.scanFindings.length, 0, 'No findings expected for an out-of-contract variable');
});

// ── Scenario 3: Unrecognized log ─────────────────────────────────────────────
// A log that does not contain any documented pattern.
// Expected: matchLog returns { matched: false }.

test('Scenario 3 — unrecognized log: generic Java NPE is not matched', () => {
  const javaLog = `Exception in thread "main" java.lang.NullPointerException
\tat com.example.App.run(App.java:17)`;
  const match = matchLog(javaLog);
  assert.equal(match.matched, false, 'Unrecognized log should not be matched');
});

test('Scenario 3 — unrecognized log: plain informational message is not matched', () => {
  const infoLog = `INFO Server started on port 8080\nINFO Listening for connections`;
  const match = matchLog(infoLog);
  assert.equal(match.matched, false);
});

// ── PATTERNS catalogue sanity check ──────────────────────────────────────────

test('PATTERNS array exports at least 5 documented patterns', () => {
  assert.ok(Array.isArray(PATTERNS));
  assert.ok(PATTERNS.length >= 5);
  for (const p of PATTERNS) {
    assert.ok(p.id, 'Each pattern needs an id');
    assert.ok(p.runtime, 'Each pattern needs a runtime');
    assert.ok(p.regex instanceof RegExp, 'Each pattern needs a regex');
    assert.ok(p.label, 'Each pattern needs a label');
  }
});
