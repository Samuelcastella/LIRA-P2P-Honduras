import "dotenv/config";
import { createServer } from "node:http";
import { dispatchPendingSandboxOutbox } from "../../server/db";

function assertSandboxRuntime() {
  if (process.env.LIRA_REAL_MONEY_ENABLED === "true") {
    throw new Error("Canonical worker is not authorized for real-money operation");
  }
  if (process.env.LIRA_SANDBOX_ONLY === "false") {
    throw new Error("Canonical worker must remain sandbox-only until migration approval");
  }
}

const intervalMs = Number(process.env.LIRA_WORKER_INTERVAL_MS ?? 5_000);
const batchSize = Number(process.env.LIRA_WORKER_BATCH_SIZE ?? 20);

if (!Number.isFinite(intervalMs) || intervalMs < 1_000) throw new Error("LIRA_WORKER_INTERVAL_MS must be at least 1000");
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("LIRA_WORKER_BATCH_SIZE must be between 1 and 100");

assertSandboxRuntime();

let stopping = false;
let running = false;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;

async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    const result = await dispatchPendingSandboxOutbox(batchSize);
    lastSuccessAt = new Date().toISOString();
    lastError = null;
    if (result.dispatched || result.unknown) {
      console.log("[lira-worker] dispatch cycle", result);
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("[lira-worker] dispatch cycle failed", error);
  } finally {
    running = false;
  }
}

const healthPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(healthPort) || healthPort <= 0 || healthPort > 65535) throw new Error(`Invalid PORT: ${process.env.PORT ?? ""}`);

const healthPaths = new Set(["/healthz", "/health"]);
const healthServer = createServer((req, res) => {
  if (!healthPaths.has(req.url ?? "")) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", "application/json");
  res.statusCode = lastError && !lastSuccessAt ? 503 : 200;
  res.end(JSON.stringify({ service: "lira-worker", status: res.statusCode === 200 ? "ok" : "degraded", running, lastSuccessAt, lastError }));
});

healthServer.listen(healthPort, "0.0.0.0", () => {
  console.log(`[lira-worker] health endpoint listening on ${healthPort}`);
});

const timer = setInterval(() => void tick(), intervalMs);
timer.unref();
void tick();

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  console.log(`[lira-worker] received ${signal}; shutting down`);
  healthServer.close((error) => {
    if (error) {
      console.error("[lira-worker] health server shutdown failed", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
