#!/usr/bin/env node
/**
 * bin/ci-gate.js — DriftLens release gate with GitHub Actions annotations.
 *
 * Wraps the same analysis engine as check-release.js and, when running inside
 * GitHub Actions (GITHUB_ACTIONS=true), emits workflow commands that surface
 * each blocking finding as an inline annotation in the Pull Request diff:
 *
 *   ::error file=<path>,title=DriftLens[KEY]::<message>
 *
 * Usage (same flags as check-release.js):
 *   node bin/ci-gate.js [--source <file>] [--example <file>]
 *                       [--deployment <file>] [--contract <file>]
 *                       [--json]
 *
 * Exit codes:
 *   0  READY or REVIEW  (no blockers)
 *   1  Invalid input    (unreadable file, bad contract, unknown flag)
 *   2  HOLD             (one or more blockers found)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze } from '../app/core.js';

// ── GitHub Actions workflow commands ─────────────────────────────────────────

const IS_GHA = process.env.GITHUB_ACTIONS === 'true';

/**
 * Emit a GitHub Actions workflow command.
 * Spec: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
 *
 * @param {'error'|'warning'|'notice'} level
 * @param {string} message
 * @param {{ file?: string, line?: number, col?: number, title?: string }} [props]
 */
function ghaCommand(level, message, props = {}) {
  const parts = [];
  if (props.file)  parts.push(`file=${props.file}`);
  if (props.line)  parts.push(`line=${props.line}`);
  if (props.col)   parts.push(`col=${props.col}`);
  if (props.title) parts.push(`title=${props.title}`);
  const params = parts.length ? ` ${parts.join(',')}` : '';
  // Newlines inside the message must be URL-encoded or the command is broken.
  const safe = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  process.stdout.write(`::${level}${params}::${safe}\n`);
}

/**
 * Map a finding location string to the actual file path as it appears in the
 * repository so the annotation points at the correct file in the PR diff.
 * The `baseDir` parameter is the directory containing the fixtures files.
 */
function locationToFile(location, paths) {
  if (location === '.env.example')  return paths.example;
  if (location === 'compose.yaml')  return paths.deployment;
  if (location.startsWith('app source')) return paths.source;
  if (location.startsWith('.env.example:')) return paths.example;
  return null;
}

// ── Argument parsing ──────────────────────────────────────────────────────────

const FLAGS = new Set(['--source', '--example', '--deployment', '--contract', '--json']);

function parseArgs(argv) {
  const args = { json: false };
  const remaining = argv.slice(2);
  for (let i = 0; i < remaining.length; i++) {
    const token = remaining[i];
    if (token === '--json') { args.json = true; continue; }
    if (FLAGS.has(token)) {
      const value = remaining[++i];
      if (value === undefined || value.startsWith('--')) fatal(`Flag ${token} requires a value.`);
      args[token.slice(2)] = value;
    } else {
      fatal(`Unknown flag: ${token}`);
    }
  }
  return args;
}

function fatal(message) {
  process.stderr.write(`ci-gate: ${message}\n`);
  if (IS_GHA) ghaCommand('error', message, { title: 'DriftLens: invalid input' });
  process.exit(1);
}

function readText(filePath, label) {
  try {
    return readFileSync(resolve(filePath), 'utf8');
  } catch (err) {
    fatal(`Cannot read ${label} file "${filePath}": ${err.message}`);
    throw err; // unreachable
  }
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  source:     'fixtures/app.py',
  example:    'fixtures/.env.example',
  deployment: 'fixtures/compose.yaml',
  contract:   'fixtures/contract.json',
};

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);

const sourcePath     = args.source     ?? DEFAULTS.source;
const examplePath    = args.example    ?? DEFAULTS.example;
const deploymentPath = args.deployment ?? DEFAULTS.deployment;
const contractPath   = args.contract   ?? DEFAULTS.contract;

const filePaths = { source: sourcePath, example: examplePath, deployment: deploymentPath };

const source       = readText(sourcePath,     '--source');
const example      = readText(examplePath,    '--example');
const deployment   = readText(deploymentPath, '--deployment');
const contractText = readText(contractPath,   '--contract');

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

// ── Emit GitHub Actions annotations ──────────────────────────────────────────

// --json must stay machine-readable even when invoked from a GitHub Actions job.
if (IS_GHA && !args.json && report.findings.length) {
  for (const finding of report.findings) {
    const level    = finding.severity === 'BLOCKER' ? 'error' : 'warning';
    const file     = locationToFile(finding.location, filePaths);
    const lineMatch = finding.location.match(/:(\d+)$/);
    const line     = lineMatch ? Number(lineMatch[1]) : undefined;
    const title    = `DriftLens[${finding.key}]: ${finding.severity}`;
    ghaCommand(level, `${finding.title} — ${finding.fix}`, { file, line, title });
  }
}

// ── Human-readable output ─────────────────────────────────────────────────────

if (args.json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  const icon  = report.status === 'READY' ? '✓' : report.status === 'HOLD' ? '✗' : '?';
  const label = report.status === 'HOLD'  ? 'HOLD RELEASE'
              : report.status === 'READY' ? 'READY TO PROCEED'
              : 'REVIEW REQUIRED';

  process.stdout.write(`\nDriftLens CI release gate\n`);
  process.stdout.write(`${'─'.repeat(40)}\n`);
  process.stdout.write(`Status  : ${icon} ${label}\n`);
  process.stdout.write(`Service : ${contractObj.service ?? '(unknown)'}\n`);
  process.stdout.write(`Required: ${report.metrics.required}  Blockers: ${report.metrics.blockers}  Warnings: ${report.metrics.warnings}\n`);

  if (report.findings.length) {
    process.stdout.write(`\nFindings\n${'─'.repeat(40)}\n`);
    for (const f of report.findings) {
      const tag  = f.severity === 'BLOCKER' ? '[BLOCK]' : '[WARN] ';
      const file = locationToFile(f.location, filePaths) ?? f.location;
      process.stdout.write(`${tag} ${f.key}  (${file})\n`);
      process.stdout.write(`       ${f.title}\n`);
      process.stdout.write(`       Fix: ${f.fix}\n\n`);
    }
  } else {
    process.stdout.write(`\nNo configuration drift found.\n`);
  }

  process.stdout.write(`Checked : ${report.checkedAt}\n\n`);
}

// ── Exit code ─────────────────────────────────────────────────────────────────

if (report.status === 'HOLD') process.exit(2);
// READY or REVIEW → 0
