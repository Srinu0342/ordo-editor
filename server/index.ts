import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { api } from "./api.ts";
import { mcp } from "./mcp.ts";

// One process, one port: the API, the MCP endpoint and the editor are served
// side by side.
//
//   dev   Vite runs inside this server as middleware, so the editor keeps hot
//         reload. Its HMR websocket rides the same HTTP server rather than
//         opening a second port.
//   prod  The bundle `vite build` wrote to dist/ is served as static files,
//         with index.html as the fallback for any other path.

const root = fileURLToPath(new URL("..", import.meta.url));
const prod = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "localhost";

const app = express();
const server = http.createServer(app);

app.use("/api", api);
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
});
