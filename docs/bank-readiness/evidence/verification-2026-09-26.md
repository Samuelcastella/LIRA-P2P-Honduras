# Verification Evidence — 2026-09-26 — Preventive Sandbox Controls

## Scope

This evidence covers the LIRA **sandbox** enhancement that adds current-PIN verification before PIN rotation, revocation of other sandbox security sessions after a successful rotation, atomic OTP consumption, per-transfer limits, an atomic daily UTC intent reservation, safe audit-event visibility, and UI notices for the limits.

## Migration review and database verification

`drizzle/0005_nifty_komodo.sql` was reviewed before execution. It only creates `daily_transfer_controls`, adds a user foreign key, and adds a user-period index; it contains no destructive DDL. The migration was applied and the `daily_transfer_controls` table was confirmed in the sandbox database.

## Automated validation

| Check | Command | Result |
| --- | --- | --- |
| Migration state | `pnpm drizzle-kit migrate` | Passed |
| Type safety | `pnpm check` | Passed |
| Unit tests | `pnpm test` | Passed: 4 files, 16 tests |
| Production build | `pnpm build` | Passed |
| Production dependency audit | `pnpm audit --prod --json` | 0 info, 0 low, 0 moderate, 0 high, 0 critical |

## New unit coverage

`server/security/domain.test.ts` verifies PIN hashing and validation, OTP formatting and expiry, lockout at the configured failed-attempt threshold, PIN-change distinctness, and both single-transfer and daily sandbox limits.

## Verification limitations

The suite does not perform a live database concurrency test for conditional OTP consumption or daily reservation under parallel requests. Those server-side statements were implemented to fail closed, but a production implementation still requires database integration tests, a verified OTP delivery channel, independently attested devices, account recovery safeguards, and first-class primary-session rotation.
