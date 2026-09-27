# Sandbox SLO and Observability Baseline

## Scope

These objectives cover the canonical LIRA sandbox backend only. They are
operational engineering targets, not bank, regulatory, or real-money service
commitments.

## Service signals

### API

Liveness: `GET /healthz`  
Readiness: `GET /ready`

`/ready` performs a PostgreSQL `select 1`. A process that is alive but
cannot reach its database must not report itself ready.

Structured events:

- `service_started`
- `readiness_check_failed`
- `server_error`
- `fatal_startup_error`
- `shutdown_started`
- `shutdown_completed`
- `shutdown_timeout`

### Worker

Health: `GET /health` or `GET /healthz`

The response exposes only operational state and counters, never a raw exception
message.

Counters:

- cycles
- dispatched
- unknown
- deadLettered
- tickFailures

Structured events:

- `dispatch_cycle_completed`
- `dispatch_cycle_failed`
- `health_server_error`
- `service_started`
- shutdown events

Three consecutive tick exceptions mark the worker degraded and cause the health
endpoint to return HTTP 503. Provider business outcomes such as an individual
`unknown` transfer do not by themselves make the worker process unhealthy.

### Reconciliation

Health: `GET /health` or `GET /healthz`

Counters:

- cycles
- checked
- resolved
- escalated
- tickFailures

Structured events:

- `reconciliation_cycle_completed`
- `reconciliation_cycle_failed`
- `health_server_error`
- `service_started`
- shutdown events

Three consecutive tick exceptions mark the process degraded.

## Initial sandbox objectives

| Signal | Target | Action threshold |
| --- | --- | --- |
| API readiness | >= 99.5% over a 24h observation window | investigate any sustained non-200 > 5 min |
| Worker health | no 3 consecutive tick failures | SEV-2 at 3 consecutive failures |
| Reconciliation health | no 3 consecutive tick failures | SEV-2 at 3 consecutive failures |
| Dead-letter dispatch | 0 unexplained | investigate every new dead-letter |
| Reconciliation escalation | 0 unexplained | investigate every new escalation |
| Ledger invariant failures | 0 | SEV-1 immediately |
| Audit mutation/write failure | 0 | SEV-1 immediately |
| Migration checksum mismatch | 0 | block deploy / SEV-1 if already deployed |

These are deliberately strict for integrity signals even though the availability
target is modest for a sandbox.

## Logging contract

Operational logs are newline-delimited JSON with:

- `timestamp`
- `service`
- `event`
- event-specific numeric/boolean fields

Do not put these fields in operational logs:

- PIN or OTP values;
- JWTs/session tokens;
- database URLs;
- provider secrets;
- bank credentials;
- raw request bodies;
- full exception strings when they can contain sensitive connection details.

For errors, emit a stable error class and correlate through deployment/service
context rather than dumping sensitive payloads.

## Dashboard / alert minimum

Until a dedicated telemetry backend is selected, Railway health, deployment
state, runtime logs, and service resource metrics are the minimum operational
surface.

A production-grade provider/real-money phase must add durable metrics and alert
routing for at least:

- HTTP readiness/error/latency;
- worker cycle success/failure;
- outbox backlog and dead-letter count;
- reconciliation unresolved/escalated count;
- provider latency/timeouts/rate limiting;
- duplicate/rejected webhooks;
- database pool exhaustion;
- ledger/audit invariant failures;
- authentication/session anomaly rates.

## Cutover observation window

For each backend service cutover:

1. confirm Railway reports `SUCCESS`;
2. confirm configured health endpoint stays 200;
3. inspect startup and cycle structured events;
4. check CPU/memory for an abnormal step change;
5. investigate every dead-letter/escalation;
6. do not proceed to the next service while a new unexplained error is active.

## Limitations

The counters exposed by worker/reconciliation health endpoints are process-local
and reset on restart. They are useful for immediate cutover evidence, not as a
long-term accounting source.

Financial truth remains in PostgreSQL ledger/audit/reconciliation tables, never
in in-memory counters or log aggregation.
