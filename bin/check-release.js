#!/usr/bin/env node
/**
 * DriftLens release gate — command-line interface.
 *
 * Usage:
 *   node bin/check-release.js [--source <file>] [--example <file>]
 *                             [--deployment <file>] [--contract <file>]
 *                             [--json]
 *
 * Exit codes:
 *   0  READY or REVIEW  (no blockers)
 *   1  Invalid input    (unreadable file, bad contract, unknown flag)
 *   2  HOLD             (one or more blockers found)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze } from '../app/core.js';

// ── defaults point at the sample fixtures ──────────────────────────────────
const DEFAULTS = {
  source:     'fixtures/app.py',
  example:    'fixtures/.env.example',
  deployment: 'fixtures/compose.yaml',
  contract:   'fixtures/contract.json',
};

// ── argument parsing ────────────────────────────────────────────────────────
const FLAGS = new Set(['--source', '--example', '--deployment', '--contract', '--json']);

function parseArgs(argv) {
  const args = { json: false };
  const remaining = argv.slice(2);
  for (let i = 0; i < remaining.length; i++) {
    const token = remaining[i];
    if (token === '--json') { args.json = true; continue; }
    if (FLAGS.has(token)) {
      const value = remaining[++i];
      if (value === undefined || value.startsWith('--')) {
        fatal(`Flag ${token} requires a value.`);
      }
      args[token.slice(2)] = value;
    } else {
      fatal(`Unknown flag: ${token}`);
    }
  }
  return args;
}

function fatal(message) {
  process.stderr.write(`check-release: ${message}\n`);
  process.exit(1);
}

function readText(filePath, label) {
  try {
    return readFileSync(resolve(filePath), 'utf8');
  } catch (err) {
    fatal(`Cannot read ${label} file "${filePath}": ${err.message}`);
    throw err; // unreachable — satisfies static analysis that the function always returns a string
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv);

const sourcePath     = args.source     ?? DEFAULTS.source;
const examplePath    = args.example    ?? DEFAULTS.example;
const deploymentPath = args.deployment ?? DEFAULTS.deployment;
const contractPath   = args.contract   ?? DEFAULTS.contract;

const source     = readText(sourcePath,     '--source');
const example    = readText(examplePath,    '--example');
const deployment = readText(deploymentPath, '--deployment');
const contractText = readText(contractPath, '--contract');

// Parse once here so the service name is available for the human report
// without a second JSON.parse inside the output block.
let contractObj;
try {
  contractObj = JSON.parse(contractText);
} catch (err) {
  fatal(`Contract file is not valid JSON: ${err.message}`);
  throw err; // unreachable
}

let report;
try {
  report = analyze({ source, example, deployment, contract: contractObj });
} catch (err) {
  fatal(err.message);
  throw err; // unreachable
}

// ── output ──────────────────────────────────────────────────────────────────
if (args.json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  const icon = report.status === 'READY' ? '✓' : report.status === 'HOLD' ? '✗' : '?';
  const label = report.status === 'HOLD' ? 'HOLD RELEASE'
              : report.status === 'READY' ? 'READY TO PROCEED'
              : 'REVIEW REQUIRED';

  process.stdout.write(`\nDriftLens release gate\n`);
  process.stdout.write(`${'─'.repeat(40)}\n`);
  process.stdout.write(`Status  : ${icon} ${label}\n`);
  process.stdout.write(`Service : ${contractObj.service ?? '(unknown)'}\n`);
  process.stdout.write(`Required: ${report.metrics.required}  Blockers: ${report.metrics.blockers}  Warnings: ${report.metrics.warnings}\n`);

  if (report.findings.length) {
    process.stdout.write(`\nFindings\n${'─'.repeat(40)}\n`);
    for (const f of report.findings) {
      const tag = f.severity === 'BLOCKER' ? '[BLOCK]' : '[WARN] ';
      process.stdout.write(`${tag} ${f.title}\n`);
      process.stdout.write(`         ${f.location} — ${f.fix}\n\n`);
    }
  } else {
    process.stdout.write(`\nNo configuration drift found in these static checks.\n`);
  }

  process.stdout.write(`Checked : ${report.checkedAt}\n\n`);
}

// exit code
if (report.status === 'HOLD') process.exit(2);
// READY or REVIEW → 0
