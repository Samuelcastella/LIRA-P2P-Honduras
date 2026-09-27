---
name: bank-readiness-audit
description: "Evidence-based readiness review for financial platforms before bank discussions, technical due diligence, provider integration, controlled pilots, or any real-money release. Use to audit architecture, financial integrity, identity, authorization, risk, bank adapters, reconciliation, security, resilience, operations, and documentation; produce an evidence-backed readiness decision and remediation plan."
---

# Bank Readiness Audit

Perform an independent, evidence-based review. Assess the implementation that exists, not the intended architecture or the visual polish of a prototype.

> A working UI, successful sandbox demo, or unverified assertion is not evidence of banking readiness.

## Scope and boundaries

Use this skill before external bank discussions, technical due diligence, security review, provider integration, controlled pilots, or any production release involving real money.

This skill **audits and plans remediation**; it does not by itself make a product bank-ready, certify compliance, or authorize real-money use. Do not expose secrets, production data, exploitable implementation detail, or credentials in the report.

Read [references/bank-readiness-standard.md](references/bank-readiness-standard.md) for the complete audit standard and control catalogue. Use it when the audit requires a domain-specific checklist or evidence package detail.

## Required outcome

Issue exactly one decision:

- **READY** — all mandatory controls have reproducible evidence and no unresolved critical issues.
- **READY_WITH_CONDITIONS** — no known P0 issue exists, but explicit remediation is needed before real-money use.
- **NOT_READY** — one or more critical control gaps, missing financial integrity controls, or missing evidence prevents the next stage.

Immediately issue **NOT_READY** when evidence shows any of the following:

- unbalanced ledger or missing double-entry model;
- duplicate financial settlement or missing idempotency for money movement;
- unauthorized financial action or direct balance mutation;
- active leaked production credential;
- unverified financial webhook;
- no reconciliation capability; or
- irrecoverable financial state.

Never substitute a softer result for schedule, product, or commercial reasons.

## Audit workflow

### 1. Establish scope

Record:

- audit date, commit SHA, environment, owner/auditor, and implementation boundary;
- whether the system is UI-only, sandbox-backed, provider-integrated, or real-money capable;
- reviewed repositories, services, infrastructure, configurations, and third parties; and
- known exclusions and unavailable evidence.

For a prototype, explicitly mark controls as **not implemented**, **simulated**, or **unverified** instead of treating UI indicators as controls.

### 2. Inventory evidence

Collect only verifiable artifacts:

- source code and database schema;
- tests and their command output;
- deployed configuration or runtime diagnostics;
- architecture, data-flow, and trust-boundary diagrams;
- audit logs, metrics, runbooks, and incident artifacts;
- dependency, SAST, secret, and configuration scans; and
- provider contracts, sandbox behaviour, and webhook specifications.

Link every pass, failure, and assertion to an exact file, test output, configuration, or reproducible command. Mark absent evidence as a finding, not a pass.

### 3. Test high-risk domains first

Assess in this order:

1. **Financial integrity** — double entry, integer minor units, atomic posting, immutable settled entries, currency, reversals, reconstruction, and reconciliation linkage.
2. **Payments and idempotency** — explicit state machine, invalid-transition rejection, duplicate submission, same-key/different-payload rejection, recovery after response loss, and safe retries.
3. **Authorization and administration** — server-side ownership checks, RBAC, privileged action safeguards, intervention reasons, audit attribution, no direct balance editing, and no frontend-only access control.
4. **Identity and data protection** — OTP/PIN controls, session rotation/revocation, device management, sensitive-change checks, minimal collection, encryption boundaries, and log redaction.
5. **Provider and webhook security** — adapter isolation, provider state/error mapping, signature and timestamp verification, replay prevention, sandbox/production separation, and safe reconciliation.
6. **Risk, resilience, and operations** — fail-closed risk decisions, velocity controls, outages, partial failures, kill switches, observability, backups/restores, incident response, and deployment traceability.

Use the full control catalogue for remaining domains: architecture, threat model, infrastructure, dependency security, QA, documentation, disaster recovery, and due diligence package.

### 4. Actively try to disprove readiness

Attempt reproducible checks appropriate to the implementation:

- submit the same transfer intent repeatedly and concurrently;
- reuse an idempotency key with a different payload;
- attempt forbidden payment-state transitions;
- test authorization boundaries and administrator restrictions;
- interrupt requests and retry after client/network loss;
- send invalid, stale, duplicate, modified, and out-of-order webhook events;
- compare internal ledger records against the provider representation;
- scan code, history, configs, logs, and docs for secrets; and
- simulate provider, database, queue, and service failures when the stack supports it.

Do not claim a test passed merely because the test has not been run. Prefer failing closed when unknown.

### 5. Classify findings

Use the following severities:

| Severity | Meaning | Release effect |
| --- | --- | --- |
| P0 | Critical financial/security release blocker | Always NOT_READY until remediated and verified |
| P1 | High risk or major control gap | Normally blocks real-money launch |
| P2 | Meaningful operational, monitoring, documentation, or resilience gap | May permit READY_WITH_CONDITIONS |
| P3 | Low-impact improvement | Track without necessarily blocking |

For each finding record: identifier, severity, domain, evidence, impact, exploit/failure path, affected scope, owner, remediation, validation method, and status.

### 6. Produce an evidence package

Use this directory layout when creating deliverables:

```text
docs/bank-readiness/
  architecture/
  security/
  tests/
  scans/
  policies/
  runbooks/
  evidence/
  audit-report.md
```

Keep documents current with the implementation. A stale or generated-only document is not evidence without matching code/configuration/tests.

## Mandatory report structure

Use this structure exactly:

```markdown
# Bank Readiness Audit — [System] — [YYYY-MM-DD]

## Executive summary
[Scope, system maturity, and decision.]

## Decision
**READY | READY_WITH_CONDITIONS | NOT_READY**

## Scope and evidence reviewed
[Commit SHA, environment, reviewed components, commands, artifacts, and exclusions.]

## Financial integrity
[Ledger, payment lifecycle, idempotency, reconciliation evidence and findings.]

## Security and access controls
[Identity, authorization, secrets, data protection, audit log evidence and findings.]

## Provider and operational readiness
[Adapters, webhooks, risk, resilience, observability, backups, incident response.]

## Findings
| ID | Severity | Domain | Finding | Evidence | Required remediation | Status |
| --- | --- | --- | --- | --- | --- | --- |

## Blockers and conditions
[Only concrete conditions, owners, and validation criteria.]

## Required actions
1. [Action, owner, validation.]

## Evidence index
[Relative paths and commands used.]

## Limitations
[Anything unreviewed, simulated, unavailable, or outside scope.]
```

## Language rules

- State facts with their supporting evidence.
- Use **implemented**, **tested**, **simulated**, **unverified**, **missing**, and **out of scope** precisely.
- Never claim "bank-grade", "fully secure", "certified", "compliant", or "production-ready" without evidence sufficient for that exact claim.
- Prefer: "The current test suite passed the defined ledger invariant cases" over absolute security claims.
- Never recommend a real-money release while a P0/P1, unverified provider workflow, or materially incomplete financial state model remains.

## Definition of done

Complete the review only when the scope is recorded, evidence is indexed, financial controls are tested or explicitly marked absent, findings are classified, remediation is actionable, and a decision has been issued.
