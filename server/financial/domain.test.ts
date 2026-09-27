import { describe, expect, it } from "vitest";
import {
  FinancialInvariantError,
  assertAllowedTransition,
  assertBalancedJournal,
  assertIdempotency,
  assertPositiveMinorAmount,
  createBalancedJournal,
  evaluateRisk,
  fingerprintIntent,
  type TransferIntent,
} from "./domain";

const intent: TransferIntent = {
  senderUserId: 42,
  recipientHandle: "@carlos",
  sourceAccountId: "wallet-42",
  destinationAccountId: "wallet-carlos",
  amountMinor: 50_000,
  currency: "HNL",
  idempotencyKey: "idem-42-001",
};

describe("financial transfer invariants", () => {
  it("rejects fractional, zero and negative money amounts", () => {
    expect(() => assertPositiveMinorAmount(0)).toThrow(FinancialInvariantError);
    expect(() => assertPositiveMinorAmount(-1)).toThrow(FinancialInvariantError);
    expect(() => assertPositiveMinorAmount(10.5)).toThrow(FinancialInvariantError);
  });

  it("posts exactly one balanced debit and credit", () => {
    const journal = createBalancedJournal("transfer-1", intent);
    expect(journal).toHaveLength(2);
    expect(journal.map((entry) => entry.direction).sort()).toEqual(["credit", "debit"]);
    expect(() => assertBalancedJournal(journal)).not.toThrow();
  });

  it("rejects a ledger with mismatched amounts", () => {
    const journal = createBalancedJournal("transfer-1", intent);
    journal[1].amountMinor = 49_999;
    expect(() => assertBalancedJournal(journal)).toThrow(FinancialInvariantError);
  });

  it("rejects a transfer that uses the same source and destination account", () => {
    expect(() => createBalancedJournal("transfer-1", { ...intent, destinationAccountId: intent.sourceAccountId })).toThrow(FinancialInvariantError);
  });

  it("rejects impossible state transitions", () => {
    expect(() => assertAllowedTransition("created", "settled")).toThrow(FinancialInvariantError);
    expect(() => assertAllowedTransition("created", "authenticating")).not.toThrow();
  });

  it("keeps repeated idempotent intents stable and rejects payload changes", () => {
    const original = fingerprintIntent(intent);
    expect(() => assertIdempotency(original, fingerprintIntent({ ...intent, idempotencyKey: "idem-42-002" }))).not.toThrow();
    expect(() => assertIdempotency(original, fingerprintIntent({ ...intent, amountMinor: 50_001 }))).toThrow(FinancialInvariantError);
  });

  it("fails closed for excessive velocity", () => {
    expect(evaluateRisk({ amountMinor: 1_000, attemptsInFiveMinutes: 10 }).decision).toBe("block");
    expect(evaluateRisk({ amountMinor: 500_000, isNewDevice: true }).decision).toBe("review");
    expect(evaluateRisk({ amountMinor: 10_000 }).decision).toBe("allow");
  });
});
