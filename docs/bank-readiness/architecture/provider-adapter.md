# Sandbox Provider Adapter Contract

## Current scope

`SandboxBankAdapter` is an **in-process, deterministic simulator**. It does not send bank API requests, retain provider credentials, or move money. It exists to enforce a safe boundary between the LIRA payment lifecycle and a future provider integration.

## Declared contract

| Attribute | Current behavior |
| --- | --- |
| Provider | `SandboxBankAdapter` |
| API version | `2026-09-sandbox` |
| Authentication | None; no external provider is called |
| Capability | Accept transfer dispatch intent, return `processing`, expose read/cancel/reconcile placeholders |
| Idempotency | LIRA supplies the original user-scoped idempotency key to the adapter command |
| Timeouts/retries | Not applicable to in-process simulation; future network adapters must define both |
| Settlement | Only a verified provider callback may transition `processing → settled` |
| Production separation | No production adapter exists; production must be a separately configured provider implementation |

## Outbox boundary

The payment transaction writes `provider.transfer.requested` to `outbox_events` while the transfer is marked `processing`. An admin-only sandbox dispatch routine consumes the event and records a provider reference. This creates an inspectable recovery boundary: provider work is not assumed complete merely because a user request returned.

## Explicit limitations

- No external API authentication or API version negotiation.
- No real timeout/retry behavior, provider outage behavior, or provider statement reconciliation.
- No background outbox worker; dispatch is an admin-only sandbox operation.
- No production provider should be enabled by configuration alone without a separate adapter review.
