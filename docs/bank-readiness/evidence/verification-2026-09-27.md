# Verification Evidence — 2026-09-27 — Worker/Reconciliation Resilience and Audit Immutability

## Scope

This evidence covers three additions to the LIRA **sandbox** backend:

1. **Outbox dispatch retry, backoff and dead-letter** (`dispatchPendingSandboxOutbox`, `server/db.ts`). A dispatch failure no longer sits in `unknown` indefinitely with no further automated attempt: the worker now re-picks up `unknown` events after a backoff window (`LIRA_OUTBOX_RETRY_BACKOFF_MS`, default 30s), up to `LIRA_OUTBOX_MAX_ATTEMPTS` (default 5). Once exhausted, the event moves to a new terminal `dead_letter` status and a review-severity `risk_events` row is raised, so an operator — not a silent loop — resolves it.
2. **Reconciliation staleness escalation** (`reconcilePendingSandboxTransfers`, `server/db.ts`). A transfer that stays `processing`/`unknown` past `LIRA_RECONCILIATION_STALE_MS` (default 15 minutes) with no resolving provider signal raises a single review-severity `risk_events` row (guarded against duplicate escalation on every subsequent tick).
3. **Database-enforced audit immutability** (bank-readiness finding BR-005). `audit_events` now has `BEFORE UPDATE` and `BEFORE DELETE` triggers that unconditionally reject any mutation, including from the table's owning role — a `REVOKE` grant would not have been sufficient here, since PostgreSQL table owners bypass ACL checks on objects they own.

## Migration review and database verification

Two new migrations were reviewed before execution:

- `db/migrations/002_audit_events_immutability.sql` — adds a trigger function and two `BEFORE` triggers on `audit_events`. No existing rows are touched; `INSERT` is unaffected.
- `db/migrations/003_outbox_dead_letter.sql` — adds the `dead_letter` value to the `outbox_status` enum via `ALTER TYPE ... ADD VALUE`, safe inside its own transaction since the new value is not used within the same migration file.

Both were applied against a disposable local PostgreSQL 16 instance (not the shared sandbox database) alongside the existing `001_initial_postgres.sql`, from a clean schema, confirming the full migration chain still applies cleanly end-to-end.

## Automated validation

| Check | Command | Result |
| --- | --- | --- |
| Migrations (clean chain, local Postgres 16) | `node scripts/migrate.mjs` | Passed: 001, 002, 003 applied |
| Audit immutability (real database) | `node scripts/verify-audit-immutability.mjs` | Passed: UPDATE and DELETE both rejected by the database |
| Worker/reconciliation resilience (real database) | `pnpm exec tsx scripts/verify-worker-reconciliation.mts` | Passed: dead-letter after exhausted retries; staleness escalated exactly once across repeated ticks |
| Type safety | `pnpm check` | Passed |
| Unit tests | `pnpm test` | Passed: 4 files, 17 tests |
| Production build (api/worker/reconciliation) | `pnpm build:api && pnpm build:worker && pnpm build:reconciliation` | Passed |

`scripts/verify-worker-reconciliation.mts` forces `SandboxBankAdapter.createTransfer` to throw for one scenario, since the in-process sandbox adapter never fails on its own — this is the only way to exercise the exhausted-retries path without a real provider outage.

`.github/workflows/ci.yml` gained a `hardened-backend` job that runs both verification scripts against a real `postgres:16` service container on every push, closing part of finding BR-004 ("no database integration tests").

## Verification limitations

- The staleness threshold and retry backoff are fixed windows read from environment variables, not per-event exponential backoff (`nextAttemptAt` would need its own schema column) — acceptable for a sandbox, worth revisiting before a real-money pilot.
- Still untested: multi-node/concurrent worker instances claiming the same outbox event (the claim is a single conditional `UPDATE ... WHERE status = ...`, which should be race-safe, but no concurrency test proves it under real parallel load).
- The dead-letter and escalation paths were proven against the in-process `SandboxBankAdapter` with a forced failure, not against a real external provider's actual failure modes (timeouts, partial responses, rate limiting).
