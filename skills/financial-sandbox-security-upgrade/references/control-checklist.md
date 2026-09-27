# Transaction State and Verification Checklist

## Status-to-UI mapping

| Backend state | UI label | Visual treatment | Required user guidance |
| --- | --- | --- | --- |
| `created`, `authenticating`, `risk_review` | Verificando | Neutral / amber | Do not resubmit; wait for security checks. |
| `authorized`, `processing` | Pendiente | Amber clock | Provider or queue confirmation is still required. |
| `settled` | Completado | Green check | Ledger and reconciliation evidence is available. |
| `declined` | Rechazado | Red alert | Explain the safe reason category; do not expose risk rules. |
| `failed` | Fallido | Red alert | Present retriable vs non-retriable information if known. |
| `expired` | Expirado | Red alert | Start a new operation; never revive the old intent. |
| `canceled` | Cancelado | Red alert | Confirm it cannot proceed without a new intent. |

## Verification-control inventory

| Control | Required implementation evidence | Explicit limitation to state if absent |
| --- | --- | --- |
| PIN | KDF hash, validation, failure counter, lockout, audit event | No recovery/change verification or external identity proof |
| OTP | Hash, expiry, attempt limit, session binding, one-time consumption | No out-of-band delivery or channel assurance |
| Trusted devices | User-scoped device records, revoke action, session cascade | Client-attested fingerprint is not a hardware credential |
| Sessions | User-scoped active/revoked records and server-side sensitive-action gate | Does not necessarily revoke the primary authentication provider session |
| Transaction gate | Server rejects a transfer without a verified active challenge | Request-only flows may not require the gate if they do not move funds |
| UI | Labels and colors reflect backend state, not local optimism | No claim of security certification |

## Final verification prompts

- Can a transfer be created without a verified challenge?
- Can a challenge be reused, used after expiry, or used from another session?
- Can one user revoke another user’s device/session?
- Does PIN or OTP plaintext appear in database rows, audit data, logs, or client state after submission?
- Does every transaction state have a clear visual label and next action?
- Are sandbox-only codes and client-attested device labels explicit in the UI and documentation?
