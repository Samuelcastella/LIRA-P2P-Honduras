import pg from "pg";
import crypto from "node:crypto";

process.env.LIRA_OUTBOX_MAX_ATTEMPTS = "2";
process.env.LIRA_OUTBOX_RETRY_BACKOFF_MS = "0";
process.env.LIRA_RECONCILIATION_STALE_MS = "1000";

const [{ dispatchPendingSandboxOutbox, reconcilePendingSandboxTransfers, closeDb }, { SandboxBankAdapter }] = await Promise.all([
  import("../server/db"),
  import("../server/financial/provider"),
]);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: "lira-worker-reconciliation-verifier" });

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const originalCreateTransfer = SandboxBankAdapter.prototype.createTransfer;
const originalReconcile = SandboxBankAdapter.prototype.reconcile;

try {
  const client = await pool.connect();
  try {
    const user = await client.query(
      'insert into users ("openId",name,"loginMethod",role) values ($1,$2,$3,$4) returning id',
      [`worker-ci-${crypto.randomUUID()}`, "Worker CI", "ci", "user"],
    );
    const userId = Number(user.rows[0].id);

    const sourceAccountId = `worker-src-${crypto.randomUUID()}`;
    const destinationAccountId = `worker-dst-${crypto.randomUUID()}`;
    await client.query(
      'insert into financial_accounts (id,"userId","accountType",currency,status) values ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [
        sourceAccountId, userId, "user_wallet", "HNL", "active",
        destinationAccountId, null, "sandbox_clearing", "HNL", "active",
      ],
    );

    const transferId = crypto.randomUUID();
    const transferReference = `TX-CI-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const idempotencyKey = `ci-${crypto.randomUUID()}`;
    await client.query(
      'insert into transfers (id,reference,"senderUserId","recipientHandle","sourceAccountId","destinationAccountId","amountMinor",currency,status,"riskDecision","idempotencyKey","requestFingerprint","providerSubmittedAt") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())',
      [
        transferId,
        transferReference,
        userId,
        "@worker-ci",
        sourceAccountId,
        destinationAccountId,
        100,
        "HNL",
        "processing",
        "allow",
        idempotencyKey,
        "1".repeat(64),
      ],
    );

    const outboxId = crypto.randomUUID();
    await client.query(
      'insert into outbox_events (id,"aggregateType","aggregateId","eventType","payloadHash",status,"attemptCount") values ($1,$2,$3,$4,$5,$6,$7)',
      [outboxId, "transfer", transferId, "provider.transfer.requested", "2".repeat(64), "pending", 0],
    );

    SandboxBankAdapter.prototype.createTransfer = async () => {
      const error = new Error("simulated provider timeout");
      error.name = "ProviderTimeoutError";
      throw error;
    };

    const firstDispatch = await dispatchPendingSandboxOutbox(10);
    assert(firstDispatch.unknown === 1, "first failed dispatch must become unknown");
    assert(firstDispatch.deadLettered === 0, "first failed dispatch must not dead-letter immediately");

    let outbox = await client.query('select status,"attemptCount","failureCode" from outbox_events where id=$1', [outboxId]);
    assert(outbox.rows[0].status === "unknown", "outbox must be retryable after first provider failure");
    assert(Number(outbox.rows[0].attemptCount) === 1, "first dispatch attempt count must equal one");

    await sleep(10);
    const secondDispatch = await dispatchPendingSandboxOutbox(10);
    assert(secondDispatch.deadLettered === 1, "second failed dispatch must dead-letter at configured attempt cap");

    outbox = await client.query('select status,"attemptCount","failureCode" from outbox_events where id=$1', [outboxId]);
    assert(outbox.rows[0].status === "dead_letter", "outbox must enter terminal dead_letter status");
    assert(Number(outbox.rows[0].attemptCount) === 2, "dead-lettered event must retain the final attempt count");
    assert(outbox.rows[0].failureCode === "provider_submission_dead_letter", "dead-letter reason must be explicit");

    const deadLetterRisk = await client.query(
      'select count(*)::int as count from risk_events where "transferId"=$1 and rule=$2',
      [transferId, "outbox_dispatch_dead_letter"],
    );
    assert(deadLetterRisk.rows[0].count === 1, "dead-lettering must raise exactly one review risk event");

    const thirdDispatch = await dispatchPendingSandboxOutbox(10);
    assert(thirdDispatch.dispatched === 0 && thirdDispatch.unknown === 0 && thirdDispatch.deadLettered === 0, "dead-lettered events must never be picked up again");

    const staleTransferId = crypto.randomUUID();
    const staleReference = `TX-CI-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await client.query(
      'insert into transfers (id,reference,"senderUserId","recipientHandle","sourceAccountId","destinationAccountId","amountMinor",currency,status,"riskDecision","idempotencyKey","requestFingerprint","providerReference","providerSubmittedAt","unknownAt","unknownReason","updatedAt") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now() - interval \'2 minutes\',now() - interval \'2 minutes\',$14,now() - interval \'2 minutes\')',
      [
        staleTransferId,
        staleReference,
        userId,
        "@recon-ci",
        sourceAccountId,
        destinationAccountId,
        125,
        "HNL",
        "unknown",
        "allow",
        `ci-${crypto.randomUUID()}`,
        "3".repeat(64),
        `SBX-${staleReference}`,
        "provider_submission_outcome_unknown",
      ],
    );

    SandboxBankAdapter.prototype.reconcile = async (command) => ({
      providerReference: command.providerReference ?? `SBX-${command.transferReference}`,
      status: "unknown",
      amountMinor: command.amountMinor,
    });

    const firstReconciliation = await reconcilePendingSandboxTransfers(1);
    assert(firstReconciliation.checked === 1, "reconciliation verifier must inspect the stale transfer");
    assert(firstReconciliation.escalated === 1, "stale unresolved transfer must raise an escalation");

    const secondReconciliation = await reconcilePendingSandboxTransfers(1);
    assert(secondReconciliation.checked === 1, "stale transfer must remain reconcilable");
    assert(secondReconciliation.escalated === 0, "reconciliation escalation must be idempotent");

    const staleRisk = await client.query(
      'select count(*)::int as count from risk_events where "transferId"=$1 and rule=$2',
      [staleTransferId, "reconciliation_stale_unresolved"],
    );
    assert(staleRisk.rows[0].count === 1, "stale reconciliation must create exactly one review risk event");

    const escalationAudit = await client.query(
      'select count(*)::int as count from audit_events where "resourceId"=$1 and action=$2',
      [staleTransferId, "reconciliation_escalated"],
    );
    assert(escalationAudit.rows[0].count === 1, "reconciliation escalation must be auditable");

    console.log("Canonical worker retry/dead-letter and reconciliation escalation verified.");
  } finally {
    client.release();
  }
} finally {
  SandboxBankAdapter.prototype.createTransfer = originalCreateTransfer;
  SandboxBankAdapter.prototype.reconcile = originalReconcile;
  await closeDb();
  await pool.end();
}
