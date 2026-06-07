// Minimal zero-dependency static server for local development.
// Sends `Cache-Control: no-store` so the browser never serves stale JS/CSS —
// no version query strings or hard-refreshes needed while iterating.
//
// Usage: node tools/dev-server.mjs [port]

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.argv[2] || process.env.PORT || 8124);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = path.join(root, pathname);
    // Block path traversal outside the repo root.
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store, must-revalidate"
    });
    res.end(body);
  } catch (error) {
    const notFound = error.code === "ENOENT" || error.code === "EISDIR";
    res.writeHead(notFound ? 404 : 500);
    res.end(notFound ? "Not found" : "Server error");
  }
});

server.listen(port, () => {
  console.log(`Dev server (no-store) running at http://localhost:${port}`);
});
