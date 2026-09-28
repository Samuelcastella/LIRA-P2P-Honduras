# PostgreSQL Backup and Restore Runbook

## Scope

This runbook covers the Railway-managed PostgreSQL database used by the LIRA
**sandbox** production environment.

Railway Postgres service:
`b45ef3d3-9eb8-4203-bd41-188d1acc3b47`

Volume:
`a08417d9-badf-4a46-bb2b-f42a1e88cc73`

Mount:
`/var/lib/postgresql/data`

## Policy

A deploy that can change the backend runtime is not allowed to proceed unless
there is a recent recovery point whose existence and timestamp are actually
verified.

A configured volume is **not** evidence that a recoverable backup exists.
A successful Postgres deployment is **not** evidence that a restore will work.

The cutover gate therefore remains blocked until both of these are recorded:

- a specific recoverable backup/PITR recovery point;
- a successful isolated restore drill using the same recovery mechanism.

## Recovery objectives for the current sandbox

Target RPO: 24 hours maximum.  
Target RTO: 2 hours maximum.

These are sandbox operational targets, not real-money service commitments.
A future regulated/real-money phase must set materially tighter objectives
based on business and regulatory requirements.

## Pre-cutover backup verification

Before a canonical backend cutover:

1. Open the Railway Postgres service's **Backups** view.
2. Verify scheduled volume backups are enabled.
3. Record the latest completed backup timestamp.
4. If PITR is enabled, record the available archive window and the newest
   recovery timestamp.
5. Confirm the recovery point predates the cutover and is recent enough to
   satisfy the sandbox RPO.
6. Record the recovery point in the cutover evidence.
7. Do not mark `backupRecoveryPoint=verified` from configuration inference;
   verify the actual recovery point.

Railway documentation reference:
`https://docs.railway.com/guides/postgres-backups-restores`

## Restore drill

The preferred proof is a restore into an isolated disposable environment,
never over the active production database.

For LIRA, the canonical read-only verification command is:

```bash
RESTORE_VALIDATION_DATABASE_URL="<restored database connection>" \
  node scripts/verify-restored-postgres.mjs
```

The validator opens a read-only transaction, emits aggregate/schema evidence
only, compares applied migration checksums with the repository migration files,
and exits nonzero if required tables, migrations, triggers, HNL constraints, or
journal balance invariants are not satisfied. Do not point this command at the
active production database during a restore drill.

1. Select the verified backup/recovery point.
2. Restore it to an isolated environment or restored volume according to
   Railway's supported restore workflow.
3. Do not route production services to it.
4. Start a disposable PostgreSQL instance from the restored data.
5. Verify:
   - the database starts successfully;
   - `lira_schema_migrations` exists;
   - every applied migration checksum matches the repository;
   - expected financial tables exist;
   - audit and ledger immutability triggers exist;
   - basic read-only counts can be obtained;
   - no manual repair is required to open the database.
6. Run a read-only consistency check for:
   - transfers;
   - journals;
   - ledger entries;
   - outbox events;
   - reconciliation items;
   - audit events.
7. Record start time, end time, recovery point, outcome, and observed restore
   duration.
8. Destroy the disposable restore after evidence is retained.

Only after this drill passes may
`ops/cutover-readiness.json.gates.restoreVerification` become `verified`.

## Production restore decision

A production restore is an incident response action. It requires evidence that
the database, not merely the application, is damaged or unusable.

Before restoring production:

1. pause new sandbox transfers;
2. preserve logs and current deployment IDs;
3. identify the incident start time;
4. choose the recovery point that minimizes confirmed data loss;
5. document expected RPO impact;
6. obtain an explicit incident decision;
7. restore using Railway's supported workflow;
8. do not delete the previous volume until the restored service is verified.

Railway's volume restore workflow stages a restored volume before deployment.
Review the staged change before applying it.

## Post-restore validation

After any production restore:

1. verify Postgres is healthy;
2. run `node scripts/migrate.mjs` and confirm no checksum mismatch;
3. verify immutable audit and ledger protections still exist;
4. keep transfer creation paused;
5. start reconciliation and inspect every unresolved transfer spanning the
   recovery window;
6. compare provider/outbox evidence to the restored internal state;
7. only resume new transfers after reconciliation is understood;
8. retain the old volume until the incident is formally closed.

## Prohibited shortcuts

Never:

- overwrite production merely because a deployment failed;
- delete migration-history rows to bypass checksum protection;
- edit ledger entries to make balances look correct;
- delete audit rows;
- infer backup success from a running database;
- mark the restore gate verified without a real restore drill.
