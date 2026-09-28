import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "../../server/_core/oauth";
import { registerStorageProxy } from "../../server/_core/storageProxy";
import { createContext } from "../../server/_core/context";
import { appRouter } from "../../server/routers";
import { closeDb, getDb } from "../../server/db";
import { registerSandboxWebhook } from "../../server/financial/webhook";
import { errorClass, operationalLog } from "../../server/observability";

function assertSandboxRuntime() {
  if (process.env.LIRA_REAL_MONEY_ENABLED === "true") {
    throw new Error("Canonical API is not authorized for real-money operation");
  }
  if (process.env.LIRA_SANDBOX_ONLY === "false") {
    throw new Error("Canonical API must remain sandbox-only until migration approval");
  }
}

async function start() {
  assertSandboxRuntime();

  const app = express();
  const server = createServer(app);

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ service: "lira-api", status: "ok", mode: "sandbox" });
  });

  app.get("/ready", async (_req, res) => {
    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ service: "lira-api", status: "not_ready", mode: "sandbox" });
        return;
      }
      await db.execute(sql`select 1`);
      res.status(200).json({ service: "lira-api", status: "ready", mode: "sandbox" });
    } catch (error) {
      operationalLog("lira-api", "readiness_check_failed", { errorClass: errorClass(error) }, "error");
      res.status(503).json({ service: "lira-api", status: "not_ready", mode: "sandbox" });
    }
  });

  registerSandboxWebhook(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT ?? ""}`);
  }

  server.on("error", (error) => {
    operationalLog("lira-api", "server_error", { errorClass: errorClass(error) }, "error");
    process.exitCode = 1;
  });

  server.listen(port, "0.0.0.0", () => {
    operationalLog("lira-api", "service_started", { port, mode: "sandbox" });
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    operationalLog("lira-api", "shutdown_started", { signal });

    const forceExitTimer = setTimeout(() => {
      operationalLog("lira-api", "shutdown_timeout", { signal }, "error");
      process.exitCode = 1;
    }, 10_000);
    forceExitTimer.unref();

    server.close((serverError) => {
      void closeDb()
        .catch((dbError) => {
          operationalLog("lira-api", "database_shutdown_failed", { errorClass: errorClass(dbError) }, "error");
          process.exitCode = 1;
        })
        .finally(() => {
          clearTimeout(forceExitTimer);
          if (serverError) {
            operationalLog("lira-api", "server_shutdown_failed", { errorClass: errorClass(serverError) }, "error");
            process.exitCode = 1;
          } else {
            operationalLog("lira-api", "shutdown_completed", { signal });
          }
        });
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  operationalLog("lira-api", "fatal_startup_error", { errorClass: errorClass(error) }, "error");
  process.exitCode = 1;
});
