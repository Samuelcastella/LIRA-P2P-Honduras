# Canonical Backend Cutover Evidence — 2026-09-28

## Step 1 — lira-api

Status: **VERIFIED SUCCESS**

- Railway service: `lira-api`
- Service ID: `633b7001-fbfc-4004-b95d-0eb5c9b25bd8`
- Deployment ID: `a7816010-3364-4fc1-bda0-13b12d5024b4`
- Git commit: `726b9c57587fe1f5c6ba429dc7093456776d73a9`
- Dockerfile: `ops/docker/canonical/Dockerfile.api`
- Wait for CI: enabled before deployment
- GitHub Sandbox CI run #130: success
- GitHub Cutover Readiness run #18: success
- Pre-deploy migration command: `node scripts/migrate.mjs`
- Migration result: all three PostgreSQL migrations already applied; no checksum error
- Railway healthcheck: `/ready` succeeded
- Railway deployment status: `SUCCESS`
- Runtime validation: no `fatal_startup_error`, `readiness_check_failed`,
  database error, crash/restart loop, or healthcheck failure detected
- OAuth initialization completed successfully
- Sandbox-only posture remained enforced
- Previous hardened API deployment remains available as rollback evidence

## Next step

Prepare and cut over `lira-worker` independently. Do not modify
`lira-reconciliation` until the canonical worker is verified healthy.

Real-money operation remains disabled.
