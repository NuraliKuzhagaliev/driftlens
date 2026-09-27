/**
 * Incident-to-Guard analysis module.
 *
 * matchLog(text)      — parse a raw log fragment and extract the missing variable name.
 * correlate(variable, report) — link an extracted variable to existing scan findings.
 *
 * All analysis is deterministic and purely pattern-based; no heuristics or LLM inference.
 * Only the patterns documented below are recognised; everything else returns { matched: false }.
 */

/**
 * Documented log patterns that indicate a missing environment variable.
 * Each entry has:
 *   id      — short identifier used in the causal-chain output
 *   runtime — "python" | "node"
 *   regex   — captures the variable name in group 1
 *   label   — human-readable description for the UI
 */
export const PATTERNS = [
  {
    id: 'py-keyerror',
    runtime: 'python',
    regex: /KeyError:\s*['"]([A-Z][A-Z0-9_]*)['"]/,
    label: "Python KeyError on os.environ[…]",
  },
  {
    id: 'py-none-env',
    runtime: 'python',
    regex: /TypeError:.*?\bNoneType\b.*?\n?.*?os\.(?:getenv|environ\.get)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/,
    label: "Python None from os.getenv(…) used as non-optional",
  },
  {
    id: 'node-missing-env',
    runtime: 'node',
    // Matches: "process.env.PAYMENT_API_KEY is not defined"  (or undefined)
    regex: /process\.env\.([A-Z][A-Z0-9_]*)\s+is\s+(?:not defined|undefined)/,
    label: "Node.js process.env.… is not defined/undefined",
  },
  {
    id: 'node-must-set',
    runtime: 'node',
    // Matches: "Error: Must set PAYMENT_API_KEY environment variable"
    regex: /(?:Error|TypeError|ReferenceError):\s+Must set ([A-Z][A-Z0-9_]*)\s+environment variable/,
    label: "Node.js 'Must set … environment variable' error",
  },
  {
    id: 'node-required-env',
    runtime: 'node',
    // Matches: "Missing required environment variable: PAYMENT_API_KEY"
    regex: /[Mm]issing required environment variable[:\s]+([A-Z][A-Z0-9_]*)/,
    label: "Node.js 'Missing required environment variable' message",
  },
];

/**
 * Try to match a raw log string against all documented patterns.
 *
 * @param {string} text  — raw log text pasted or loaded by the user
 * @returns {{ matched: true,  variable: string, patternId: string, patternLabel: string }
 *          |{ matched: false }}
 */
export function matchLog(text) {
  if (typeof text !== 'string' || !text.trim()) return { matched: false };
  for (const p of PATTERNS) {
    const m = text.match(p.regex);
    if (m) {
      return {
        matched: true,
        variable: m[1],
        patternId: p.id,
        patternLabel: p.label,
        runtime: p.runtime,
      };
    }
  }
  return { matched: false };
}

/**
 * Correlate an extracted variable name with the findings from a scan report.
 *
 * @param {string} variable   — upper-case env var name extracted from the log
 * @param {object} report     — the object returned by analyze() from core.js,
 *                              or null if no scan has been run yet
 * @returns {object} causal chain descriptor
 */
export function correlate(variable, report) {
  if (!report || !Array.isArray(report.findings)) {
    return { variable, scanFindings: [], contractRequired: false, noScanYet: true };
  }

  // Is this variable in the contract?
  const contractRequired = Array.isArray(report.metrics)
    ? false  // metrics is an object, not array — guard
    : !!(report.findings.find(f => f.key === variable) ||
         (report.metrics && report.metrics.required > 0 &&
          // check via source findings
          report.findings.some(f => f.key === variable)));

  // Pull all findings that mention this variable
  const scanFindings = report.findings.filter(f => f.key === variable);

  // Also check if the variable appears in findings from the gate run
  // (it may not have a finding if it was already repaired)
  const inContract = report.findings.some(f => f.key === variable) ||
    // The variable might be required but have no finding if all is ok
    // We detect this by checking metrics: if 0 blockers and it was in the source
    false;

  return {
    variable,
    scanFindings,
    contractRequired: inContract,
  };
}
