import http from "node:http";
import https from "node:https";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 3000);
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/public");
const apiBase = process.env.LIRA_API_INTERNAL_URL;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

function parseRelativeTarget(rawTarget) {
  if (!rawTarget || !rawTarget.startsWith("/") || rawTarget.startsWith("//")) return null;
  try {
    return new URL(rawTarget, "http://lira.local");
  } catch {
    return null;
  }
}

function configuredApiOrigin() {
  if (!apiBase) return null;
  try {
    const parsed = new URL(apiBase);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function proxyToApi(req, res, requestTarget) {
  const upstream = configuredApiOrigin();
  if (!upstream) {
    writeJson(res, 503, { error: apiBase ? "API_URL_INVALID" : "API_NOT_CONFIGURED" });
    return;
  }

  const target = new URL(upstream.origin);
  target.pathname = requestTarget.pathname;
  target.search = requestTarget.search;

  const transport = target.protocol === "https:" ? https : http;
  const { connection: _connection, host: _host, ...forwardHeaders } = req.headers;
  const headers = {
    ...forwardHeaders,
    host: target.host,
    "x-forwarded-host": req.headers.host || "",
    "x-forwarded-proto": req.headers["x-forwarded-proto"] || "https",
  };

  const proxyReq = transport.request(target, { method: req.method, headers }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      writeJson(res, 502, { error: "API_UNAVAILABLE" });
      return;
    }
    res.end();
  });

  req.pipe(proxyReq);
}

function resolveStaticPath(decodedPath) {
  const requested = decodedPath === "/" ? "/index.html" : decodedPath;
  const normalized = path.normalize(requested).replace(/^([.][.][/\\])+/, "");
  const candidate = path.resolve(publicDir, `.${normalized.startsWith("/") ? normalized : `/${normalized}`}`);
  if (!candidate.startsWith(`${publicDir}${path.sep}`) && candidate !== publicDir) return null;
  return candidate;
}

function serveFile(filePath, res, isSpaFallback = false) {
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "cache-control": ext === ".html" || isSpaFallback ? "no-store" : "public, max-age=31536000, immutable",
  };
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const requestTarget = parseRelativeTarget(req.url || "/");
  if (!requestTarget) {
    writeJson(res, 400, { error: "INVALID_REQUEST_TARGET" });
    return;
  }

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(requestTarget.pathname);
  } catch {
    writeJson(res, 400, { error: "INVALID_PATH_ENCODING" });
    return;
  }

  if (decodedPathname === "/health") {
    writeJson(res, 200, { status: "ok", service: "lira-web" });
    return;
  }

  if (decodedPathname.startsWith("/api/")) {
    proxyToApi(req, res, requestTarget);
    return;
  }

  const requested = resolveStaticPath(decodedPathname);
  if (requested && existsSync(requested) && statSync(requested).isFile()) {
    serveFile(requested, res);
    return;
  }

  const indexPath = path.join(publicDir, "index.html");
  if (existsSync(indexPath)) {
    serveFile(indexPath, res, true);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[lira-web] listening on :${port}; apiProxy=${configuredApiOrigin() ? "configured" : "missing"}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[lira-web] ${signal} received; draining active requests`);
  const forceExit = setTimeout(() => {
    console.error("[lira-web] graceful shutdown timed out");
    server.closeAllConnections?.();
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close((error) => {
    clearTimeout(forceExit);
    if (error) {
      console.error("[lira-web] shutdown error", error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
