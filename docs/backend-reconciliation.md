# LIRA canonical backend reconciliation

## Purpose

The repository currently contains two backend representations:

- the **deployed hardened baseline** packaged as `lira-p2p-honduras-hardened-v2.zip`;
- the **canonical root source** under `server/**` and `drizzle/**`, where reconciliation and new reviewed changes are being accumulated.

The root backend is **not yet authorized to replace** the archive-backed API, worker, or reconciliation services. This is intentional.

## Current AS-IS

| Area | Hardened baseline | Canonical root | Status |
| --- | --- | --- | --- |
| Sandbox-only / real money disabled | Required | Required | aligned |
| Currency model | HNL integer minor units | HNL integer minor units | aligned |
| OAuth callback + state/nonce CSRF contract | hardened source | exact-parity source | aligned |
| Security policy / device trust primitives | hardened source | semantically compatible and intentionally stricter | aligned with canonical hardening |
| Ledger / idempotency / audit / reconciliation concepts | present | present | semantic parity gate |
| Trusted-device lifecycle | baseline implementation | hardened further with persisted failure counters, restricted-device protection, deferred enrollment OTP | canonical is stricter |
| Provider abstraction / signed webhooks / unknown state | present | present | semantic parity gate |
| Database dialect | PostgreSQL | MySQL | **blocking mismatch** |
| Backend deployment source | hardened ZIP | root source is reconciliation-only | intentionally archive-backed |

## P0 blocker: database dialect

The hardened artifact uses PostgreSQL/Drizzle PostgreSQL primitives while the canonical root currently uses MySQL/Drizzle MySQL primitives. A Dockerfile switch would therefore be unsafe even when TypeScript and unit tests pass.

No backend deployment source may be changed from the hardened ZIP until there is an explicit database strategy. The accepted outcome must be one of:

1. migrate the canonical backend to PostgreSQL and verify migration compatibility; or
2. deliberately migrate the hardened behavior to MySQL, including reviewed schema/data migration, concurrency semantics, indexes, transactions, rollback, and reconciliation evidence.

This decision is architectural and must not be hidden inside a Dockerfile edit.

## Automated reconciliation evidence

`scripts/validate-backend-reconciliation.mjs` opens the hardened ZIP during CI and compares the canonical repository against the deployed baseline. It currently enforces:

- sandbox-only deployment while reconciliation is incomplete;
- archive-backed API/worker/reconciliation services while `canonicalBackendMigrationReady=false`;
- detected versus declared database dialects;
- exact parity for the OAuth callback contract and semantic parity for the security/financial domains;
- presence of the critical ledger, idempotency, provider, webhook, outbox, reconciliation, payment-request, audit, and device-trust contracts in both representations;
- canonical trusted-device safeguards that are intentionally stricter than the old baseline.

The machine-readable state is `ops/backend-reconciliation.json`.

## Exit criteria before canonical backend cutover

The migration flag stays false until all of these are evidenced:

1. Database dialect and migration strategy reconciled.
2. Authentication/session behavior verified against the currently working login path.
3. Ledger invariants and idempotency verified under concurrency.
4. Transfer state machine and provider ambiguous-state behavior verified.
5. Signed webhook replay protection and out-of-order handling verified.
6. Reconciliation and outbox recovery verified after crash/retry scenarios.
7. Device trust, PIN/OTP attempt limits, revocation, and restricted-device behavior verified.
8. API, worker, and reconciliation entrypoints build from canonical source independently.
9. Backup/rollback procedure is documented and tested.
10. CI and review gates are green.

Only after those conditions are met should `canonicalBackendMigrationReady` be changed to true and the three backend Dockerfiles/watch patterns be migrated in the same reviewed release.
