# Canonical Backend Cutover and Rollback Runbook

## Purpose

Move the LIRA **sandbox** backend from the hardened archive
`lira-p2p-honduras-hardened-v2.zip` to canonical repository source without
changing the real-money posture. This runbook is intentionally fail-closed.

This runbook does **not** authorize real-money operation.

## Production baseline

Railway project: `ece4ee7f-f271-435d-b93f-bf09a3b5955a`  
Environment: `production` / `1b9d75d3-c6ff-43fa-b9a9-9c89962be710`

| Service | Railway service ID | Hardened rollback Dockerfile | Canonical candidate | Healthcheck |
| --- | --- | --- | --- | --- |
| lira-api | `633b7001-fbfc-4004-b95d-0eb5c9b25bd8` | `Dockerfile.api` | `ops/docker/canonical/Dockerfile.api` | `/ready` |
| lira-worker | `10c9263f-c5e9-4d6b-af71-3d7f8b576d75` | `Dockerfile.worker` | `ops/docker/canonical/Dockerfile.worker` | `/health` |
| lira-reconciliation | `86e8759c-4e43-49f6-b6fe-0ef7f685a26f` | `Dockerfile.reconciliation` | `ops/docker/canonical/Dockerfile.reconciliation` | `/health` |
| Postgres | `b45ef3d3-9eb8-4203-bd41-188d1acc3b47` | managed image | managed image | n/a |

Current backend artifact source: `lira-p2p-honduras-hardened-v2.zip`.

The API currently runs `node scripts/migrate.mjs` as its Railway pre-deploy
command. Keep that migration gate in place during the canonical cutover.

The root hardened Dockerfiles are **not overwritten** by the cutover. They stay
intact as the last-known-good application rollback path. The canonical switch is
a Railway `dockerfilePath` + watch-pattern change to the pre-tested candidate.

## Non-negotiable preconditions

All conditions below must be true before the first backend service is switched:

1. `ops/cutover-readiness.json` has every mandatory gate at `verified`.
2. `ops/backend-reconciliation.json.canonicalBackendMigrationReady` is
   explicitly `true`.
3. GitHub CI on the exact candidate commit is green for sandbox validation,
   canonical PostgreSQL 16 and 18, hardened rollback PostgreSQL 16 and 18, and
   the `LIRA Cutover Readiness` candidate-image smoke workflow.
4. The candidate workflow has built all three canonical images, executed the API
   pre-deploy migration command twice on PostgreSQL 18, and received HTTP 200
   from `/ready`, `/health`, and `/health` respectively.
5. Railway **Wait for CI** remains enabled for API, Worker, and Reconciliation.
6. A recent **recoverable** PostgreSQL backup/recovery point is identified by
   timestamp and retained for the cutover window.
7. A restore from the same backup mechanism has been proven in an isolated
   disposable environment.
8. `LIRA_SANDBOX_ONLY=true` and `LIRA_REAL_MONEY_ENABLED=false` are present
   on API, worker, and reconciliation.
9. No unrelated Railway staged changes are pending and the existing backend
   deployments are healthy.
10. The sandbox transfer kill switch is in the conservative state selected for
    the maintenance window; if uncertain, pause new transfers before cutover.
11. Record the exact pre-cutover Git commit and current deployment IDs for all
    three backend services.

If any precondition is false, stop. Do not "try the deployment and see."

## Candidate image requirements

The canonical candidates under `ops/docker/canonical/` must:

- build from repository root;
- use `pnpm install --frozen-lockfile`;
- build only the intended service entrypoint;
- retain production-only dependencies in runtime;
- run as non-root `node`;
- default to `NODE_ENV=production`, `LIRA_SANDBOX_ONLY=true`, and
  `LIRA_REAL_MONEY_ENABLED=false`;
- expose the existing healthcheck port;
- contain no credentials;
- preserve the existing service command;
- for API, contain `scripts/` and `db/migrations/` so Railway's
  `node scripts/migrate.mjs` pre-deploy command is executable inside the image.

## Change construction

Do not switch all three services in one change. Use three independently
reviewable and observable Railway changes:

1. API `dockerfilePath` + canonical watch patterns.
2. Worker `dockerfilePath` + canonical watch patterns.
3. Reconciliation `dockerfilePath` + canonical watch patterns.

Do **not** rewrite or delete `Dockerfile.api`, `Dockerfile.worker`, or
`Dockerfile.reconciliation`; those root files remain the archive-backed rollback
boundary. Update the deployment contract only with the service whose cutover is
being performed.

## Cutover order

### Step 1 — API

1. Confirm backup, restore, candidate-image smoke, and Wait-for-CI gates again.
2. Change Railway `lira-api` `dockerfilePath` to
   `ops/docker/canonical/Dockerfile.api` and apply the reviewed canonical watch
   patterns.
3. Redeploy the exact reviewed `main` commit and wait for `SUCCESS`.
4. Require `node scripts/migrate.mjs` pre-deploy to succeed.
5. Confirm `/ready` returns HTTP 200 and `service_started` appears.
6. Confirm no `fatal_startup_error`, `readiness_check_failed`, database error,
   or migration checksum error.
7. Run a read-only application smoke check and confirm authentication/session
   bootstrap still works.
8. If any verification fails, restore `Dockerfile.api` + hardened watch
   patterns, redeploy, and stop. Do not proceed to Worker.

### Step 2 — Worker

Proceed only if API remains healthy.

1. Change Railway `lira-worker` `dockerfilePath` to
   `ops/docker/canonical/Dockerfile.worker` and apply canonical watch patterns.
2. Redeploy and wait for `SUCCESS`.
3. Confirm `/health` returns HTTP 200 and `dispatch_cycle_completed` events
   appear.
4. Confirm `consecutiveFailures < 3` and no unexplained rise in `unknown` or
   `deadLettered`.
5. If a sandbox transfer is exercised, verify idempotency and one provider
   intent dispatch.
6. On failure, restore `Dockerfile.worker` + hardened watch patterns, redeploy,
   and stop.

### Step 3 — Reconciliation

Proceed only if API and Worker remain healthy.

1. Change Railway `lira-reconciliation` `dockerfilePath` to
   `ops/docker/canonical/Dockerfile.reconciliation` and apply canonical watch
   patterns.
2. Redeploy and wait for `SUCCESS`.
3. Confirm `/health` returns HTTP 200 and `reconciliation_cycle_completed`
   events appear.
4. Confirm `consecutiveFailures < 3` and investigate every unexpected
   `escalated > 0` before declaring success.
5. On failure, restore `Dockerfile.reconciliation` + hardened watch patterns and
   redeploy.

## Success criteria

The cutover is complete only when all three services:

- report healthy through their configured Railway healthchecks;
- have latest deployment status `SUCCESS`;
- run the expected canonical commit;
- show no repeated startup/tick failures;
- preserve sandbox-only runtime guards;
- pass post-cutover smoke checks;
- retain a clean reconciliation state for the observation window.

Record deployment IDs, Git commit, backup recovery point, start/end time, and
operator in the evidence file.

## Automatic rollback triggers

Rollback the affected service immediately on failed migration checksum, unstable
health, three consecutive Worker/Reconciliation tick failures, ledger invariant
failure, duplicate provider dispatch, unreconstructable transfer state,
reconciliation divergence, audit-write failure, crash loop, missing sandbox guard,
or unstable database connectivity.

Do not attempt a forward fix in production while a financial invariant is in
doubt.

## Service rollback

The primary rollback is application-only because canonical PostgreSQL migrations
must remain additive and compatible with the hardened baseline.

For the affected service:

1. Stop progressing to later services.
2. Change Railway `dockerfilePath` back to its root hardened Dockerfile.
3. Restore the hardened ZIP watch patterns.
4. Redeploy only that service.
5. Confirm its original healthcheck returns HTTP 200 and the deployment reaches
   `SUCCESS`.
6. Confirm no migration checksum mismatch exists.
7. Run reconciliation before resuming transfer creation.
8. Preserve logs, Git SHA, and deployment IDs for incident review.

For a full rollback, use reverse dependency order:
`lira-reconciliation` → `lira-worker` → `lira-api`.

Do **not** delete migration rows or manually mutate ledger/audit data during an
application rollback.

## Database rollback / restore

Database restore is a separate incident-level action, not the normal response to
an application deployment failure. Use it only when data itself is known to be
damaged and follow `docs/runbooks/postgres-backup-restore.md`.

Never restore the database merely to make an application deployment green.

## Post-cutover

After the observation window:

1. update `ops/deployment-contract.json` evidence to canonical repository source
   for successfully migrated services;
2. retain the hardened archive and root Dockerfiles for the agreed rollback
   retention period;
3. update bank-readiness evidence with exact deployment/run IDs;
4. do not enable real money or connect a real provider as part of this change.
