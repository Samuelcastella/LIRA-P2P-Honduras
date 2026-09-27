# Ledger Invariants — LIRA Sandbox v0.1

## Implemented invariants

1. **Amounts are integer minor units.** API contracts accept `amountMinor` as a positive safe integer in HNL centavos.
2. **A settled sandbox transfer has exactly two journal entries.** One source debit and one destination credit are constructed by `createBalancedJournal`.
3. **Debit equals credit.** `assertBalancedJournal` rejects mismatched amount/currency, duplicate directions, and same-account postings.
4. **A transfer has one reference.** `transfers.reference` is unique.
5. **Idempotency is user scoped.** `(senderUserId, idempotencyKey)` is unique. A replay with an identical request fingerprint returns the existing transfer; a changed financial intent is rejected.
6. **No direct balance update exists.** Account balance is calculated from `ledger_entries`, not stored as an editable balance column.
7. **Transitions are explicit.** The `domain.ts` transition map rejects invalid paths such as `created → settled`.
8. **Risk and audit are recorded.** Each attempted transfer receives a risk event and audit events without storing PIN, OTP or raw credential material.
9. **Reconciliation does not repair.** Each settled sandbox transfer receives a reconciliation item. No process updates a balance to “fix” a mismatch.

## Current boundary

The above invariants are tested as a sandbox core. Database-level triggers, external-provider settlement, durable queueing, reversals and multi-node concurrency controls are not yet implemented; these are release blockers for any real-money phase.

## Validation

Run:

```bash
pnpm test
```

The financial domain tests cover balanced journal construction, mismatch rejection, illegal state transitions, idempotency fingerprint collisions and risk velocity decisions.
