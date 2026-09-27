# Payment State Machine — LIRA Sandbox v0.1

## Normal path

```text
created → authenticating → risk_review → authorized → processing → settled
```

## Terminal and alternate states

```text
created → canceled | expired
authenticating → declined | failed
risk_review → declined | failed
authorized → canceled | failed
processing → failed | reversed
settled → reversed
```

## Enforcement

- The transition map lives in `server/financial/domain.ts`.
- `assertAllowedTransition` throws on unsupported changes, including `created → settled`.
- The current sandbox write path records each normal-path transition inside one database transaction before journal posting and settlement.
- A `review` or `block` risk decision results in `declined` before ledger posting.

## Idempotency rule

All user-facing transfer and payment-request mutations require a user-scoped idempotency key and a canonical request fingerprint. Same key + same intent returns the prior record. Same key + changed intent is rejected.

## Current boundary

The sandbox does not yet contain an asynchronous outbox, provider callback state machine, reversal worker, or externally signed webhooks. Do not use this design to authorize real-money release without those controls and evidence.
