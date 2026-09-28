# Bank Readiness Audit — LIRA Sandbox — 2026-09-26

## Executive summary

The reviewed workspace has been evolved from a UI-only P2P prototype into an **authenticated, database-backed sandbox** with a user-scoped idempotency key, explicit payment state transitions, double-entry journal construction, explainable risk decisions, audit events, a sandbox reconciliation record, a transactional provider-intent outbox, signed callback verification, PIN-plus-OTP verification for new transfer intents, user-scoped device/session records, atomic OTP consumption, PIN rotation safeguards, daily intent reservations, and an administrator-operated transfer kill switch.

This is **not a real-money system**. The implementation has no external bank provider, production-delivery OTP channel, independently verifiable device control, production observability, recovery evidence or regulated operational process. The present decision is therefore **NOT_READY** for bank due diligence, provider production integration, controlled real-money pilot or production release.

## Decision

**NOT_READY**

## Scope and evidence reviewed

| Item | Evidence |
| --- | --- |
| Workspace baseline | WebDev checkpoint `8aa9ebaf`; implementation changes reviewed in the current working tree prior to a new checkpoint |
| Financial schema | `drizzle/schema.ts`, `drizzle/0001_living_revanche.sql`, `drizzle/0002_lively_roulette.sql`, `drizzle/0003_tidy_micromacro.sql`, `drizzle/0004_fast_radioactive_man.sql`, `drizzle/0005_nifty_komodo.sql` |
| Financial service | `server/db.ts`, `server/financial/domain.ts` |
| API contracts and authorization | `server/routers.ts`, `server/_core/trpc.ts` |
| Client handling | `client/src/pages/Home.tsx` |
| Tests | `pnpm test`: 4 files, 16 tests passing |
| Type and build validation | `pnpm check`; `pnpm build`: passing |
| Dependency scan | `pnpm audit --prod`: 0 critical, 0 high, 0 moderate, 0 low |
| Database migration verification | All 17 domain tables present in the sandbox database |

### Scope limitations

- No bank, card, ACH, or wallet provider was connected.
- No production environment, CI/CD pipeline, infrastructure-as-code, backup restore, queue, device service or secret manager was reviewed.
- Browser/OS biometrics, OTP, PIN, KYC, sessions/devices, provider webhooks and real-money settlement were not implemented.
- The current review did not substitute for an independent penetration test, legal/compliance review, or regulated financial due diligence.

## Financial integrity

### Evidence-backed controls

- Amounts use positive safe **integer minor units** in `HNL`.
- `createBalancedJournal` creates exactly one debit and one credit, and `assertBalancedJournal` rejects mismatches or same-account posts.
- `transfers.reference` is unique; `(senderUserId, idempotencyKey)` is unique.
- Replayed intent with same fingerprint returns the existing record; same key with a changed fingerprint is rejected.
- The transaction state map rejects impossible transitions, including `created → settled`.
- The settlement transaction writes transfer, risk event, ledger entries, reconciliation record and audit event together.
- Financial account balance is derived from `ledger_entries`; no editable balance column or administrative balance endpoint exists.
- Settlement writes a sandbox reconciliation item and does not automatically repair discrepancies.
- Provider dispatch creates a transactional outbox record; the transfer remains `processing` until an accepted provider callback posts the balanced journal.
- Payment requests support idempotent creation, requester-scoped cancellation and expiry transition; fulfilment is not yet implemented.

### Tests run

`server/financial/domain.test.ts` verifies balanced journal construction, mismatch rejection, same-account rejection, illegal transitions, idempotency conflicts, and risk velocity outcomes.

## Security and access controls

- Financial mutations use `protectedProcedure`; administrative mutations use `adminProcedure` and check the server-side `ctx.user.role`.
- A new transfer requires a verified, unexpired, user/session-bound OTP challenge; a conditional update consumes it exactly once within the transaction that creates the transfer intent.
- Sandbox PINs and OTPs are scrypt-hashed; failed PIN attempts lock the security profile after five attempts, and OTP attempts lock after five failures. PIN rotation requires the current PIN, rejects an unchanged value and revokes other sandbox security sessions after success.
- Device and security-session records are user-scoped; revoke procedures apply ownership checks, device revocation cascades to that device’s security sessions, and users can close all other sandbox security sessions.
- A per-transfer safety limit and an atomic UTC-day intent reservation prevent a new transfer from exceeding the explicit sandbox velocity policy. These limits do not replace production risk controls.
- Request shape and amount limits are validated with Zod.
- Audit metadata is hashed; financial audit writes intentionally exclude PINs, OTPs, raw tokens and account credentials.
- Dependencies were upgraded and unused vulnerable charting code was removed. The final production dependency scan has no reported vulnerabilities.

## Provider and operational readiness

- The current provider is `SandboxBankAdapter`, an in-process simulated adapter with a documented contract only.
- The sandbox callback endpoint fails closed without `SANDBOX_PROVIDER_WEBHOOK_SECRET`, verifies HMAC and timestamp, stores event outcomes, rejects reference mismatches, and ignores duplicate/out-of-order callbacks.
- A transfer kill switch persists in `operational_controls` and is accessible only through the admin procedure; audit is retained when the switch changes.
- Risk decisions are persisted with policy version `sandbox-v1`.
- The current reconciliation output is a simulated `match`; no external statement or webhook exists.

## Findings

| ID | Severity | Domain | Finding | Evidence | Required remediation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BR-001 | P1 | Provider/webhooks | No real provider adapter or network-timeout/retry/reconciliation evidence. A sandbox contract, HMAC callback verifier, dedupe store and out-of-order handling now exist. | `server/financial/provider.ts`, `server/financial/webhook.ts`, `server/db.ts`, `server/financial/provider.test.ts`. | Integrate a provider-specific adapter and sandbox, then run signed-event, replay, out-of-order, timeout and statement reconciliation integration tests. | Partially remediated |
| BR-002 | P1 | Identity | A sandbox PIN/OTP gate, attempt limits, atomic challenge consumption, user-scoped device/session records, PIN rotation with current-PIN verification, and revoke actions now exist. OTP delivery is displayed only for the sandbox, device fingerprints are client-attested, and no recovery, verified delivery channel, WebAuthn, primary-session rotation or step-up for sensitive profile changes exists. | `server/security/domain.ts`, `server/db.ts`, `drizzle/0004_fast_radioactive_man.sql`, `drizzle/0005_nifty_komodo.sql`, `server/security/domain.test.ts`. | Integrate a verified OTP delivery channel, independent device binding/WebAuthn, recovery, primary session rotation/revocation, fraud controls and database integration tests. | Partially remediated |
| BR-003 | P1 | Payments | Payment requests now support idempotent creation, requester-only cancellation and expiry, but cannot be fulfilled, declined by counterparty, or linked safely to a transfer. | `payment_requests`, `createPaymentRequest`, `cancelPaymentRequest`. | Implement counterparty identity binding and one-time fulfilment with concurrency tests. | Partially remediated |
| BR-004 | P1 | Financial resilience | The canonical PostgreSQL worker now retries failed outbox dispatch with bounded backoff, moves exhausted events to terminal `dead_letter`, raises review risk/audit evidence, and suppresses re-pickup after terminalization. Reconciliation escalates stale unresolved transfers once and also covers provider-reconciliation unavailability. Canonical and hardened paths run against real PostgreSQL 16 in CI. Still open for a future provider phase: multi-node load evidence and a real external-provider failure harness. | `server/db.ts`, `scripts/verify-canonical-worker-reconciliation.mts`, `db/migrations/003_outbox_dead_letter.sql`, `.github/workflows/ci.yml`, `evidence/verification-2026-09-27.md`. | Add multi-instance/concurrent-load tests and external provider timeout/rate-limit/partial-response tests when a real provider sandbox exists. | Partially remediated |
| BR-005 | P2 | Audit immutability | `audit_events` now has `BEFORE UPDATE`/`BEFORE DELETE` triggers that unconditionally reject any mutation, including from the table's owning role (a `REVOKE` alone would not suffice, since PostgreSQL owners bypass ACL checks on objects they own). Verified against a real Postgres instance with a dedicated script, and now runs in CI. | `db/migrations/002_audit_events_immutability.sql`, `scripts/verify-audit-immutability.mjs`, `evidence/verification-2026-09-27.md`. | None outstanding at the database layer for the current schema. Re-verify if `audit_events` is ever altered by a future migration. | Remediated |
| BR-006 | P2 | Observability | Canonical API readiness now checks PostgreSQL, worker/reconciliation expose sanitized health state and process counters, and all three backend services emit structured operational JSON events. A sandbox SLO/alerting baseline is documented. Durable metrics, alert routing, tracing and long-term dashboards are still absent. | `server/observability.ts`, `services/api/index.ts`, `services/worker/index.ts`, `services/reconciliation/index.ts`, `docs/operations/sandbox-slo-observability.md`. | Add durable metrics/alert routing/tracing before any provider-integrated or real-money phase. | Partially remediated |
| BR-007 | P2 | Operational readiness | Canonical cutover/rollback, incident response, PostgreSQL backup/restore, RPO/RTO targets and machine-readable cutover gates are documented and CI-enforced. Railway production service IDs/healthchecks are captured. Continuous PITR backup (pgBackRest) is active and a disposable PostgreSQL 18 restore was completed to transaction 777 at 2026-09-28 09:24:42.116473+00. The canonical read-only restore validator then completed with `VALIDATION_SUCCESS`: all required migrations checksum-matched, all required tables and immutable/balance triggers were present, `transfers_enabled=false`, and the aggregate integrity checks reported zero unbalanced journals and zero non-HNL financial rows. Candidate images had already passed dedicated PostgreSQL 18 smoke validation. The sandbox canonical cutover readiness gate is therefore closed; real-money/provider production readiness remains a separate scope. | `ops/cutover-readiness.json`, `docs/bank-readiness/evidence/restore-drill-2026-09-28.md`, `scripts/verify-restored-postgres.mjs`, `.github/workflows/cutover-readiness.yml`, `docs/runbooks/canonical-backend-cutover.md`, `docs/runbooks/postgres-backup-restore.md`, `docs/runbooks/incident-response.md`. | Preserve restore evidence, clean up the temporary restored/validator services after the change window, and repeat restore drills periodically or before material database changes. | Remediated for sandbox cutover |
| BR-008 | P3 | Product analytics | Weekly visual bars remain presentation-only and are not a financial reporting source. | `client/src/pages/Home.tsx`. | Replace with a separately audited reporting query before using it for operational decisions. | Open |

## Blockers and conditions

The P1 findings are blockers for any real-money, provider-integrated or bank-facing phase. A sandbox demo may continue only while it remains explicitly labeled as simulated and does not collect bank credentials or move funds.

## Required actions

1. Build and test provider adapter, signed webhook, asynchronous settlement/recovery and reconciliation workflows.
2. Implement and test identity, device and session controls before exposing financial mutations beyond the present authenticated sandbox.
3. Complete payment-request lifecycle with idempotent fulfilment and concurrency tests.
4. Add immutable audit enforcement, observability, secrets/CI checks, backup/restore and incident-response evidence.
5. Re-run this audit against a checkpointed release and an isolated staging environment before any bank discussion involving technical claims.

## Evidence index

- `architecture/system-architecture.md`
- `policies/ledger-invariants.md`
- `policies/payment-state-machine.md`
- `../../server/financial/domain.test.ts`
- `../../drizzle/0001_living_revanche.sql`
- `../../drizzle/0002_lively_roulette.sql`
- `../../drizzle/0003_tidy_micromacro.sql`
- `../../drizzle/0004_fast_radioactive_man.sql`
- `../../drizzle/0005_nifty_komodo.sql`
- `architecture/provider-adapter.md`
- `security/webhook-verification.md`
- `runbooks/sandbox-reconciliation-and-recovery.md`
- `evidence/verification-2026-09-25.md`
- `evidence/verification-2026-09-26.md`
- `evidence/verification-2026-09-27.md`
- `roadmap.md`

## Limitations

No claim of “bank-grade,” “fully secure,” “compliant,” “certified,” or “production-ready” is made by this report. Conclusions concern only the current code, database schema, validation output and sandbox environment evidence listed above.
