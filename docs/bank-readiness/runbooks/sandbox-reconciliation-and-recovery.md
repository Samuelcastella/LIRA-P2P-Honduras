# Sandbox Reconciliation and Recovery Runbook

## Scope

This runbook supports the **sandbox only**. It is not evidence of production disaster recovery.

## Operational controls

- **Pause new transfers:** use the admin-only `transfers_enabled` control. Existing history, reconciliation and investigation remain readable.
- **Dispatch pending provider intents:** use the admin-only `dispatchSandboxOutbox` procedure. It only changes outbox status and records a provider reference; it does not settle a transfer.
- **Accept settlement:** a signed provider callback must pass HMAC, timestamp, schema, replay and state checks before the balanced journal is posted.

## Triage matrix

| Condition | Detection | Immediate action | Do not do |
| --- | --- | --- | --- |
| `outbox_events.pending` remains pending | Admin operations / database review | Pause transfers if the backlog is unexplained; inspect transfer and audit reference | Do not post ledger entries manually |
| Provider event rejected | `provider_webhook_events.status = rejected` | Verify signature configuration and provider reference; retain event for investigation | Do not retry an unverified payload |
| Out-of-order event ignored | `provider_webhook_events.status = ignored` | Query later sequence and transfer state | Do not force a state transition |
| Reconciliation mismatch | `reconciliation_items.status != match` | Pause affected rail; open investigation; retain ledger and provider evidence | Do not edit a balance or silently mark as match |
| Suspected duplicate payment | Same idempotency key / event ID / reference | Disable new transfers, collect audit trail, determine canonical transfer | Do not refund by mutating the original ledger record |

## Recovery principle

No recovery action may delete ledger entries, alter a settled journal, or change a balance directly. A future reversal capability must use compensating accounting entries, a documented state transition, provider evidence and audit attribution.

## Evidence to retain

- Transfer reference and provider reference
- User idempotency key and request fingerprint hash
- Provider event ID, sequence and payload hash
- Journal entry IDs
- Reconciliation status and investigation timestamps
- Audit events and operator reason
