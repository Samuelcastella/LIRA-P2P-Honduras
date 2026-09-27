import "dotenv/config";
import { createServer } from "node:http";
import { reconcilePendingSandboxTransfers } from "../../server/db";

function assertSandboxRuntime() {
  if (process.env.LIRA_REAL_MONEY_ENABLED === "true") {
    throw new Error("Canonical reconciliation is not authorized for real-money operation");
  }
  if (process.env.LIRA_SANDBOX_ONLY === "false") {
    throw new Error("Canonical reconciliation must remain sandbox-only until migration approval");
  }
}

const intervalMs = Number(process.env.LIRA_RECONCILIATION_INTERVAL_MS ?? 30_000);
const batchSize = Number(process.env.LIRA_RECONCILIATION_BATCH_SIZE ?? 50);

if (!Number.isFinite(intervalMs) || intervalMs < 1_000) throw new Error("LIRA_RECONCILIATION_INTERVAL_MS must be at least 1000");
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) throw new Error("LIRA_RECONCILIATION_BATCH_SIZE must be between 1 and 200");

assertSandboxRuntime();

let stopping = false;
let running = false;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;

async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    const result = await reconcilePendingSandboxTransfers(batchSize);
    lastSuccessAt = new Date().toISOString();
    lastError = null;
    if (result.checked || result.resolved) {
      console.log("[lira-reconciliation] reconciliation cycle", result);
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("[lira-reconciliation] reconciliation cycle failed", error);
  } finally {
    running = false;
  }
}

const healthPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(healthPort) || healthPort <= 0 || healthPort > 65535) throw new Error(`Invalid PORT: ${process.env.PORT ?? ""}`);

const healthServer = createServer((req, res) => {
  if (req.url !== "/healthz") {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", "application/json");
  res.statusCode = lastError && !lastSuccessAt ? 503 : 200;
  res.end(JSON.stringify({ service: "lira-reconciliation", status: res.statusCode === 200 ? "ok" : "degraded", running, lastSuccessAt, lastError }));
});

healthServer.listen(healthPort, "0.0.0.0", () => {
  console.log(`[lira-reconciliation] health endpoint listening on ${healthPort}`);
});

const timer = setInterval(() => void tick(), intervalMs);
timer.unref();
void tick();

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  console.log(`[lira-reconciliation] received ${signal}; shutting down`);
  healthServer.close((error) => {
    if (error) {
      console.error("[lira-reconciliation] health server shutdown failed", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
