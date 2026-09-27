# Lira P2P Honduras

Private deployment repository for the Lira Honduras financial sandbox.

## Deployment baseline
- Hardened source archive: `lira-p2p-honduras-hardened-v2.zip`
- SHA-256: `da7ac1eca870285189638812a5bc36bbc6b321637afe7f729c771e3451f84a90` (updated — see "Patches applied" below)
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

## Patches applied

Found by running `pnpm check`/`pnpm test`/`pnpm build:*` against the archive before wiring up CI
(none of these were caught before this archive was pushed):

1. `apps/web/index.mjs`'s API proxy referenced an undefined `proxy` variable instead of
   `upstream` — a `ReferenceError` on the very first `/api/*` request in production.
2. `client/src/pages/Home.tsx` read `result.paymentRequest.id` after creating a payment request,
   but `createPaymentRequest` (`server/db.ts`) returns `{ request, replayed }`, not
   `{ paymentRequest, replayed }` — this threw at runtime on every "solicitar pago" flow.
3. Same file compared `operationalControls.enabled` (a real `boolean` column) against the number
   `0` (`!== 0`) instead of `!== false` — a type error that also meant the kill-switch read as
   permanently "enabled" regardless of its actual value.

Repackaged with only these three lines changed (verified: unzip → diff against the previous tree
shows no other differences). SHA-256 updated above and in `lira-p2p-honduras-hardened-v2.sha256`.
`pnpm install && pnpm check && pnpm test && pnpm build:api && pnpm build:worker && pnpm
build:reconciliation && pnpm build:web` all pass against the repackaged archive.
