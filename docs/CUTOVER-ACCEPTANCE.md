# Mahara Cockpits: Cutover Acceptance & Verification Specification

## 1. Executive Summary & Current Cutover Status

- **Current Worktree HEAD**: `0a1bf7b`
- **Cutover Status**: **NOT READY FOR CUTOVER**
- **Current Blockers**:
  1. **Source Divergence**: Branch is **31 commits behind `origin/main`**. An upstream merge or rebase is required before cutover.
  2. **Unresolved Defects**: Confirmed open defects exist in Customer Success Management (CSM) and Ask AI.
  3. **Absence of Acceptance Evidence**: Independently produced, human-reviewed acceptance evidence has not been submitted or verified.

> [!CAUTION]
> The verification tool defaults to **Release Mode** (`--mode release`). Invoking the tool without arguments (as done in deployment scripts like `ship.sh`) requires valid acceptance evidence; if evidence is absent, the tool exits **nonzero** and reports **`NOT READY FOR CUTOVER`**.

---

## 2. Verification Architecture & Safety Controls

The verification tool (`scripts/verify-cutover-readiness.py`) enforces strict separation between local compilation checks and release readiness.

### 2.1 Default Release Mode & Safe Execution
- **Default Mode**: Running `python scripts/verify-cutover-readiness.py` defaults to `--mode release`. Missing evidence exits nonzero (`1`) and sets `release_ready: false`.
- **Dry-Run & Read-Only**: No database mutations, no deployments, and no reading of credential files (`.env.local`, service-role keys).
- **Installed Per-App Tooling**: Runs installed tools (`apps/<app>/node_modules/typescript/bin/tsc` and `apps/<app>/node_modules/vite/bin/vite.js`) using `node` or `bun`. Fails immediately if local dependencies are missing, preventing global compiler mismatches or `bunx`/`npx` network auto-downloads.
- **Robust Subprocess Logging**: All commands run strictly with `shell=False`, timeout limits, UTF-8 output encoding (`errors=replace`), and command logs captured on both success and failure.

### 2.2 Git Source Integrity
- **Exact 40-Hex HEAD Required**: Git HEAD must resolve to an exact 40-character hexadecimal SHA.
- **Explicitly Clean Worktree**: Working tree must be completely clean (`git status --porcelain` empty). No bypass is permitted.
- **Assertive Expected SHA**: `--expected-sha` asserts equality with current HEAD (`expected_sha == current_head`); it never overrides local HEAD.
- **Post-Command Source Verification**: Git worktree cleanliness is checked again after builds and tests execute to ensure no untracked or modified artifacts were left behind.

### 2.3 Diagnostic Skip Restrictions
- Any skip flag (`--skip-builds`, `--skip-typechecks`, `--skip-tests`) is **strictly forbidden in release mode** and triggers an immediate failure.
- In diagnostic local mode (`--mode local`), any skip flag marks the result as **`INCOMPLETE`** and exits nonzero (`1`). Skips can never yield `LOCAL_PASSED` or `RELEASE_READY`.

### 2.4 Deceptive Shortcuts Eliminated
1. **Fresh Isolated Builds**: Ignores existing `apps/*/dist` folders. Fresh Vite builds are compiled into temporary isolated directories (`tempfile.mkdtemp`), verified for valid `index.html` generation, and deleted.
2. **Explicit Project Configs**: Root `tsconfig.json` has empty `"files": []`. Verifier explicitly compiles `tsconfig.app.json` and `tsconfig.node.json` for all five cockpits.
3. **No Dummy-Key Network Tests**: `apps/media-buyer-cockpit/scripts/supabase-actions.test.ts` is explicitly excluded from local tests. Sending dummy keys (`anon-dummy-key`) over the network tests only API gateway rejection, not application authorization, RLS enforcement, or RPC security.
4. **Source Import Scan Disclaimer**: Scans of `apps/*/src` prove absence of static Convex import statements only; they do not certify full runtime Convex independence.
5. **Artifact Integrity vs. Proof Semantics**: SHA-256 hashing verifies artifact file integrity against accidental mutation or tampering, **NOT proof semantics**. Independent human review of evidence artifacts is required before release authorization.

---

## 3. Verification Commands

### 3.1 Run Offline Regression Test Suite
Run the 100% offline regression suite (no network, credentials, node_modules, or live data):
```bash
python -m unittest scripts/test_cutover_readiness.py
```

### 3.2 Run Release Verification (Default)
Verify cutover readiness against an independently produced acceptance evidence bundle:
```bash
python scripts/verify-cutover-readiness.py --evidence evidence/cutover-acceptance.json --report report.json
```
*(Fails closed with exit code 1 if evidence is absent, expired, or incomplete).*

### 3.3 Run Local Verification (Diagnostic Only)
Verify local builds, project configs, typechecks, shared files, and offline unit tests:
```bash
python scripts/verify-cutover-readiness.py --mode local --report local-report.json
```
*(Produces `LOCAL_PASSED` on success, but explicitly notes that release readiness is not certified).*

---

## 4. Acceptance Evidence Specification

Evidence must be provided as a structured JSON file binding clean Git HEAD, finite freshness, human evaluator identity, and artifact SHA-256 hashes.

### 4.1 Required Top-Level Fields
- `source_sha`: Exact 40-hex SHA matching git HEAD.
- `source_identity`: Non-empty identifier for the source repository/branch.
- `evaluator`: Non-empty identifier of the human/agent evaluator.
- `recorded_at`: ISO timestamp with bounded freshness (finite age `> 0` and `<= 24.0` hours; NaN/inf rejected).
- `categories`: Dictionary containing all six mandatory categories and exact subchecks.

### 4.2 Mandatory Categories and Subchecks
All categories and subchecks must have `status: "passed"` and non-empty hashed artifact references:

1. **`auth_and_access_journeys`**
   - `allowed_roles`: Allowed role journeys verified.
   - `forbidden_roles`: Unauthorized role journeys rejected with 403.
   - `cross_client_isolation`: Cross-client data access prevented.
   - `revoked_user_rejection`: Revoked/deactivated users rejected immediately.
2. **`persisted_saves_across_refresh`**
   - `media_buyer_cockpit`: Save persistence verified across refresh.
   - `client_success_cockpit`: Save persistence verified across refresh.
   - `creative_director_cockpit`: Save persistence verified across refresh.
   - `video_editor_cockpit`: Save persistence verified across refresh.
   - `sales_cockpit`: Save persistence verified across refresh.
   - `portal`: Save persistence verified across refresh.
   - `ceo_admin`: Save persistence verified across refresh.
3. **`reconciled_history_and_catchup`**
   - `data_reconciliation`: Historical data reconciliation validated.
   - `catchup_sync`: Final catchup synchronization validated.
4. **`worker_lifecycle`**
   - `worker_success`: Worker success path verified.
   - `worker_failure`: Worker error handling verified.
   - `worker_retry`: Worker retry mechanics verified.
5. **`network_traffic_convex_blocked`**
   - `browser_convex_independence`: Browser traffic has 0 Convex requests with Convex blocked.
   - `server_convex_independence`: Server routes operate independently of Convex.
   - `worker_convex_independence`: Background workers operate independently of Convex.
6. **`production_config_and_rollback`**
   - `production_exact_sha`: Production deployed build matches exact source SHA.
   - `production_config`: Production environment variables and URLs verified.
   - `rollback_procedure`: Rollback mechanism tested and documented.

---

## 5. Execution Gates to Cutover

Cutover must not proceed until each sequential gate is satisfied:

```
[Gate 1: Upstream Sync]
   └── Merge/rebase current migration branch with origin/main (31 commits divergence)
[Gate 2: Defect Resolution]
   └── Fix open CSM and Ask AI defects on unified branch
[Gate 3: Acceptance Execution]
   └── Independently execute end-to-end journey tests across all roles and clients
[Gate 4: Evidence Generation & Review]
   └── Assemble evidence JSON with artifact SHA-256 hashes; conduct human review
[Gate 5: Automated Verification]
   └── Execute `python scripts/verify-cutover-readiness.py --evidence <evidence.json>`
[Gate 6: Human Orchestrator Authorization]
   └── Final review and cutover authorization by orchestrator
```
