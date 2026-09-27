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

function proxyToApi(req, res) {
  if (!apiBase) {
    res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: "API_NOT_CONFIGURED" }));
    return;
  }

  let target;
  try {
    target = new URL(req.url || "/", apiBase.endsWith("/") ? apiBase : `${apiBase}/`);
  } catch {
    res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: "API_URL_INVALID" }));
    return;
  }

  const transport = target.protocol === "https:" ? https : http;
  const headers = {
    ...req.headers,
    host: target.host,
    "x-forwarded-host": req.headers.host || "",
    "x-forwarded-proto": req.headers["x-forwarded-proto"] || "https",
  };

  const proxyReq = transport.request(
    target,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    }
    res.end(JSON.stringify({ error: "API_UNAVAILABLE" }));
  });

  req.pipe(proxyReq);
}

function resolveStaticPath(urlPath) {
  const rawPath = decodeURIComponent(urlPath.split("?")[0] || "/");
  const requested = rawPath === "/" ? "/index.html" : rawPath;
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
  const pathname = new URL(req.url || "/", "http://lira.local").pathname;

  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ status: "ok", service: "lira-web" }));
    return;
  }

  if (pathname.startsWith("/api/")) {
    proxyToApi(req, res);
    return;
  }

  const requested = resolveStaticPath(pathname);
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
  console.log(`[lira-web] listening on :${port}; apiProxy=${apiBase ? "configured" : "missing"}`);
});
