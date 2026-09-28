# Operational Baseline — 2026-09-27 — Pre-cutover

## Scope

Read-only observation of the Railway `production` environment before any
canonical backend cutover.

No production configuration was changed while collecting this evidence.

## Deployment state

At observation time, the following services reported latest deployment
`SUCCESS`:

- `lira-api`
- `lira-worker`
- `lira-reconciliation`
- `lira-web`
- `Postgres`
- `Redis`

Backend services were still configured to build from the hardened archive via
their current Dockerfiles. Canonical source had **not** been cut over.

## Railway healthcheck contract

- API: `/ready`, timeout 45 seconds, 1 replica in `us-east4-eqdc4a`
- Worker: `/health`, timeout 45 seconds, 1 replica in `us-east4-eqdc4a`
- Reconciliation: `/health`, timeout 45 seconds, 1 replica in
  `us-east4-eqdc4a`

The API retains `node scripts/migrate.mjs` as a Railway pre-deploy command.

## One-hour resource baseline

Read from Railway service metrics over a one-hour window (61 samples).

| Service | CPU avg | CPU max | Memory avg GB | Memory max GB |
| --- | ---: | ---: | ---: | ---: |
| lira-api | 0.0000040511 | 0.0000067333 | 0.03933184 | 0.039354368 |
| lira-worker | 0.0006129464 | 0.0007777 | 0.030400814 | 0.034942976 |
| lira-reconciliation | 0.0001636667 | 0.0003753 | 0.041508327 | 0.04169728 |
| Postgres | 0.0007374738 | 0.0009090167 | 0.068369861 | 0.068542464 |

These values are a comparison baseline, not capacity guarantees. During
cutover, investigate a sustained material step-change rather than expecting
exact equality.

## Database recovery evidence status

The production Postgres volume is present at
`/var/lib/postgresql/data` on volume
`a08417d9-badf-4a46-bb2b-f42a1e88cc73`.

The available read-only connector could not independently provide:

- an exact completed backup timestamp;
- the PITR archive window;
- an actual restore result.

Therefore the backup and restore cutover gates remain **blocked**. A configured
or mounted volume must not be treated as proof of recoverability.

## Next evidence required

Before cutover:

1. identify and record a concrete recovery point;
2. execute an isolated restore drill;
3. record restore duration and migration checksum validation;
4. compare post-cutover service metrics and health to this baseline.
