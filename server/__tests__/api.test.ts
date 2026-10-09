// The /api router over real HTTP: the routes of OrdoInteraction.md section 7,
// the Host and Origin checks, path traversal through repo and tab, the PUT
// preconditions and body limits, and that every answer is JSON (or YAML for a
// diagram) with Cache-Control: no-store.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";

import { createApi } from "../api.ts";
import { DIAGRAM_FILE, EMPTY_DIAGRAM, ORDO_DIR } from "../diagrams.ts";
import { openWorkspace } from "../workspace.ts";

const DIAGRAM = "ordo: 1\nnodes:\n  - a\n  - b\nedges:\n  - { id: e1, from: a, to: b }\n---\nordo-layout: 1\n";
const YAML = { "Content-Type": "application/yaml" };
const JSON_TYPE = { "Content-Type": "application/json" };

type Served = { root: string; port: number; url: (p: string) => string };

// A workspace in a fresh temp folder, served on a free loopback port.
async function serve(t: TestContext): Promise<Served> {
  const given = await fs.mkdtemp(path.join(os.tmpdir(), "ordo-api-"));
  t.after(() => fs.rm(given, { recursive: true, force: true }));
  const ws = await openWorkspace({ ORDO_WORKSPACE: given });
  const app = express();
  app.use("/api", createApi(ws));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    // fetch keeps connections alive; close() alone would wait for them.
    server.closeAllConnections();
    return new Promise<void>((done) => server.close(() => done()));
  });
  const { port } = server.address() as AddressInfo;
  return { root: ws.root, port, url: (p) => `http://127.0.0.1:${port}/api${p}` };
}

// fetch, plus the checks every answer must pass.
async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  assert.equal(res.headers.get("cache-control"), "no-store", `${init?.method ?? "GET"} ${url}`);
  return res;
}

// An error answer: the status, JSON, and a one-sentence { error }.
async function fails(res: Response | Promise<Response>, status: number): Promise<Record<string, unknown>> {
  const r = await res;
  const body = (await r.json()) as Record<string, unknown>;
  assert.equal(r.status, status, JSON.stringify(body));
  assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(typeof body.error, "string");
  return body;
}

// Node's fetch replaces a Host header with the real one, so these go through http.request.
function raw(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  setHost = true,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers, setHost }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const q = (repo: string) => `?repo=${encodeURIComponent(repo)}`;

async function mkRepo(root: string, rel: string) {
  await fs.mkdir(path.join(root, rel), { recursive: true });
}

// --- basics -------------------------------------------------------------------

test("health, workspace and the JSON 404", async (t) => {
  const s = await serve(t);
  const health = await call(s.url("/health"));
  assert.deepEqual(await health.json(), { ok: true });
  const ws = await call(s.url("/workspace"));
  assert.deepEqual(await ws.json(), { label: path.basename(s.root) });
  const body = await fails(call(s.url("/nope")), 404);
  assert.match(String(body.error), /no route for GET \/api\/nope/);
});

test("folders: the root by default, a subfolder by path, flags on each", async (t) => {
  const s = await serve(t);
  await mkRepo(s.root, "code/api/.git");
  await mkRepo(s.root, "code/web/.ordo");
  await mkRepo(s.root, ".hidden");
  assert.deepEqual(await (await call(s.url("/folders"))).json(), {
    path: "",
    folders: [{ name: "code", git: false, ordo: false }],
    truncated: false,
  });
  assert.deepEqual(await (await call(s.url("/folders?path=code"))).json(), {
    path: "code",
    folders: [
      { name: "api", git: true, ordo: false },
      { name: "web", git: false, ordo: true },
    ],
    truncated: false,
  });
  await fails(call(s.url("/folders?path=../x")), 400);
  await fails(call(s.url("/folders?path=code&path=code")), 400);
  await fails(call(s.url("/folders?path=missing")), 404);
});

// --- traversal ----------------------------------------------------------------

test("repo: every traversal form is 400, a symlink out of the root is 403", async (t) => {
  const s = await serve(t);
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ordo-outside-")));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(s.root, "escape"));

  for (const search of [q("../x"), q("/etc"), q("a\\b"), q("C:/x"), "?repo=a&repo=b", "", q("a//b")])
    await fails(call(s.url(`/diagrams${search}`)), 400);
  await fails(call(s.url(`/diagrams${q("escape")}`)), 403);
  await fails(call(s.url(`/diagrams${q("missing")}`)), 404);

  // The same rules guard reads and writes.
  await fails(call(s.url(`/diagrams/x${q("../x")}`)), 400);
  await fails(
    call(s.url(`/diagrams${q("escape")}`), { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ name: "x" }) }),
    403,
  );
  await fails(
    call(s.url(`/diagrams/x?repo=a&repo=b`), { method: "PUT", headers: { ...YAML, "If-None-Match": "*" }, body: DIAGRAM }),
    400,
  );
  assert.deepEqual(await fs.readdir(outside), []);
});

test("tab=..%2F.. is 404 on a read and refused on a write, with nothing read or written", async (t) => {
  const s = await serve(t);
  await mkRepo(s.root, "repo/.ordo/auth");
  await fs.writeFile(path.join(s.root, "repo", ORDO_DIR, "auth", DIAGRAM_FILE), DIAGRAM);
  // repo/.ordo/../../ordo.yaml is the root's ordo.yaml: plant a valid one there.
  const planted = path.join(s.root, DIAGRAM_FILE);
  await fs.writeFile(planted, DIAGRAM);

  await fails(call(s.url(`/diagrams/..%2F..${q("repo")}`)), 404);
  const etag = (await call(s.url(`/diagrams/auth${q("repo")}`))).headers.get("etag")!;
  await fails(
    call(s.url(`/diagrams/..%2F..${q("repo")}`), { method: "PUT", headers: { ...YAML, "If-Match": etag }, body: EMPTY_DIAGRAM }),
    412,
  );
  await fails(
    call(s.url(`/diagrams/..%2F..${q("repo")}`), { method: "PUT", headers: { ...YAML, "If-None-Match": "*" }, body: EMPTY_DIAGRAM }),
    400,
  );
  assert.equal(await fs.readFile(planted, "utf8"), DIAGRAM);
});

// --- host and origin ----------------------------------------------------------

test("Origin must be absent or exactly this server's", async (t) => {
  const s = await serve(t);
  await fails(call(s.url("/workspace"), { headers: { Origin: "http://evil.example" } }), 403);
  // Another port on localhost is another origin.
  await fails(call(s.url("/workspace"), { headers: { Origin: "http://localhost:3000" } }), 403);
  await fails(call(s.url("/workspace"), { headers: { Origin: `http://localhost:${s.port}` } }), 403);
  await fails(call(s.url("/workspace"), { headers: { Origin: `https://127.0.0.1:${s.port}` } }), 403);
  await fails(call(s.url("/workspace"), { headers: { Origin: "null" } }), 403);
  const own = await call(s.url("/workspace"), { headers: { Origin: `http://127.0.0.1:${s.port}` } });
  assert.equal(own.status, 200);
  // A write from another origin is refused before anything is read.
  await mkRepo(s.root, "repo");
  await fails(
    call(s.url(`/diagrams${q("repo")}`), {
      method: "POST",
      headers: { ...JSON_TYPE, Origin: "http://evil.example" },
      body: JSON.stringify({ name: "x" }),
    }),
    403,
  );
  assert.deepEqual(await fs.readdir(path.join(s.root, "repo")), []);
});

test("Host must be localhost, 127.0.0.1 or [::1], any port", async (t) => {
  const s = await serve(t);
  for (const host of ["evil.example", "evil.example:5173", "localhost.evil.example", "127.0.0.2", "localhost@evil.example"]) {
    const res = await raw(s.port, "/api/workspace", { Host: host });
    assert.equal(res.status, 403, host);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(typeof JSON.parse(res.body).error, "string");
  }
  for (const host of ["localhost", "localhost:5173", "LOCALHOST:1", "127.0.0.1", `127.0.0.1:${s.port}`, "[::1]", "[::1]:5173"]) {
    const res = await raw(s.port, "/api/workspace", { Host: host });
    assert.equal(res.status, 200, host);
  }
  // No Host at all never reaches the router: Node refuses an HTTP/1.1
  // request without one (400) by itself.
  const none = await raw(s.port, "/api/workspace", {}, false);
  assert.equal(none.status, 400);
  // The Origin check compares against the Host the request was sent with.
  const matched = await raw(s.port, "/api/workspace", { Host: "localhost:5173", Origin: "http://localhost:5173" });
  assert.equal(matched.status, 200);
});

// --- writes -------------------------------------------------------------------

test("create, read, write and read again: the ETags change and the bytes match", async (t) => {
  const s = await serve(t);
  await mkRepo(s.root, "code/payments-api");
  const repo = q("code/payments-api");

  const created = await call(s.url(`/diagrams${repo}`), {
    method: "POST",
    headers: JSON_TYPE,
    body: JSON.stringify({ name: "auth flow" }),
  });
  assert.equal(created.status, 201);
  const { text, etag: e1 } = (await created.json()) as { text: string; etag: string };
  assert.equal(text, EMPTY_DIAGRAM);
  assert.equal(created.headers.get("etag"), e1);
  assert.match(e1, /^"[0-9a-f]{64}"$/);
  assert.deepEqual(await (await call(s.url(`/diagrams${repo}`))).json(), { diagrams: ["auth flow"] });

  const read = await call(s.url(`/diagrams/auth%20flow${repo}`));
  assert.equal(read.status, 200);
  assert.match(read.headers.get("content-type") ?? "", /^application\/yaml/);
  assert.equal(read.headers.get("etag"), e1);
  assert.equal(await read.text(), EMPTY_DIAGRAM);

  const written = await call(s.url(`/diagrams/auth%20flow${repo}`), {
    method: "PUT",
    headers: { ...YAML, "If-Match": e1 },
    body: DIAGRAM,
  });
  assert.equal(written.status, 200);
  const { etag: e2 } = (await written.json()) as { etag: string };
  assert.equal(written.headers.get("etag"), e2);
  assert.notEqual(e2, e1);

  const again = await call(s.url(`/diagrams/auth%20flow${repo}`));
  assert.equal(again.headers.get("etag"), e2);
  assert.equal(await again.text(), DIAGRAM);
  const disk = await fs.readFile(path.join(s.root, "code/payments-api", ORDO_DIR, "auth flow", DIAGRAM_FILE), "utf8");
  assert.equal(disk, DIAGRAM);
});

test("POST: a bad or taken name is 400 or 409; a wrong type 415; bad JSON 400; 50 kB 413", async (t) => {
  const s = await serve(t);
  await mkRepo(s.root, "repo");
  const post = (body: string, headers: Record<string, string> = JSON_TYPE) =>
    call(s.url(`/diagrams${q("repo")}`), { method: "POST", headers, body });

  assert.equal((await post(JSON.stringify({ name: "auth" }))).status, 201);
  const taken = await fails(post(JSON.stringify({ name: "Auth" })), 409);
  assert.equal(taken.error, 'There is already a diagram called "auth".');
  await fails(post(JSON.stringify({ name: "con" })), 400);
  await fails(post(JSON.stringify({ name: "../x" })), 400);
  await fails(post(JSON.stringify({ name: 7 })), 400);
  await fails(post(JSON.stringify({})), 400);
  await fails(post("{ not json"), 400);
  await fails(post(JSON.stringify({ name: "x" }), { "Content-Type": "text/plain" }), 415);
  await fails(post("name=x", { "Content-Type": "application/x-www-form-urlencoded" }), 415);
  await fails(post(JSON.stringify({ name: "x".repeat(50_000) })), 413);
  assert.deepEqual(await fs.readdir(path.join(s.root, "repo", ORDO_DIR)), ["auth"]);
});

test("PUT: 428 without a precondition, 412 stale, 422 invalid with diagnostics, 415, 413", async (t) => {
  const s = await serve(t);
  await mkRepo(s.root, "repo");
  const created = await call(s.url(`/diagrams${q("repo")}`), {
    method: "POST",
    headers: JSON_TYPE,
    body: JSON.stringify({ name: "auth" }),
  });
  const { etag } = (await created.json()) as { etag: string };
  const put = (body: string, headers: Record<string, string>) =>
    call(s.url(`/diagrams/auth${q("repo")}`), { method: "PUT", headers, body });

  await fails(put(DIAGRAM, YAML), 428);
  await fails(put(DIAGRAM, { ...YAML, "If-Match": "*" }), 428);
  await fails(put(DIAGRAM, { ...YAML, "If-None-Match": '"abc"' }), 428);
  await fails(put(DIAGRAM, { ...YAML, "If-Match": etag, "If-None-Match": "*" }), 400);
  await fails(put(DIAGRAM, { ...YAML, "If-Match": '"0000"' }), 412);
  await fails(put(DIAGRAM, { ...YAML, "If-None-Match": "*" }), 412);

  const invalid = await fails(put("ordo: 1\nnodes: [\n", { ...YAML, "If-Match": etag }), 422);
  const diagnostics = invalid.diagnostics as { severity: string; line?: number; message: string }[];
  assert.ok(Array.isArray(diagnostics) && diagnostics.length > 0);
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(typeof diagnostics[0].line, "number");

  await fails(put(DIAGRAM, { "Content-Type": "text/plain", "If-Match": etag }), 415);
  await fails(put(DIAGRAM, { "Content-Type": "application/json", "If-Match": etag }), 415);
  const big = await fails(put("x".repeat(6 * 1024 * 1024), { ...YAML, "If-Match": etag }), 413);
  assert.equal(big.error, "The request body is too large.");

  // None of that touched the file.
  const read = await call(s.url(`/diagrams/auth${q("repo")}`));
  assert.equal(read.headers.get("etag"), etag);
  assert.equal(await read.text(), EMPTY_DIAGRAM);

  // A charset on the type is fine.
  const ok = await put(DIAGRAM, { "Content-Type": "application/yaml; charset=utf-8", "If-Match": etag });
  assert.equal(ok.status, 200);
});

test("PUT with If-None-Match: * recreates a diagram whose folder git removed", async (t) => {
  const s = await serve(t);
  await mkRepo(s.root, "repo");
  await call(s.url(`/diagrams${q("repo")}`), { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ name: "auth" }) });
  await fs.rm(path.join(s.root, "repo", ORDO_DIR, "auth"), { recursive: true });

  await fails(call(s.url(`/diagrams/auth${q("repo")}`)), 404);
  const res = await call(s.url(`/diagrams/auth${q("repo")}`), {
    method: "PUT",
    headers: { ...YAML, "If-None-Match": "*" },
    body: DIAGRAM,
  });
  assert.equal(res.status, 200);
  const { etag } = (await res.json()) as { etag: string };
  assert.equal(res.headers.get("etag"), etag);
  assert.equal(await (await call(s.url(`/diagrams/auth${q("repo")}`))).text(), DIAGRAM);
});

test("a symlinked .ordo is 403 through the API", async (t) => {
  const s = await serve(t);
  await mkRepo(s.root, "repo");
  await mkRepo(s.root, "other/.ordo");
  await fs.symlink(path.join(s.root, "other", ORDO_DIR), path.join(s.root, "repo", ORDO_DIR));
  await fails(call(s.url(`/diagrams${q("repo")}`)), 403);
  await fails(
    call(s.url(`/diagrams${q("repo")}`), { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ name: "x" }) }),
    403,
  );
  assert.deepEqual(await fs.readdir(path.join(s.root, "other", ORDO_DIR)), []);
});
