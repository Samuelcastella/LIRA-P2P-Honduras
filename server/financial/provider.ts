import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SANDBOX_PROVIDER = "SandboxBankAdapter";
export const PROVIDER_API_VERSION = "2026-09-sandbox";

export const providerWebhookSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["transfer.settled", "transfer.failed", "transfer.reversed"]),
  transferReference: z.string().min(8).max(48),
  providerReference: z.string().min(8).max(96),
  amountMinor: z.number().int().positive(),
  currency: z.literal("HNL"),
  occurredAt: z.string().datetime(),
  sequence: z.number().int().nonnegative(),
});

export type ProviderWebhook = z.infer<typeof providerWebhookSchema>;

export type ProviderTransferCommand = {
  transferReference: string;
  amountMinor: number;
  currency: "HNL";
  idempotencyKey: string;
};

export type ProviderTransferResult = {
  providerReference: string;
  status: "processing";
  acceptedAt: Date;
};

export interface PaymentProvider {
  readonly name: string;
  readonly apiVersion: string;
  createTransfer(command: ProviderTransferCommand): Promise<ProviderTransferResult>;
  getTransfer(providerReference: string): Promise<{ providerReference: string; status: "processing" | "settled" | "failed" | "reversed" }>;
  cancelTransfer(providerReference: string): Promise<{ providerReference: string; status: "canceled" | "processing" }>;
  reconcile(providerReference: string): Promise<{ providerReference: string; status: "unknown" | "processing" | "settled" | "failed" | "reversed" }>;
}

/**
 * Deterministic local adapter used only for product integration tests and the explicit sandbox.
 * It never sends a network request or moves money. Final settlement requires a verified webhook.
 */
export class SandboxBankAdapter implements PaymentProvider {
  readonly name = SANDBOX_PROVIDER;
  readonly apiVersion = PROVIDER_API_VERSION;

  async createTransfer(command: ProviderTransferCommand): Promise<ProviderTransferResult> {
    return {
      providerReference: `SBX-${command.transferReference}`,
      status: "processing",
      acceptedAt: new Date(),
    };
  }

  async getTransfer(providerReference: string) {
    return { providerReference, status: "processing" as const };
  }

  async cancelTransfer(providerReference: string) {
    return { providerReference, status: "processing" as const };
  }

  async reconcile(providerReference: string) {
    return { providerReference, status: "processing" as const };
  }
}

export function signWebhookPayload(secret: string, timestamp: string, body: Buffer | string) {
  return `v1=${createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex")}`;
}

export function verifyWebhookSignature(params: {
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  body: Buffer;
  now?: Date;
  maxAgeSeconds?: number;
}) {
  if (!params.secret || !params.signature || !params.timestamp) return { ok: false as const, reason: "missing_signature_material" };
  const seconds = Number(params.timestamp);
  if (!Number.isInteger(seconds)) return { ok: false as const, reason: "invalid_timestamp" };
  const ageSeconds = Math.abs((params.now?.getTime() ?? Date.now()) / 1000 - seconds);
  if (ageSeconds > (params.maxAgeSeconds ?? 300)) return { ok: false as const, reason: "expired_timestamp" };

  const expected = signWebhookPayload(params.secret, params.timestamp, params.body);
  const supplied = params.signature.startsWith("v1=") ? params.signature : `v1=${params.signature}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return { ok: false as const, reason: "invalid_signature" };
  }
  return { ok: true as const };
}
