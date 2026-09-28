# Restore Drill Evidence — 2026-09-28

## Scope

Disposable point-in-time restore validation for the LIRA sandbox production
PostgreSQL database. The active production database was not modified by this
drill.

## Restored database

- Railway service: `Postgres-restored-20260928-0924`
- Service ID: `4c62e340-a128-4d1d-84f4-4b5dc1e8e054`
- Restore deployment ID: `29b2d02a-541c-409f-8e4d-e7fe51a74c18`
- PostgreSQL: 18
- PITR stopped after commit of transaction 777 at
  `2026-09-28 09:24:42.116473+00`
- Archive recovery completed at `2026-09-28T10:40:24.704Z`
- Database reported ready to accept connections at
  `2026-09-28T10:40:25.053Z`

Railway logs showed WAL segments restored from the pgBackRest archive and a
consistent recovery state before the database opened for connections.

## Read-only validator

- Service: `restore-validator-20260928-v2`
- Service ID: `a14cd51b-9785-4647-bf6e-a6846120a6bb`
- Deployment ID: `c130f30d-1f48-4b19-825f-8c962d5b656a`
- Git commit: `2e66c8af41ee2cc4a3726da571ffb4a1f975baba`
- Command: `node scripts/verify-restored-postgres.mjs`
- Restart policy: `NEVER`
- Database reference: Railway reference to the restored database only
- Validation transaction: read-only

The validator deployment completed with Railway status `SUCCESS`.

## Validation result

Result: **VALIDATION_SUCCESS**

PostgreSQL:

- server version: `18.6 (Debian 18.6-1.pgdg13+2)`
- `pg_is_in_recovery() = false`

Migrations recovered and checksum-matched repository files:

1. `001_initial_postgres.sql`
   - `79aa8576f835a2c39c9d8037f066d1c1783fddbf30d05f5f7ad0112be1fe5aa0`
2. `002_audit_events_immutability.sql`
   - `a136fedcc9c263fe91e0ecaa9c24b5237398492dfd7c1b87db8fc3b69505ad48`
3. `003_outbox_dead_letter.sql`
   - `43014588cac8f744ee970e2ff7148858892d10d8358a36910321d930711de467`

No required migration was missing and there were zero checksum mismatches.

Required tables recovered:

- `users`
- `transfers`
- `journal_transactions`
- `ledger_entries`
- `outbox_events`
- `reconciliation_items`
- `audit_events`
- `operational_controls`

The recovered snapshot contained no user/transfer/ledger/audit rows at the PITR
target; `operational_controls` contained one row. This is consistent with the
sandbox snapshot at that recovery point and does not weaken the schema-level
restore proof.

Required database triggers recovered:

- `audit_events_no_delete`
- `audit_events_no_update`
- `ledger_entries_immutable`
- `ledger_journal_balance_check`
- `posted_journals_immutable`

Operational control:

- `transfers_enabled = false`
- reason: `Default deny until sandbox validation gate is explicitly approved`

Integrity summaries:

- unbalanced journals: `0`
- non-HNL transfers: `0`
- non-HNL ledger entries: `0`

## Conclusion

The production backup/PITR mechanism has now been proven through an isolated
restore and a read-only database validation against the restored PostgreSQL 18
instance.

This closes the `restoreVerification` cutover gate for the current sandbox
backend migration. It does not authorize real-money operation.

The restored database and validator service are intentionally retained
temporarily as evidence until cleanup is explicitly performed.
