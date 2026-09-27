# Sandbox Provider Webhook Verification

## Endpoint

`POST /api/provider-webhooks/sandbox-bank`

The endpoint is reserved for the sandbox provider contract. It requires a configured `SANDBOX_PROVIDER_WEBHOOK_SECRET`; absent configuration returns `503` and no financial state can change.

## Verification sequence

1. Read the raw JSON body before generic JSON parsing.
2. Require `x-lira-timestamp` and `x-lira-signature`.
3. Verify HMAC-SHA256 over `timestamp + "." + raw_body` using constant-time comparison.
4. Reject timestamps more than five minutes from server time.
5. Parse and validate the typed event payload.
6. Retain provider event ID, payload hash, event sequence, receipt time and handling outcome.
7. Reject unknown/mismatched transfer/provider references.
8. Ignore out-of-order events and duplicate event IDs.
9. Permit `transfer.settled` only from a LIRA transfer in `processing` state; then post the balanced journal and reconciliation record in one transaction.

## Required tests

| Case | Current evidence |
| --- | --- |
| Valid signed payload | `server/financial/provider.test.ts` |
| Altered payload | `server/financial/provider.test.ts` |
| Invalid signature | `server/financial/provider.test.ts` |
| Expired timestamp | `server/financial/provider.test.ts` |
| Malformed timestamp | `server/financial/provider.test.ts` |
| Duplicate event | Requires database integration test |
| Out-of-order event | Requires database integration test |
| Settlement failure after persistence boundary | Requires database integration test |

## Limitations

The HMAC protocol is a sandbox contract, not a statement about any bank’s actual webhook scheme. A real provider integration must substitute the provider’s documented signing method, IP/certificate policy where appropriate, retry behavior and event schema, then re-run the listed tests.
