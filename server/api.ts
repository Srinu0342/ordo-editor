import express from "express";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { HttpError, listFolders, parseRel, resolveInRoot } from "./workspace.ts";
import type { Workspace } from "./workspace.ts";
import { createDiagram, listDiagrams, readDiagramFile, writeDiagramFile } from "./diagrams.ts";
import type { Precondition } from "./diagrams.ts";

// Everything under /api. Mounted ahead of the frontend, so a route here wins
// over a page of the same name.
//
// The server keeps no "current repo": every call names its repo (and tab), so
// two browser tabs on two repos can't move each other. See OrdoInteraction.md,
// section 7, for the routes.
//
// There is no auth, so the guard is "only this machine, only this page". The
// server binds to loopback; on top of that the Host check stops DNS
// rebinding, and the exact-Origin check stops another site, or another app on
// another localhost port, from driving the API from the user's browser.
// Writes also insist on application/json or application/yaml, which a
// cross-origin page can't send without a CORS preflight, and this API answers
// none.

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

// The same names localhostHostValidation() allows, any port. Written here
// because that middleware answers 403 with a JSON-RPC body, not { error }.
const checkHost: RequestHandler = (req, _res, next) => {
  if (!LOOPBACK_HOST.test(req.headers.host ?? "")) throw new HttpError(403, "Ordo only answers requests addressed to localhost.");
  next();
};

// Absent (curl, an agent, a same-origin GET) or exactly this server's own
// origin. localhostOriginValidation() ignores the port, which would let any
// other dev server on localhost in.
const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${req.headers.host}`)
    throw new HttpError(403, "Ordo only answers requests from its own page.");
  next();
};

// Checked before the body is parsed: a parser skips a body of another type
// silently, which would surface later as a confusing "missing name".
const requireType =
  (type: string): RequestHandler =>
  (req, _res, next) => {
    if (!req.is(type)) throw new HttpError(415, `Send the body as ${type}.`);
    next();
  };

// If-Match: "<etag>" overwrites the version the client last read;
// If-None-Match: * recreates a file that is gone. A write with neither would
// be a blind overwrite, which is exactly what the ETags exist to prevent.
function precondition(req: Request): Precondition {
  const ifMatch = req.get("If-Match")?.trim();
  const ifNoneMatch = req.get("If-None-Match")?.trim();
  if (ifMatch && ifNoneMatch) throw new HttpError(400, "Send If-Match or If-None-Match, not both.");
  if (ifMatch && ifMatch !== "*") return { ifMatch };
  if (ifNoneMatch === "*") return { ifNoneMatch: "*" };
  throw new HttpError(428, 'Send If-Match with the ETag you last read, or If-None-Match: * to recreate the file.');
}

// The messages for body-parser's own errors, by its `type`.
const BODY_ERRORS: Record<string, string> = {
  "entity.too.large": "The request body is too large.",
  "entity.parse.failed": "The request body is not valid JSON.",
  "entity.verify.failed": "The request body could not be verified.",
  "encoding.unsupported": "The request body's encoding is not supported.",
  "charset.unsupported": "The request body's charset is not supported.",
  "request.aborted": "The request was aborted before its body arrived.",
  "request.size.invalid": "The request body's size does not match its Content-Length.",
};

export function createApi(ws: Workspace): express.Router {
  const api = express.Router();

  // First, so every answer carries it, refusals and errors included: the
  // file on disk is the truth, and a cached listing or ETag would hide a change.
  api.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  api.use(checkHost, checkOrigin);

  // The repo a call names, checked and resolved to its real folder.
  const repoDir = (req: Request) => resolveInRoot(ws, parseRel(req.query.repo, "repo"));
  // Express 5 has already decoded it, %2F included; diagrams.ts only ever
  // matches it against folder names, so "../.." finds nothing.
  const tabOf = (req: Request) => String(req.params.tab);

  api.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  api.get("/workspace", (_req, res) => {
    res.json({ label: ws.label });
  });

  api.get("/folders", async (req, res) => {
    // No path is the root; a repeated one is refused by parseRel.
    res.json(await listFolders(ws, req.query.path ?? ""));
  });

  api.get("/diagrams", async (req, res) => {
    res.json({ diagrams: await listDiagrams(await repoDir(req)) });
  });

  api.post("/diagrams", requireType("application/json"), express.json({ limit: "16kb" }), async (req, res) => {
    const dir = await repoDir(req);
    const name: unknown = req.body?.name;
    if (typeof name !== "string") throw new HttpError(400, 'Send the new diagram\'s name as { "name": "..." }.');
    const { text, etag } = await createDiagram(dir, name);
    res.status(201).set("ETag", etag).json({ text, etag });
  });

  api.get("/diagrams/:tab", async (req, res) => {
    const { text, etag } = await readDiagramFile(await repoDir(req), tabOf(req));
    res.set("ETag", etag).type("application/yaml").send(text);
  });

  api.put(
    "/diagrams/:tab",
    requireType("application/yaml"),
    // Before the body is read, so a write that can't succeed costs nothing.
    (req, res, next) => {
      res.locals.pre = precondition(req);
      next();
    },
    express.text({ type: "application/yaml", limit: "5mb" }),
    async (req, res) => {
      const dir = await repoDir(req);
      if (typeof req.body !== "string") throw new HttpError(400, "Send the diagram's YAML as the request body.");
      const { etag } = await writeDiagramFile(dir, tabOf(req), req.body, res.locals.pre as Precondition);
      res.set("ETag", etag).json({ etag });
    },
  );

  // Without this, an unknown /api path falls through to the frontend and comes
  // back as index.html with a 200, which a fetch would happily try to parse.
  api.use((req, res) => {
    res.status(404).json({ error: `no route for ${req.method} ${req.originalUrl}` });
  });

  // Last, so every failure is JSON. Without it an oversized body gets
  // Express's HTML 413 page, and the client can't show why.
  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.body });
      return;
    }
    const e = err as { type?: unknown; status?: unknown; code?: unknown };
    // body-parser's errors, and the router's for a path it can't decode, carry
    // a 4xx status of their own.
    const status = typeof e?.status === "number" && e.status >= 400 && e.status < 500 ? e.status : null;
    if (status) {
      const known = typeof e.type === "string" ? BODY_ERRORS[e.type] : undefined;
      res.status(status).json({ error: known ?? "The request could not be read." });
      return;
    }
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      res.status(403).json({ error: "Ordo is not allowed to read or write there." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong in the Ordo server." });
  };
  api.use(onError);

  return api;
}
