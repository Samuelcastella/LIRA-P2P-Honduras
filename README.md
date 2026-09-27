# Lira P2P Honduras

Private deployment repository for the Lira Honduras financial sandbox.

## Deployment baseline
- Hardened source archive: `lira-p2p-honduras-hardened-v2.zip`
- SHA-256: `f530940553860ccdf0fec76caafbff10183720bfdb463d55d4ac9031885b4ace`
- Country/currency scope: Honduras / HNL
- Sandbox only; real-money execution remains disabled.
- PostgreSQL and Redis are isolated in Railway.
- Web has no direct database/cache credentials; it proxies to the API.

## Hardening included
- double-entry journals and immutable compensating reversals
- explicit balance reservations/holds
- ambiguous provider outcomes use `UNKNOWN` + reconciliation
- device trust requires fresh authentication, second factor and cooling period
- PostgreSQL migration with advisory lock/checksum ledger
- Redis-backed anti-abuse controls on sensitive endpoints
- separated API / worker / reconciliation / web entrypoints
- operational kill-switch defaults closed

## Release blockers before real money
1. Replace prototype/Manus OAuth with an approved production identity architecture.
2. Regenerate and commit a frozen pnpm lockfile for the PostgreSQL dependency graph.
3. Pass remote build/typecheck/unit/integration/concurrency/reconciliation suites.
4. Complete Honduras regulatory classification and regulated-provider agreements.
5. Complete KYC/AML, incident, safeguarding, consumer-protection and bank-readiness gates.

The original `lira-p2p-honduras.zip` is retained as a traceable baseline and is not considered production-ready.
