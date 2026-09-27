/**
 * repair.js — Pure repair-preview module.
 *
 * No DOM, no side-effects.  All exports take plain strings and return
 * plain strings so they can be exercised in Node test runners without a
 * browser environment.
 */

/**
 * Compute the set of lines that would be appended to .env.example.
 *
 * Only adds lines for BLOCKER findings whose location is `.env.example` AND
 * whose key is already part of *this* project's contract (i.e. it appears in
 * at least one finding).  Returns an empty array when there is nothing to add.
 *
 * @param {string} exampleText  - current .env.example content
 * @param {Array}  findings     - findings array from analyze()
 * @returns {{ lines: string[], text: string }}
 *   lines — the new lines that would be appended (without trailing newline)
 *   text  — the full proposed replacement text
 */
export function previewEnvExample(exampleText, findings) {
  const lines = [];
  for (const f of findings) {
    if (f.severity !== 'BLOCKER') continue;
    if (f.location !== '.env.example') continue;
    if (!f.title.endsWith('absent from setup instructions')) continue;
    lines.push(`${f.key}=<set-me>`);
  }
  if (!lines.length) return { lines, text: exampleText };
  const text = exampleText.trimEnd() + '\n' + lines.join('\n') + '\n';
  return { lines, text };
}

/**
 * Compute the line that would be inserted into compose.yaml for each missing
 * BLOCKER whose location is `compose.yaml`.
 *
 * Returns `{ changes, text }` where `changes` is an array of
 * `{ key, line }` objects (the human-readable description) and `text` is the
 * proposed full replacement.
 *
 * Returns `{ error }` (no `text`) when the yaml has no `environment:` block,
 * because the repair cannot be applied without one.
 *
 * @param {string} deploymentText  - current compose.yaml content
 * @param {Array}  findings        - findings array from analyze()
 * @returns {{ changes: Array<{key:string,line:string}>, text: string }
 *          | { error: string }}
 */
export function previewCompose(deploymentText, findings) {
  const blockers = findings.filter(
    f => f.severity === 'BLOCKER' &&
         f.location === 'compose.yaml' &&
         f.title.endsWith('absent from deployment'),
  );
  if (!blockers.length) return { changes: [], text: deploymentText };

  const lines = deploymentText.split('\n');
  const environmentIdx = lines.findIndex(l => /^\s*environment:\s*(?:#.*)?$/.test(l));
  if (environmentIdx < 0) {
    return { error: 'Add an environment: block to compose.yaml before applying this repair.' };
  }

  const indentation = (lines[environmentIdx].match(/^\s*/)?.[0].length ?? 0) + 2;
  const pad = ' '.repeat(indentation);
  const changes = [];

  // Insert in reverse order so earlier splice indices remain valid
  const sorted = [...blockers].reverse();
  const workLines = [...lines];
  for (const f of sorted) {
    const newLine = `${pad}${f.key}: \${${f.key}}`;
    workLines.splice(environmentIdx + 1, 0, newLine);
    changes.unshift({ key: f.key, line: newLine.trim() });
  }

  return { changes, text: workLines.join('\n') };
}

/**
 * Build a human-readable preview object suitable for rendering to the user.
 *
 * @param {object} state   - { example: string, deployment: string }
 * @param {Array}  findings
 * @returns {{ envChanges: string[], composeChanges: string[],
 *             newExample: string, newDeployment: string,
 *             composeError: string|null, hasChanges: boolean }}
 */
export function buildPreview(state, findings) {
  const envResult = previewEnvExample(state.example, findings);
  const composeResult = previewCompose(state.deployment, findings);

  const composeError = composeResult.error ?? null;
  const composeChanges = composeResult.changes ?? [];

  return {
    envChanges: envResult.lines,
    composeChanges: composeChanges.map(c => c.line),
    newExample: envResult.text,
    newDeployment: composeError ? state.deployment : (composeResult.text ?? state.deployment),
    composeError,
    hasChanges: envResult.lines.length > 0 || composeChanges.length > 0,
  };
}

/**
 * Apply a confirmed preview to state (immutably — returns new state object).
 *
 * @param {object} state   - { example: string, deployment: string, ...rest }
 * @param {object} preview - result of buildPreview()
 * @returns {object} new state with example and deployment replaced
 */
export function applyPreview(state, preview) {
  return {
    ...state,
    example:    preview.newExample,
    deployment: preview.newDeployment,
  };
}
