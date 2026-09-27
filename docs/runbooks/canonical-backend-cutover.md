# Canonical Backend Cutover and Rollback Runbook

## Purpose

Move the LIRA **sandbox** backend from the hardened archive
`lira-p2p-honduras-hardened-v2.zip` to the canonical repository source without
changing the real-money posture. This runbook is intentionally fail-closed.

This runbook does **not** authorize real-money operation.

## Production baseline

Railway project: `ece4ee7f-f271-435d-b93f-bf09a3b5955a`  
Environment: `production` / `1b9d75d3-c6ff-43fa-b9a9-9c89962be710`

| Service | Railway service ID | Current Dockerfile | Current healthcheck |
| --- | --- | --- | --- |
| lira-api | `633b7001-fbfc-4004-b95d-0eb5c9b25bd8` | `Dockerfile.api` | `/ready` |
| lira-worker | `10c9263f-c5e9-4d6b-af71-3d7f8b576d75` | `Dockerfile.worker` | `/health` |
| lira-reconciliation | `86e8759c-4e43-49f6-b6fe-0ef7f685a26f` | `Dockerfile.reconciliation` | `/health` |
| Postgres | `b45ef3d3-9eb8-4203-bd41-188d1acc3b47` | managed image | n/a |

Current backend artifact source: `lira-p2p-honduras-hardened-v2.zip`.

The API currently runs `node scripts/migrate.mjs` as its Railway pre-deploy
command. Keep that migration gate in place during the canonical cutover.

## Non-negotiable preconditions

All conditions below must be true before the first backend service is switched:

1. `ops/cutover-readiness.json` has every mandatory gate at `verified`.
2. `ops/backend-reconciliation.json.canonicalBackendMigrationReady` is
   explicitly `true`.
3. GitHub CI on the exact candidate commit is green for:
   - sandbox source validation;
   - canonical source against PostgreSQL 16;
   - hardened archive against PostgreSQL 16.
4. A recent **recoverable** PostgreSQL backup/recovery point is identified by
   timestamp and retained for the cutover window.
5. A restore from the same backup mechanism has been proven in an isolated
   disposable environment.
6. `LIRA_SANDBOX_ONLY=true` and `LIRA_REAL_MONEY_ENABLED=false` are present
   on API, worker, and reconciliation.
7. No unrelated Railway staged changes are pending.
8. The existing three backend deployments are healthy before starting.
9. The sandbox transfer kill switch is set to the conservative state chosen
   for the maintenance window; if there is any uncertainty, pause new
   transfers before the first service cutover.
10. The operator has the exact pre-cutover Git commit and the three current
    Railway deployment IDs recorded in the change log.

If any precondition is false, stop. Do not "try the deployment and see."

## Pre-staged canonical deployment artifacts

Canonical containers are pre-staged under alternate filenames:

- `Dockerfile.api.canonical`
- `Dockerfile.worker.canonical`
- `Dockerfile.reconciliation.canonical`

They are built in CI before cutover. The existing archive-backed Dockerfiles
remain untouched and remain the rollback target.

This avoids using a Git merge itself as the production switch. The actual
cutover is an explicit Railway configuration change, one service at a time:

1. change that service's `dockerfilePath` to its `.canonical` Dockerfile;
2. replace its watch patterns with the canonical watch-pattern set recorded in
   `ops/deployment-contract.json`;
3. explicitly redeploy only that service;
4. observe and verify before moving to the next service.

Each canonical Dockerfile:

- builds from repository root;
- uses `pnpm install --frozen-lockfile`;
- builds only the intended service entrypoint;
- prunes development dependencies before the runtime stage;
- copies only runtime dependencies/artifacts required by that service;
- runs as a non-root user;
- preserves `NODE_ENV=production`;
- exposes the existing healthcheck port;
- contains no credentials;
- preserves the existing service command.

Do not overwrite or delete the hardened Dockerfiles during the cutover window.

## Cutover order

### Step 1 — API

1. Confirm the backup and restore gates again.
2. Merge only the API cutover change.
3. Wait for Railway build and deployment to reach `SUCCESS`.
4. Confirm `/ready` returns HTTP 200.
5. Confirm structured startup log event `service_started`.
6. Confirm there is no `fatal_startup_error`,
   `readiness_check_failed`, database error, or migration checksum error.
7. Run a read-only application smoke check.
8. Confirm authentication/session bootstrap still works.
9. Do not proceed for at least one observation cycle if any error rate is
   rising.

### Step 2 — Worker

Proceed only if API remains healthy.

1. Update only `lira-worker` to `Dockerfile.worker.canonical` and its canonical watch patterns.
2. Explicitly redeploy only `lira-worker`.
3. Wait for Railway `SUCCESS`.
4. Confirm `/health` returns HTTP 200.
5. Confirm `dispatch_cycle_completed` structured events appear.
6. Confirm `consecutiveFailures < 3`.
7. Confirm there is no unexpected increase in `unknown` or
   `deadLettered`.
8. If a sandbox transfer is exercised, verify its idempotency and that the
   provider-intent outbox is processed once.

### Step 3 — Reconciliation

Proceed only if API and worker remain healthy.

1. Update only `lira-reconciliation` to `Dockerfile.reconciliation.canonical` and its canonical watch patterns.
2. Explicitly redeploy only `lira-reconciliation`.
3. Wait for Railway `SUCCESS`.
4. Confirm `/health` returns HTTP 200.
5. Confirm `reconciliation_cycle_completed` events appear.
6. Confirm `consecutiveFailures < 3`.
7. Investigate every unexpected `escalated > 0` before declaring success.

## Success criteria

The cutover is complete only when all three services:

- report healthy through their configured Railway healthchecks;
- have a latest deployment status of `SUCCESS`;
- are running the expected canonical commit;
- show no repeated startup/tick failures;
- preserve the sandbox-only runtime guards;
- pass a post-cutover smoke flow;
- retain a clean reconciliation state for the observation window.

Record the deployment IDs, Git commit, backup recovery point, start/end time,
and operator in the evidence file.

## Automatic rollback triggers

Rollback the affected service immediately if any of these occur:

- failed migration checksum;
- API readiness remains non-200;
- three consecutive worker or reconciliation tick failures;
- unexpected ledger invariant error;
- unexplained duplicate provider dispatch;
- transfer state cannot be reconstructed;
- reconciliation divergence increases after cutover;
- audit writes fail;
- service repeatedly crashes/restarts;
- sandbox-only guard is not active;
- database connectivity becomes unstable.

Do not attempt a forward fix in production while a financial invariant is in
doubt.

## Service rollback

Because the canonical PostgreSQL migrations are additive and the hardened
archive is the compatibility baseline, the primary rollback is an application
rollback:

1. Stop progressing to later services.
2. Set the affected Railway service's `dockerfilePath` back to its hardened
   Dockerfile (`Dockerfile.api`, `Dockerfile.worker`, or
   `Dockerfile.reconciliation`).
3. Restore that service's hardened watch patterns from
   `ops/deployment-contract.json`.
4. Explicitly redeploy only the affected service.
5. Confirm its original healthcheck returns 200.
6. Confirm no new migration checksum mismatch exists.
7. Run reconciliation before resuming transfer creation.
8. Preserve all logs and deployment IDs for incident review.

Do **not** delete migration rows or manually mutate ledger/audit data as part of
an application rollback.

## Database rollback / restore

A database restore is a separate incident-level action and is not the normal
response to an application deployment failure. Use it only when data itself is
known to be damaged and follow
`docs/runbooks/postgres-backup-restore.md`.

Never restore the database merely to make an application deployment green.

## Post-cutover

After the observation window:

1. update `ops/deployment-contract.json` evidence to canonical repository
   source for all successfully migrated services;
2. retain the hardened archive for the agreed rollback-retention period;
3. update the bank-readiness evidence with the exact deployment/run IDs;
4. do not enable real money or connect a real provider as part of this change.
