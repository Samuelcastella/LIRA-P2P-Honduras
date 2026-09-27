import { describe, expect, it } from "vitest";
import { PROVIDER_API_VERSION, SandboxBankAdapter, signWebhookPayload, verifyWebhookSignature } from "./provider";

describe("sandbox provider webhook verification", () => {
  const secret = "test-only-secret";
  const body = Buffer.from('{"id":"event"}', "utf8");
  const timestamp = "1760000000";
  const now = new Date(Number(timestamp) * 1000);

  it("accepts a valid HMAC signature within the permitted time window", () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature({ secret, signature, timestamp, body, now })).toEqual({ ok: true });
  });

  it("rejects altered payloads and invalid signatures", () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature({ secret, signature, timestamp, body: Buffer.from('{"id":"altered"}'), now })).toMatchObject({ ok: false, reason: "invalid_signature" });
    expect(verifyWebhookSignature({ secret, signature: "v1=not-valid", timestamp, body, now })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects expired or malformed timestamp material", () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature({ secret, signature, timestamp, body, now: new Date(now.getTime() + 301_000) })).toMatchObject({ ok: false, reason: "expired_timestamp" });
    expect(verifyWebhookSignature({ secret, signature, timestamp: "not-a-time", body, now })).toMatchObject({ ok: false, reason: "invalid_timestamp" });
  });
});

describe("sandbox provider reconciliation contract", () => {
  it("stays deterministic and never guesses a terminal outcome", async () => {
    const adapter = new SandboxBankAdapter();
    expect(adapter.apiVersion).toBe(PROVIDER_API_VERSION);

    const result = await adapter.reconcile({
      transferReference: "TX-20260927-ABCD1234",
      providerReference: null,
      idempotencyKey: "idem-provider-test",
      amountMinor: 25_000,
      currency: "HNL",
    });

    expect(result).toEqual({
      providerReference: "SBX-TX-20260927-ABCD1234",
      status: "processing",
      amountMinor: 25_000,
    });
  });
});
