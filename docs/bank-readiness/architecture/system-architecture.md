# System Architecture — LIRA Sandbox v0.1

## Scope

This document describes the **current sandbox implementation**. It does not describe a real-money production deployment.

## Components

| Component | Current responsibility | Evidence |
| --- | --- | --- |
| React client | Authenticated dashboard, payment intent capture, status display | `client/src/pages/Home.tsx` |
| tRPC API | Input validation, authenticated/role-gated contracts | `server/routers.ts`, `server/_core/trpc.ts` |
| Financial service | State transitions, idempotency checks, risk decision, balanced journal construction | `server/db.ts`, `server/financial/domain.ts` |
| MySQL/TiDB | Users, transfer records, ledger records, risk, audit, reconciliation and controls | `drizzle/schema.ts`, `drizzle/0001_living_revanche.sql` |
| SandboxBankAdapter | Synchronous simulated provider reference and reconciliation match | `server/db.ts` |

## Boundaries

- **Client → API:** the client never chooses the transfer state, risk decision, ledger entries, or final provider reference.
- **API → financial service:** mutation input is validated with Zod, associated with the authenticated user, and includes an idempotency key.
- **Financial service → database:** the financial write path uses a database transaction for transfer, risk event, audit event, double-entry journal, settlement status and reconciliation item.
- **Bank provider:** the current adapter is simulated. No external bank credential, webhook or money rail is integrated.

## Explicit non-goals

- No real money movement.
- No external bank API calls, webhooks or stored bank credentials.
- No KYC, biometric template, PIN or device-fingerprint storage.
- No production readiness claim.
