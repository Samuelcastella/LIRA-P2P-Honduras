# Canonical PostgreSQL migration status

This branch migrates the canonical backend persistence layer from MySQL to PostgreSQL while the production backend remains archive-backed.

## Safety state

- `canonicalBackendMigrationReady` remains `false`.
- Railway backend artifact sources remain on `lira-p2p-honduras-hardened-v2.zip`.
- Real-money mode remains disabled.
- No production cutover is authorized by this document.

## Validation required before cutover

1. Canonical PostgreSQL migrations apply cleanly to a fresh PostgreSQL database.
2. TypeScript, unit tests, production builds, and all three canonical service builds pass.
3. Worker retry/backoff/dead-letter behavior matches the hardened baseline.
4. Reconciliation escalation and financial invariants are verified against PostgreSQL.
5. Device-trust, OTP-purpose separation, payment-request shape, and OAuth contracts remain compatible.
6. Rollback remains possible before any Railway artifact-source switch.

The pull request stays draft until the full canonical CI is green and the migration exit criteria are explicitly reviewed.
