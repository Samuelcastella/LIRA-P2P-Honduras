import "dotenv/config";
import { createServer } from "node:http";
import { closeDb, dispatchPendingSandboxOutbox } from "../../server/db";
import { errorClass, operationalLog } from "../../server/observability";

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
let lastErrorAt: string | null = null;
let consecutiveFailures = 0;
const counters = {
  cycles: 0,
  dispatched: 0,
  unknown: 0,
  deadLettered: 0,
  tickFailures: 0,
};

async function tick() {
  if (running || stopping) return;
  running = true;
  counters.cycles += 1;
  const startedAt = Date.now();

  try {
    const result = await dispatchPendingSandboxOutbox(batchSize);
    lastSuccessAt = new Date().toISOString();
    consecutiveFailures = 0;
    counters.dispatched += result.dispatched;
    counters.unknown += result.unknown;
    counters.deadLettered += result.deadLettered;

    const shouldLogCycle = result.dispatched > 0 || result.unknown > 0 || result.deadLettered > 0 || counters.cycles % 12 === 0;
    if (shouldLogCycle) {
      operationalLog("lira-worker", "dispatch_cycle_completed", {
        durationMs: Date.now() - startedAt,
        dispatched: result.dispatched,
        unknown: result.unknown,
        deadLettered: result.deadLettered,
        cycles: counters.cycles,
      }, result.deadLettered > 0 ? "warn" : "info");
    }
  } catch (error) {
    consecutiveFailures += 1;
    counters.tickFailures += 1;
    lastErrorAt = new Date().toISOString();
    operationalLog("lira-worker", "dispatch_cycle_failed", {
      durationMs: Date.now() - startedAt,
      errorClass: errorClass(error),
      consecutiveFailures,
      tickFailures: counters.tickFailures,
    }, "error");
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

  const degraded = consecutiveFailures >= 3;
  res.setHeader("content-type", "application/json");
  res.statusCode = degraded ? 503 : 200;
  res.end(JSON.stringify({
    service: "lira-worker",
    status: degraded ? "degraded" : "ok",
    mode: "sandbox",
    running,
    lastSuccessAt,
    lastErrorAt,
    consecutiveFailures,
    counters,
  }));
});

healthServer.on("error", (error) => {
  operationalLog("lira-worker", "health_server_error", { errorClass: errorClass(error) }, "error");
  process.exitCode = 1;
});

healthServer.listen(healthPort, "0.0.0.0", () => {
  operationalLog("lira-worker", "service_started", { port: healthPort, intervalMs, batchSize, mode: "sandbox" });
});

const timer = setInterval(() => void tick(), intervalMs);
timer.unref();
void tick();

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  operationalLog("lira-worker", "shutdown_started", { signal });

  const forceExitTimer = setTimeout(() => {
    operationalLog("lira-worker", "shutdown_timeout", { signal }, "error");
    process.exitCode = 1;
  }, 10_000);
  forceExitTimer.unref();

  healthServer.close((serverError) => {
    void closeDb()
      .catch((dbError) => {
        operationalLog("lira-worker", "database_shutdown_failed", { errorClass: errorClass(dbError) }, "error");
        process.exitCode = 1;
      })
      .finally(() => {
        clearTimeout(forceExitTimer);
        if (serverError) {
          operationalLog("lira-worker", "health_server_shutdown_failed", { errorClass: errorClass(serverError) }, "error");
          process.exitCode = 1;
        } else {
          operationalLog("lira-worker", "shutdown_completed", { signal });
        }
      });
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
