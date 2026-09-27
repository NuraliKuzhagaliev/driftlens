# DriftLens CI

How the GitHub Actions workflow works, and how to reproduce every result locally.

---

## What the CI workflow does

The workflow (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `main`/`master`. It has three gates:

| Step | Fixture set | Expected outcome |
|------|-------------|-----------------|
| `npm test` | all `tests/*.test.js` | all tests pass |
| **Broken fixtures (must stay broken)** | `fixtures/` (checkout-api) | `ci-gate.js` exits **2 (HOLD)** — the intentional drift is the demo |
| **Healthy fixtures (must stay green)** | `fixtures/healthy/` (notifications-api) | `ci-gate.js` exits **0 (READY)** — any new drift here fails the PR |

A JSON report for the healthy fixtures is uploaded as a workflow artefact after every run.

---

## File map

```
.github/workflows/ci.yml          GitHub Actions workflow
bin/ci-gate.js                    Release gate with GitHub Actions annotations
fixtures/                         Intentionally broken checkout-api demo (do NOT repair)
fixtures/healthy/                 Consistently healthy notifications-api fixture set
  contract.json                   Declares four required keys
  app.py                          Python source referencing all four keys
  .env.example                    Documents all four keys
  compose.yaml                    Deploys all four keys
tests/ci.test.js                  Integration tests for ci-gate.js and healthy fixtures
docs/CI.md                        This file
```

---

## Reproduce locally

### Prerequisites

- Node.js 18 or later
- No other install step — the project has no npm dependencies

### Run the full test suite

```bash
node --test tests/*.test.js
# or via the npm shortcut:
npm test
```

All tests should pass. The output ends with a summary line such as:

```
ℹ tests 36
ℹ pass  36
ℹ fail  0
```

### Run the broken-fixture gate (expect HOLD / exit 2)

```bash
node bin/ci-gate.js
# same as:
node bin/ci-gate.js \
  --source     fixtures/app.py \
  --example    fixtures/.env.example \
  --deployment fixtures/compose.yaml \
  --contract   fixtures/contract.json
```

Expected output (abbreviated):

```
DriftLens CI release gate
────────────────────────────────────────
Status  : ✗ HOLD RELEASE
Service : checkout-api
Required: 3  Blockers: 2  Warnings: 0

Findings
────────────────────────────────────────
[BLOCK] PAYMENT_API_KEY  (fixtures/.env.example)
       PAYMENT_API_KEY is absent from setup instructions
       Fix: Add PAYMENT_API_KEY=<set-me> to .env.example.

[BLOCK] PAYMENT_API_KEY  (fixtures/compose.yaml)
       PAYMENT_API_KEY is absent from deployment
       Fix: Add PAYMENT_API_KEY: ${PAYMENT_API_KEY} to the service environment in compose.yaml.
```

Exit code: `2`

```bash
echo $?   # 2
```

This is the expected outcome. **Do not add `PAYMENT_API_KEY` to `fixtures/.env.example` or `fixtures/compose.yaml`**; those files are the demo of drift.

### Run the healthy-fixture gate (expect READY / exit 0)

```bash
node bin/ci-gate.js \
  --source     fixtures/healthy/app.py \
  --example    fixtures/healthy/.env.example \
  --deployment fixtures/healthy/compose.yaml \
  --contract   fixtures/healthy/contract.json
```

Expected output (abbreviated):

```
DriftLens CI release gate
────────────────────────────────────────
Status  : ✓ READY TO PROCEED
Service : notifications-api
Required: 4  Blockers: 0  Warnings: 0

No configuration drift found.
```

Exit code: `0`

```bash
echo $?   # 0
```

### Reproduce the fail path for healthy fixtures

Remove a required key from `fixtures/healthy/.env.example`, then re-run the gate:

```bash
# 1. Break the healthy fixture
sed -i '/^API_SECRET_KEY/d' fixtures/healthy/.env.example

# 2. Run the gate — should now exit 2
node bin/ci-gate.js \
  --source     fixtures/healthy/app.py \
  --example    fixtures/healthy/.env.example \
  --deployment fixtures/healthy/compose.yaml \
  --contract   fixtures/healthy/contract.json
echo "Exit code: $?"   # 2

# 3. Restore the file
git checkout fixtures/healthy/.env.example
```

Expected output now includes:

```
Status  : ✗ HOLD RELEASE
[BLOCK] API_SECRET_KEY  (fixtures/healthy/.env.example)
```

On Windows (PowerShell):

```powershell
# 1. Break
(Get-Content fixtures/healthy/.env.example) -notmatch '^API_SECRET_KEY' |
  Set-Content fixtures/healthy/.env.example

# 2. Run
node bin/ci-gate.js `
  --source     fixtures/healthy/app.py `
  --example    fixtures/healthy/.env.example `
  --deployment fixtures/healthy/compose.yaml `
  --contract   fixtures/healthy/contract.json
$LASTEXITCODE   # 2

# 3. Restore
git checkout fixtures/healthy/.env.example
```

---

## GitHub Actions annotations

When the gate runs inside GitHub Actions (`GITHUB_ACTIONS=true`), each finding emits a workflow command:

```
::error file=<path>,title=DriftLens[KEY]: BLOCKER::<message>
::warning file=<path>,title=DriftLens[KEY]: WARN::<message>
```

These appear as inline annotations on the pull request diff, pointing at the exact file where the key is missing. For example, removing `API_SECRET_KEY` from `fixtures/healthy/.env.example` produces:

```
::error file=fixtures/healthy/.env.example,title=DriftLens[API_SECRET_KEY]: BLOCKER::API_SECRET_KEY is absent from setup instructions — Add API_SECRET_KEY=<set-me> to .env.example.
```

To preview annotations locally, set `GITHUB_ACTIONS=true` before running the gate:

```bash
GITHUB_ACTIONS=true node bin/ci-gate.js \
  --source     fixtures/healthy/app.py \
  --example    fixtures/healthy/.env.example \
  --deployment fixtures/healthy/compose.yaml \
  --contract   fixtures/healthy/contract.json
```

(PowerShell: `$env:GITHUB_ACTIONS = 'true'; node bin/ci-gate.js ...`)

---

## JSON report

Pass `--json` to get a machine-readable report suitable for artefact upload or `jq` queries:

```bash
node bin/ci-gate.js \
  --source     fixtures/healthy/app.py \
  --example    fixtures/healthy/.env.example \
  --deployment fixtures/healthy/compose.yaml \
  --contract   fixtures/healthy/contract.json \
  --json | jq .status
# "READY"
```

The workflow uploads this report automatically as a `driftlens-report` artefact on every run.

---

## Adding a new service

1. Create `fixtures/<service>/` with `contract.json`, `app.py` (or `.js`), `.env.example`, and `compose.yaml` — all consistent.
2. Add a new step to `.github/workflows/ci.yml` pointing `--contract`, `--source`, `--example`, and `--deployment` at the new fixture set.
3. Add corresponding tests in `tests/ci.test.js` following the existing patterns.

---

## Exit codes reference

| Code | Meaning |
|------|---------|
| `0`  | **READY** or **REVIEW** — no blockers |
| `1`  | Invalid input — unreadable file, bad contract, unknown flag |
| `2`  | **HOLD** — one or more blockers; CI step fails |
