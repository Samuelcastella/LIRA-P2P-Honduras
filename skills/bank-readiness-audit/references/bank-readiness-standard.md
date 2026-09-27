bank-readiness-audit

Purpose

Perform the final readiness review of the financial platform before:

* external bank discussions;
* technical due diligence;
* security review;
* provider integration;
* controlled pilot;
* production release involving real money.

This skill does not implement features.

It verifies whether the platform is sufficiently secure, auditable, resilient and documented to advance to the next stage.

⸻

Core principle

A product is not bank-ready because:

the UI works
the demo looks good
transfers succeed in sandbox

It is bank-ready only when technical claims can be supported by evidence.

Every conclusion must point to:

* code;
* tests;
* configuration;
* logs;
* architecture;
* policy;
* scan;
* runbook;
* or reproducible evidence.

⸻

Audit domains

The audit must evaluate:

Architecture
Security
Identity
Authorization
Ledger
Payments
Risk/Fraud
Bank Adapters
Reconciliation
Auditability
Infrastructure
Resilience
Observability
Testing
Secrets
Data Protection
Administrative Controls
Incident Response
Documentation
Operational Readiness

⸻

Audit result

Every audit produces one of:

READY
READY_WITH_CONDITIONS
NOT_READY

READY

No unresolved critical issues.

All mandatory controls and evidence exist.

READY_WITH_CONDITIONS

No known P0 issue exists, but specific remediation or conditions must be completed before real-money production.

NOT_READY

One or more critical control gaps exist.

⸻

Severity model

P0 — Critical / Release Blocker

Examples:

unauthorized money movement
ledger imbalance
duplicate settlement
direct production balance mutation
exposed production secrets
unverified provider webhooks
unrecoverable transaction state

Any unresolved P0 means:

NOT_READY

⸻

P1 — High

Examples:

risk bypass
reconciliation gaps
privilege escalation
missing critical audit trail
insufficient recovery process
weak admin authorization

P1 issues normally block real-money launch.

⸻

P2 — Medium

Examples:

incomplete monitoring
documentation gaps
non-critical resilience weakness
operational inefficiency

May result in:

READY_WITH_CONDITIONS

⸻

P3 — Low

Examples:

minor documentation cleanup
non-critical UX inconsistency
low-impact operational improvement

Track but do not necessarily block.

⸻

1. Architecture audit

Verify that the architecture clearly separates:

Client
Identity
Payments
Ledger
Risk
Audit
Bank Adapters
Administrative functions

Verify:

[ ] Provider logic isolated behind adapters
[ ] Financial source of truth clearly defined
[ ] Trust boundaries documented
[ ] Services have explicit responsibilities
[ ] No circular financial ownership
[ ] External dependencies identified
[ ] Failure domains understood

Required evidence:

architecture diagram
service map
data-flow diagram
trust-boundary diagram

⸻

2. Threat-model audit

Threat model must cover at least:

account takeover
credential theft
session theft
API abuse
payment replay
duplicate submission
provider impersonation
webhook forgery
privilege escalation
insider misuse
ledger manipulation
data exfiltration
secret leakage
denial of service
supply-chain compromise

For each significant threat document:

asset
threat actor
attack path
controls
residual risk
monitoring
response

⸻

3. Identity audit

Verify:

[ ] Strong account enrollment
[ ] OTP protections
[ ] Secure PIN storage
[ ] MFA support
[ ] Device management
[ ] Session revocation
[ ] Refresh-token rotation
[ ] Account recovery controls
[ ] New-device detection
[ ] Sensitive-change verification

Confirm biometrics are used through secure OS capabilities.

Never store biometric templates in application storage.

⸻

4. Authorization audit

Authentication is not authorization.

Verify:

[ ] Every financial endpoint checks authorization
[ ] Resource ownership enforced server-side
[ ] Admin functions use explicit roles
[ ] Least privilege enforced
[ ] Privileged operations require stronger controls
[ ] No frontend-only permission logic

Test for:

IDOR
BOLA
horizontal privilege escalation
vertical privilege escalation

⸻

5. Ledger audit

Required invariants:

Total Debits = Total Credits

Verify:

[ ] Integer minor units
[ ] Explicit currency
[ ] Atomic posting
[ ] Idempotency
[ ] Settled entries immutable
[ ] Reversals use compensating entries
[ ] Concurrency protected
[ ] Balance reconstructable
[ ] Reconciliation linkage exists

Required evidence:

ledger invariant test results
reconstruction test
concurrency tests
reversal tests
database constraints

⸻

6. Payment lifecycle audit

Verify an explicit state machine exists.

Example:

CREATED
→ AUTHENTICATING
→ RISK_REVIEW
→ AUTHORIZED
→ PROCESSING
→ SETTLED

Verify failure states exist and are tested.

Confirm impossible transitions are rejected.

⸻

7. Idempotency audit

Verify all money-moving entry points support idempotency.

Test:

same request x 100

Expected:

1 financial intent

Also test:

same key
different payload

Expected:

rejected

⸻

8. Risk and fraud audit

Verify Risk Engine returns:

ALLOW
CHALLENGE
REVIEW
BLOCK

Confirm:

[ ] Decisions explainable
[ ] Policy versions recorded
[ ] Velocity limits exist
[ ] New-device controls exist
[ ] Recovery-event controls exist
[ ] Manual-review flow exists
[ ] Risk Engine failures do not silently ALLOW

⸻

9. Bank-adapter audit

For each provider adapter verify:

[ ] Authentication documented
[ ] API version documented
[ ] Capabilities declared
[ ] State mapping documented
[ ] Error mapping documented
[ ] Timeouts handled
[ ] Retry rules safe
[ ] Idempotency behavior known
[ ] Webhooks verified
[ ] Replay prevention implemented
[ ] Reconciliation supported
[ ] Sandbox separated from production

Unknown provider behavior must be documented as a blocker.

⸻

10. Webhook audit

Test:

valid event
invalid signature
expired timestamp
duplicate event
out-of-order event
modified payload
unknown event type

No unverified webhook may alter financial state.

⸻

11. Reconciliation audit

Verify the system compares:

internal ledger
VS
external provider

Test:

MATCH
STATUS_MISMATCH
AMOUNT_MISMATCH
MISSING_INTERNAL
MISSING_EXTERNAL
DUPLICATE_EXTERNAL
UNKNOWN

Confirm discrepancies produce investigation cases.

Never silently repair mismatches.

⸻

12. Secrets audit

Scan:

repository
Git history
CI configuration
container images
deployment configuration
logs
documentation

Verify:

[ ] No production secrets in code
[ ] Secrets managed externally
[ ] Separate secrets by environment
[ ] Rotation procedure documented
[ ] Least-privilege credentials
[ ] Secret scanning enabled

Any valid exposed production credential is a P0 until revoked and rotated.

⸻

13. Data-protection audit

Create data inventory.

Classify:

public
internal
confidential
highly sensitive

Document:

collection
purpose
storage
retention
access
deletion
encryption

Verify data minimization.

Do not collect banking information merely because it may be useful later.

⸻

14. Logging audit

Logs must provide operational visibility without exposing:

PIN
password
OTP
access token
refresh token
bank credential
full sensitive account information

Verify structured logs contain:

request_id
transaction_id
service
event
timestamp
result

⸻

15. Audit-log audit

Sensitive operations must be attributable.

Verify events for:

login
new device
credential change
bank linking
transfer creation
risk decision
provider submission
settlement
reversal
admin action
permission change

Audit history must not be silently mutable.

⸻

16. Administrative-control audit

Inspect all privileged interfaces.

Verify:

[ ] Admin MFA
[ ] Role separation
[ ] Least privilege
[ ] Sensitive-action logging
[ ] No direct balance editor
[ ] No direct settlement override
[ ] Reason required for interventions

For critical operations consider:

dual approval

where appropriate.

⸻

17. Infrastructure audit

Verify environments:

Development
Staging
Production

are isolated.

Audit:

network boundaries
database access
secret access
deployment permissions
backup access
administrative access

No production database should be casually reachable from developer environments.

⸻

18. Deployment audit

Verify:

[ ] CI/CD controlled
[ ] Protected production deployment
[ ] Artifact traceability
[ ] Commit SHA recorded
[ ] Rollback process
[ ] Database migration strategy
[ ] Security checks in pipeline

Production deployments must be attributable.

⸻

19. Dependency audit

Check:

runtime dependencies
development dependencies
container images
GitHub Actions / CI dependencies
mobile dependencies

Run:

vulnerability scan
license review where required
dependency freshness review

Critical vulnerabilities require explicit remediation or documented mitigation.

⸻

20. Security-testing audit

Required:

SAST
dependency scanning
secret scanning
API security testing
authorization testing
financial invariant tests

Before real-money production additionally require independent or appropriately scoped penetration testing.

Findings must have:

severity
owner
status
remediation
evidence

⸻

21. Payments-QA audit

Confirm testing exists for:

double click
concurrency
network interruption
provider timeout
response loss
duplicate webhook
out-of-order webhook
service restart
ledger failure
risk failure
reversal
reconciliation mismatch

A happy-path test suite alone is insufficient.

⸻

22. Resilience audit

Verify behavior during:

database interruption
provider outage
queue outage
service restart
network partition
high latency
partial external failure

Confirm:

no duplicate payment
no lost financial state
no invalid settlement

⸻

23. Backup and recovery audit

Verify:

backup frequency
backup encryption
restore procedures
restore testing
RPO
RTO
ownership

A backup that has never been restored successfully is not sufficient evidence of recoverability.

⸻

24. Disaster-recovery audit

Document:

critical services
dependencies
failover strategy
communication path
recovery sequence

Test recovery periodically.

⸻

25. Observability audit

Required metrics include:

payment success rate
payment failure rate
duplicate attempts
provider latency
risk decisions
ledger failures
reconciliation mismatches
authentication failures
API errors

Critical alerts must have clear ownership.

⸻

26. Incident-response audit

Required plan must define:

detection
classification
containment
investigation
eradication
recovery
communication
postmortem

Scenarios should include:

account takeover
production secret leak
financial mismatch
provider compromise
unauthorized admin action
data exposure

⸻

27. Operational kill switches

Verify controlled mechanisms exist to disable:

new transfers
specific provider
high-risk operation
specific payment rail

A kill switch should not destroy the ability to:

query existing transactions
reconcile
investigate
complete safe recovery

⸻

28. Documentation audit

Minimum documentation:

SYSTEM_ARCHITECTURE.md
SECURITY_BASELINE.md
THREAT_MODEL.md
LEDGER_INVARIANTS.md
PAYMENT_STATE_MACHINE.md
BANK_ADAPTER_SPEC.md
RISK_POLICY.md
INCIDENT_RESPONSE.md
DISASTER_RECOVERY.md
RECONCILIATION_RUNBOOK.md
PRODUCTION_RUNBOOK.md

Documentation must reflect current implementation.

Stale documentation is not valid evidence.

⸻

29. Evidence package

Every audit produces:

audit date
commit SHA
environment
auditor/agent
scope
architecture version
test results
scan results
findings
severity
remediation status
final decision

Recommended directory:

docs/bank-readiness/
  architecture/
  security/
  tests/
  scans/
  policies/
  runbooks/
  evidence/
  audit-report.md

⸻

30. Bank due-diligence package

Before approaching a bank prepare a concise external package containing:

company/product overview
architecture diagram
money-flow diagram
security architecture
identity/KYC approach
fraud controls
ledger model
provider architecture
data-protection approach
incident response
business continuity
testing summary
penetration-test summary
integration API overview

Do not provide secrets, exploitable details or unnecessary internal information.

⸻

31. Audit report format

Every final report must include:

Executive Summary

Current readiness state.

Scope

What was reviewed.

Evidence

What was actually inspected.

Findings

Grouped by severity.

Financial Integrity

Ledger and payment correctness.

Security

Identity, authorization, data and infrastructure.

Operational Readiness

Monitoring, recovery and incident handling.

Banking Integration Readiness

Adapter and reconciliation maturity.

Blockers

Anything preventing the next stage.

Required Actions

Concrete remediation.

Decision

One of:

READY
READY_WITH_CONDITIONS
NOT_READY

⸻

32. No unsupported claims

Never report:

bank-grade
fully secure
compliant
certified
production-ready

without evidence sufficient to support the specific claim.

Prefer factual language:

"All defined ledger invariants passed the current test suite."

instead of:

"The ledger is perfectly secure."

⸻

33. Audit independence

The auditor must actively attempt to disprove readiness.

Do not merely confirm that implementation exists.

Ask:

Can this be bypassed?
Can this fail halfway?
Can this duplicate money?
Can this be abused by an administrator?
Can this survive provider inconsistency?
Can this be reconstructed afterward?

⸻

Stop conditions

Immediately classify as NOT_READY when evidence shows:

unbalanced ledger
duplicate financial settlement
unauthorized payment
active leaked production credential
direct balance manipulation
unverified financial webhook
no reconciliation capability
irrecoverable financial state

Do not soften these findings for schedule reasons.

⸻

Definition of Done

Bank-readiness review is complete only when:

[ ] Architecture reviewed
[ ] Threat model reviewed
[ ] Identity controls reviewed
[ ] Authorization tested
[ ] Ledger invariants verified
[ ] Idempotency verified
[ ] Risk controls reviewed
[ ] Provider adapters reviewed
[ ] Webhook security tested
[ ] Reconciliation verified
[ ] Secrets scanned
[ ] Data protection reviewed
[ ] Admin access reviewed
[ ] Infrastructure reviewed
[ ] CI/CD reviewed
[ ] Dependencies scanned
[ ] Financial QA evidence reviewed
[ ] Resilience reviewed
[ ] Backups tested
[ ] Incident response reviewed
[ ] Documentation current
[ ] Findings classified
[ ] Evidence package produced
[ ] Final decision issued

⸻

Product standard

The final question is not:

“Does the application look ready for a bank?”

It is:

“Can we demonstrate, with reproducible evidence, that the system protects financial integrity, controls access, survives failure, detects inconsistencies and produces an auditable record of what happened?”

If that cannot be demonstrated, the product is not bank-ready.