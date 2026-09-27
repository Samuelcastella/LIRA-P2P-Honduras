import { createHash, randomUUID } from "node:crypto";

export const TRANSFER_STATES = [
  "created",
  "authenticating",
  "risk_review",
  "authorized",
  "processing",
  "settled",
  "declined",
  "failed",
  "canceled",
  "reversed",
  "expired",
] as const;

export type TransferState = (typeof TRANSFER_STATES)[number];
export type RiskDecision = "allow" | "challenge" | "review" | "block";
export type LedgerDirection = "debit" | "credit";

export type TransferIntent = {
  senderUserId: number;
  recipientHandle: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: number;
  currency: "HNL";
  idempotencyKey: string;
};

export type JournalEntry = {
  id: string;
  transferId: string;
  accountId: string;
  direction: LedgerDirection;
  amountMinor: number;
  currency: "HNL";
};

export type RiskContext = {
  amountMinor: number;
  isNewDevice?: boolean;
  attemptsInFiveMinutes?: number;
  distinctRecipientsInHour?: number;
};

export type RiskAssessment = {
  decision: RiskDecision;
  rule: string;
  score: number;
  severity: "low" | "medium" | "high";
  policyVersion: "sandbox-v1";
};

const transitions: Record<TransferState, readonly TransferState[]> = {
  created: ["authenticating", "canceled", "expired"],
  authenticating: ["risk_review", "declined", "failed"],
  risk_review: ["authorized", "declined", "failed"],
  authorized: ["processing", "canceled", "failed"],
  processing: ["settled", "failed", "reversed"],
  settled: ["reversed"],
  declined: [],
  failed: [],
  canceled: [],
  reversed: [],
  expired: [],
};

export class FinancialInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialInvariantError";
  }
}

export function assertPositiveMinorAmount(amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new FinancialInvariantError("amountMinor must be a positive safe integer");
  }
}

export function assertAllowedTransition(from: TransferState, to: TransferState) {
  if (!transitions[from].includes(to)) {
    throw new FinancialInvariantError(`Invalid transfer transition: ${from} → ${to}`);
  }
}

export function fingerprintIntent(intent: Pick<TransferIntent, "recipientHandle" | "sourceAccountId" | "destinationAccountId" | "amountMinor" | "currency">) {
  const canonical = JSON.stringify({
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    destinationAccountId: intent.destinationAccountId,
    recipientHandle: intent.recipientHandle.trim().toLowerCase(),
    sourceAccountId: intent.sourceAccountId,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function assertIdempotency(existingFingerprint: string, requestFingerprint: string) {
  if (existingFingerprint !== requestFingerprint) {
    throw new FinancialInvariantError("Idempotency key was reused with a different financial intent");
  }
}

export function evaluateRisk(context: RiskContext): RiskAssessment {
  if ((context.attemptsInFiveMinutes ?? 0) >= 10) {
    return { decision: "block", rule: "attempt_velocity_limit", score: 100, severity: "high", policyVersion: "sandbox-v1" };
  }
  if ((context.distinctRecipientsInHour ?? 0) >= 8) {
    return { decision: "review", rule: "recipient_velocity_review", score: 75, severity: "high", policyVersion: "sandbox-v1" };
  }
  if (context.isNewDevice && context.amountMinor >= 500_000) {
    return { decision: "review", rule: "new_device_high_value", score: 70, severity: "high", policyVersion: "sandbox-v1" };
  }
  if (context.amountMinor >= 1_000_000) {
    return { decision: "challenge", rule: "high_value_challenge", score: 45, severity: "medium", policyVersion: "sandbox-v1" };
  }
  return { decision: "allow", rule: "baseline_allow", score: 5, severity: "low", policyVersion: "sandbox-v1" };
}

export function createBalancedJournal(transferId: string, intent: TransferIntent): JournalEntry[] {
  assertPositiveMinorAmount(intent.amountMinor);
  if (intent.sourceAccountId === intent.destinationAccountId) {
    throw new FinancialInvariantError("Source and destination financial accounts must be distinct");
  }

  return [
    {
      id: randomUUID(),
      transferId,
      accountId: intent.sourceAccountId,
      direction: "debit",
      amountMinor: intent.amountMinor,
      currency: intent.currency,
    },
    {
      id: randomUUID(),
      transferId,
      accountId: intent.destinationAccountId,
      direction: "credit",
      amountMinor: intent.amountMinor,
      currency: intent.currency,
    },
  ];
}

export function assertBalancedJournal(entries: readonly JournalEntry[]) {
  if (entries.length !== 2) {
    throw new FinancialInvariantError("A sandbox transfer must contain exactly one debit and one credit");
  }
  const debit = entries.filter((entry) => entry.direction === "debit");
  const credit = entries.filter((entry) => entry.direction === "credit");
  if (debit.length !== 1 || credit.length !== 1) {
    throw new FinancialInvariantError("A transfer must contain exactly one debit and one credit");
  }
  if (debit[0].currency !== credit[0].currency || debit[0].amountMinor !== credit[0].amountMinor) {
    throw new FinancialInvariantError("Debit and credit values must match exactly");
  }
  if (debit[0].accountId === credit[0].accountId) {
    throw new FinancialInvariantError("A transfer cannot debit and credit the same account");
  }
}

export function createTransferReference(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `TX-${date}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export function hashAuditMetadata(metadata: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
}
