import express, { type Express } from "express";
import { ENV } from "../_core/env";
import { hashAuditMetadata } from "./domain";
import { providerWebhookSchema, verifyWebhookSignature } from "./provider";
import { processVerifiedProviderWebhook } from "../db";

export function registerSandboxWebhook(app: Express) {
  app.post("/api/provider-webhooks/sandbox-bank", express.raw({ type: "application/json", limit: "128kb" }), async (req, res) => {
    if (!ENV.sandboxProviderWebhookSecret) {
      return res.status(503).json({ accepted: false, code: "sandbox_webhook_secret_not_configured" });
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = verifyWebhookSignature({
      secret: ENV.sandboxProviderWebhookSecret,
      signature: req.header("x-lira-signature"),
      timestamp: req.header("x-lira-timestamp"),
      body: rawBody,
    });
    if (!signature.ok) return res.status(401).json({ accepted: false, code: signature.reason });

    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ accepted: false, code: "invalid_json" });
    }
    const parsed = providerWebhookSchema.safeParse(decoded);
    if (!parsed.success) return res.status(400).json({ accepted: false, code: "invalid_payload" });

    try {
      const result = await processVerifiedProviderWebhook(parsed.data, hashAuditMetadata({ raw: rawBody.toString("utf8") }));
      return res.status(result.duplicate ? 200 : result.accepted ? 202 : 409).json(result);
    } catch {
      return res.status(500).json({ accepted: false, code: "webhook_processing_failed" });
    }
  });
}
