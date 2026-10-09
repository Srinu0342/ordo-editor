import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApi } from "./api.ts";
import { mcp } from "./mcp.ts";
import { openWorkspace } from "./workspace.ts";

// One process, one port: the API, the MCP endpoint and the editor are served
// side by side.
//
//   dev   Vite runs inside this server as middleware, so the editor keeps hot
//         reload. Its HMR websocket rides the same HTTP server rather than
//         opening a second port.
//   prod  The bundle `vite build` wrote to dist/ is served as static files,
//         with index.html as the fallback for any other path.

const root = fileURLToPath(new URL("..", import.meta.url));

// Settings from .env at the repo root, when there is one (.env.sample lists
// them). Anything already set in the shell wins, so `PORT=5199 npm start`
// still works with a .env in place. Read once: edit it, then restart.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

const prod = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "localhost";

// The folder whose repos local mode can open. Checked before anything
// listens: a server that can't reach its root would fail every repo call.
const ws = await openWorkspace().catch((e: unknown) => {
  console.error(`ordo: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

const app = express();
const server = http.createServer(app);

app.use("/api", createApi(ws));
app.use("/mcp", mcp);

if (prod) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } },
  });
  app.use(vite.middlewares);
}

server.listen(port, host, () => {
  console.log(`ordo ${prod ? "production" : "dev"} server on http://${host}:${port}`);
  console.log(`ordo workspace root: ${ws.root}`);
});
