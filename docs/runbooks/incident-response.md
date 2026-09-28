# Financial Sandbox Incident Response Runbook

## Objective

Protect financial integrity first, preserve evidence second, restore service
third. LIRA remains sandbox-only; these controls are designed so an incident
cannot be "fixed" by rewriting financial history.

## Severity

### SEV-1 — financial integrity or security boundary at risk

Examples:

- debit/credit imbalance;
- duplicate settlement or provider dispatch with unclear outcome;
- unauthorized financial mutation;
- audit/ledger immutability failure;
- database corruption or unrecoverable migration error;
- sandbox-only guard unexpectedly disabled;
- compromised secrets or administrative account.

Immediate response: pause new transfer creation, preserve evidence, stop the
affected cutover/deployment, and enter containment.

### SEV-2 — degraded financial operation

Examples:

- worker/reconciliation repeatedly unhealthy;
- provider dispatch events accumulating in `dead_letter`;
- reconciliation escalation increasing;
- API readiness failing while database remains intact;
- deployment regression with a known safe rollback.

Immediate response: stop the rollout, preserve logs, rollback the affected
application service if safe, then reconcile.

### SEV-3 — non-financial degradation

Examples:

- UI-only issue;
- non-sensitive reporting display issue;
- isolated transient service error with no financial-state effect.

Handle through normal engineering workflow while retaining relevant evidence.

## First 15 minutes

1. Name the incident and record UTC start time.
2. Identify affected service(s), Git commit(s), Railway deployment ID(s), and
   current database deployment.
3. If financial integrity is uncertain, pause new transfers through the
   existing operational kill switch.
4. Do not delete/replay/repair ledger or audit rows.
5. Preserve:
   - Railway build/deploy/runtime logs;
   - health responses;
   - structured worker/reconciliation events;
   - relevant transfer/outbox/reconciliation/audit identifiers;
   - GitHub CI and commit evidence.
6. Determine whether the issue is application-only or database-level.
7. If caused by an in-progress cutover, stop before the next service.

## Containment

Application regression:

- rollback only the affected service to the last verified revision;
- keep the database at its current schema unless database corruption is proven;
- confirm healthcheck recovery before continuing.

Provider ambiguity:

- leave internal transfer state `unknown`;
- do not infer success from a timeout;
- allow reconciliation/evidence to resolve the outcome;
- dead-letter exhausted dispatch attempts for human review.

Database incident:

- keep transfer creation paused;
- follow `postgres-backup-restore.md`;
- choose a known recovery point;
- reconcile every operation spanning the recovery window.

Security incident:

- revoke affected sessions/devices/secrets using supported controls;
- rotate the exposed secret through the platform secret store;
- preserve audit evidence;
- do not log or paste secret values into tickets or chat.

## Evidence discipline

For every SEV-1/SEV-2, record:

- incident ID;
- UTC timestamps;
- affected user/transfer IDs when applicable;
- service and deployment IDs;
- Git SHA;
- first symptom;
- health status;
- relevant structured event names;
- containment action;
- rollback/restore action;
- reconciliation result;
- recovery time;
- root cause;
- follow-up owner.

Do not copy PINs, OTPs, tokens, database URLs, provider credentials, or other
secrets into incident evidence.

## Recovery gates

Service is not recovered merely because HTTP becomes 200.

For financial incidents, recovery requires:

1. affected services are healthy;
2. no active migration error exists;
3. ledger invariants remain intact;
4. audit writes succeed;
5. unresolved provider outcomes are reconciled or explicitly queued for review;
6. no unexplained duplicate financial effect exists;
7. new transfer creation is deliberately re-enabled, not resumed accidentally.

## After action review

Within the next engineering cycle:

1. create a factual timeline;
2. identify root cause and contributing controls;
3. add an automated regression test when technically possible;
4. update runbooks/alerts;
5. confirm no secret or personal data leaked into logs;
6. document whether RPO/RTO targets were met;
7. keep the incident open until corrective actions have owners.

No incident review may recommend editing posted ledger entries or deleting
audit history as a remediation.
