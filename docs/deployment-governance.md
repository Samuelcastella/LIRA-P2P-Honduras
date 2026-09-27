# LIRA deployment governance

LIRA treats each Railway service as an independent deployment unit. A service may redeploy only when one of its declared build inputs changes.

## Current artifact boundaries

- `lira-web` builds from the canonical checked-in frontend and `apps/web` runtime.
- `lira-api`, `lira-worker`, and `lira-reconciliation` remain archive-backed by `lira-p2p-honduras-hardened-v2.zip` until an explicit backend source migration is completed and validated.
- A frontend-only change must not trigger backend rebuilds.
- Archive-backed backend services must not silently acquire dependencies on root frontend/tooling files.

The machine-readable source of truth is `ops/deployment-contract.json`. `scripts/validate-deployment-contract.mjs` enforces the repository-side boundary in CI.

## Release gates

Before any deployment of `lira-web`:

1. Deployment-contract validation must pass.
2. Frozen dependency installation must pass.
3. Typecheck and unit tests must pass.
4. The production bundle must build.
5. The actual `Dockerfile.web` image must build successfully.
6. Production dependency audit must pass at the configured severity threshold.
7. The frontend/API contract must be executable-checked against the hardened API baseline.
8. Drizzle schema, migration journal, and latest snapshot must remain synchronized.
9. Device-trust changes must preserve the explicit `new → pending → trusted` lifecycle, cooling period, OTP purpose separation, revocation, and restricted-device semantics.
10. Sandbox controls remain mandatory; real-money operation is not enabled by this workflow.

## Railway watch patterns

Railway watch patterns must mirror `ops/deployment-contract.json`. Do not add broad root patterns such as `package.json`, `client/**`, or `apps/**` to archive-backed backend services unless their Dockerfiles are intentionally migrated to consume those files and the deployment contract is updated in the same reviewed change.

## Canonical backend migration gate

Root `server/**` and `drizzle/**` changes are reconciliation work until the archive-backed backend services are explicitly migrated. They do not change the currently deployed archive merely because they exist in the repository.

Before changing `lira-api`, `lira-worker`, or `lira-reconciliation` from the hardened archive to canonical root source, verify functional parity, database dialect/migration compatibility, security controls, payment state behavior, provider failure semantics, reconciliation, and rollback. The service Dockerfile, watch patterns, deployment contract, and runbook must change together in one reviewed release.

## Change discipline

Changes that alter a service boundary, Dockerfile input, financial contract, authentication flow, or sandbox safety gate require a dedicated PR. Do not combine those changes with unrelated UI work. A failed deployment is not considered complete until the previous healthy version remains serving or an explicitly validated replacement succeeds.
