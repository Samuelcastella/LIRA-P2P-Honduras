---
name: financial-sandbox-security-upgrade
description: "Upgrade a financial sandbox UI with explicit transaction states, user-visible risk alerts, PIN plus OTP transaction verification, trusted-device and session controls, and evidence-backed documentation. Use when improving a payment or wallet prototype before a security review, sandbox demo, provider integration, or bank-readiness remediation."
---

# Financial Sandbox Security Upgrade

Improve a **sandbox** without portraying it as a real-money security system. Pair every visual security claim with a server-side control, test, or an explicit limitation.

## Workflow

1. Establish the boundary: record environment, real-money capability, existing authentication, payment states, current data model, and unavailable evidence.
2. Read `bank-readiness-audit` when the project involves money movement. Treat missing OTP delivery, MFA, recovery, provider integration, or session binding as open gaps—not completed controls.
3. Inventory transfer states in the backend. Map every state to a clear UI label, visual severity, explanation, and permitted next action. Never collapse `pending`, `rejected`, `failed`, `expired`, and `settled` into one generic status.
4. Implement sensitive-action verification server-side:
   - hash a six-digit PIN with a memory-hard KDF;
   - issue a short-lived, attempt-limited OTP challenge;
   - bind the challenge to a user and security-session record;
   - verify PIN and OTP before creating a new money-moving intent;
   - consume the challenge atomically after verification; and
   - audit only safe metadata, never PINs, OTPs, raw device identifiers, or session secrets.
5. Persist trusted-device and security-session metadata. Apply ownership checks to every list and revoke operation. Revoking a device must revoke its security sessions. Clearly distinguish a local sandbox session from the product’s primary authentication session.
6. Update the UI: show a transaction-alert banner, accessible status pills, clear sandbox labels, a PIN setup form, OTP entry, device/session lists, and revoke actions. Do not show an OTP in a production interface; a displayed code is permitted only with an explicit sandbox label.
7. Add tests for hashing, input validation, expiry, state mapping, invalid OTP/PIN handling, lockout, ownership, replay/consume-once semantics, and revocation. Run type check, tests, and production build.
8. If schema changes, generate and review a Drizzle migration before applying it. Update evidence and the bank-readiness report after validation.

## Non-negotiable guardrails

- Keep amount, ledger, provider, and authorization controls on the server.
- Do not store plaintext PINs, OTPs, access tokens, raw device IDs, or biometric material.
- Do not promise MFA, WebAuthn, trusted devices, or session revocation is production-ready when the implementation is only simulated or client-attested.
- Do not let a frontend status or a client-side “verified” flag authorize a transfer.
- Fail closed for missing, expired, reused, locked, or cross-session verification challenges.
- Preserve settlement, reconciliation, and investigation access when disabling new transfers.

## Deliverables

Provide:

1. A concise implementation summary and a list of intentionally unimplemented controls.
2. Evidence of migration review, type check, tests, build, and dependency audit.
3. An updated readiness decision using **READY**, **READY_WITH_CONDITIONS**, or **NOT_READY** when `bank-readiness-audit` is in scope.
4. A status-to-UI mapping and a verification-control inventory using the template in `references/control-checklist.md`.

## Reference

Read `references/control-checklist.md` before final verification to ensure the implementation and UI labels remain aligned.
