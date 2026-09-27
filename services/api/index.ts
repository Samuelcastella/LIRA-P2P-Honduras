import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "../../server/_core/oauth";
import { registerStorageProxy } from "../../server/_core/storageProxy";
import { createContext } from "../../server/_core/context";
import { appRouter } from "../../server/routers";
import { registerSandboxWebhook } from "../../server/financial/webhook";

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

  server.listen(port, "0.0.0.0", () => {
    console.log(`[lira-api] listening on ${port} in sandbox mode`);
  });

  const shutdown = (signal: string) => {
    console.log(`[lira-api] received ${signal}; shutting down`);
    server.close((error) => {
      if (error) {
        console.error("[lira-api] shutdown failed", error);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error("[lira-api] fatal startup error", error);
  process.exitCode = 1;
});
