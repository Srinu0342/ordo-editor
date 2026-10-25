// The /mcp endpoint over real HTTP: the two tools a model sees and what they
// answer, the guide's pages, validate_ordo by text and by path (with the same
// root and symlink rules as /api), and the Host and Origin checks.
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

import { createMcp } from "../mcp.ts";
import { openWorkspace } from "../workspace.ts";
import { EDGE_ROUTES, GUIDE_TOPICS, LEAF_KINDS, LINES, MARKERS } from "../../src/ordo/types.ts";
import { SHAPE_KEYS } from "../../src/shapes/registry.ts";

const VALID = "ordo: 1\nnodes:\n  - g:\n      - a\n  - b\nedges:\n  - { id: e1, from: a, to: b }\n";
const BROKEN = [
  "ordo: 1",
  "nodes: [a, b]",
  "edges:",
  "  - { id: e1, from: a, to: c }",
  "data:",
  "  nodes:",
  "    a: { shape: cylnder }",
  "  edges:",
  "    e1: { line: dashd }",
  "---",
  "ordo-layout: 1",
  "nodes:",
  "  ghost: { x: 0, y: 0 }",
  "",
].join("\n");

type Served = { root: string; port: number };

// A workspace with one repo, demo, holding a valid diagram and a broken one.
async function serve(t: TestContext): Promise<Served> {
  const given = await fs.mkdtemp(path.join(os.tmpdir(), "ordo-mcp-"));
  t.after(() => fs.rm(given, { recursive: true, force: true }));
  for (const [name, text] of [
    ["main", VALID],
    ["broken", BROKEN],
  ]) {
    await fs.mkdir(path.join(given, "demo", ".ordo", name), { recursive: true });
    await fs.writeFile(path.join(given, "demo", ".ordo", name, "ordo.yaml"), text);
  }
  const ws = await openWorkspace({ ORDO_WORKSPACE: given });
  const app = express();
  app.use("/mcp", createMcp(ws));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((done) => server.close(() => done()));
  });
  return { root: ws.root, port: (server.address() as AddressInfo).port };
}

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  "MCP-Protocol-Version": "2025-06-18",
};

// One JSON-RPC call. The stateless transport answers as an event stream; the
// message is its data line.
async function rpc(s: Served, method: string, params: object = {}): Promise<{ result?: any; error?: any }> {
  const res = await fetch(`http://127.0.0.1:${s.port}/mcp`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(data ? data.slice(6) : body);
}

/** A tool's answer: its text, and whether the call itself failed. */
async function call(s: Served, name: string, args: object = {}): Promise<{ text: string; isError: boolean }> {
  const { result, error } = await rpc(s, "tools/call", { name, arguments: args });
  assert.equal(error, undefined, JSON.stringify(error));
  return { text: result.content.map((c: { text: string }) => c.text).join("\n"), isError: result.isError === true };
}

// Node's fetch replaces a Host header with the real one, so these go through http.request.
function raw(port: number, method: string, headers: Record<string, string>, body = ""): Promise<{ status: number; body: string; type?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/mcp", method, headers, setHost: !headers.Host }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text, type: res.headers["content-type"] }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("initialize tells the model to read the guide before it writes, and to validate after", async (t) => {
  const s = await serve(t);
  const { result } = await rpc(s, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(result.serverInfo.name, "ordo");
  assert.match(result.instructions, /call ordo_guide/);
  assert.match(result.instructions, /validate_ordo/);
});

test("tools/list: ordo_guide and validate_ordo, both read-only; list_shapes is gone", async (t) => {
  const s = await serve(t);
  const { result } = await rpc(s, "tools/list");
  const tools = result.tools as { name: string; description: string; annotations: { readOnlyHint?: boolean } }[];
  assert.deepEqual(tools.map((x) => x.name), ["ordo_guide", "validate_ordo"]);
  for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, true, tool.name);
  assert.match(tools[0].description, /^Call this before you write or edit an Ordo diagram/);
});

test("ordo_guide with no topic is the core page: every leaf kind, shape, route, line and marker, and the topic menu", async (t) => {
  const s = await serve(t);
  const { text, isError } = await call(s, "ordo_guide");
  assert.equal(isError, false);
  assert.doesNotMatch(text, /\{\{list:/);
  for (const word of [...LEAF_KINDS, ...SHAPE_KEYS, ...EDGE_ROUTES, ...LINES, ...MARKERS]) assert.ok(text.includes(`\`${word}\``), word);
  for (const topic of GUIDE_TOPICS) assert.ok(text.includes(`- \`${topic}\`:`), topic);
  assert.deepEqual(await call(s, "ordo_guide", { topic: "core" }), { text, isError: false });
});

test("ordo_guide serves each topic as a page of its own; an unknown topic is refused", async (t) => {
  const s = await serve(t);
  const core = (await call(s, "ordo_guide")).text;
  for (const topic of GUIDE_TOPICS) {
    const { text, isError } = await call(s, "ordo_guide", { topic });
    assert.equal(isError, false, topic);
    assert.match(text, /^# /, topic);
    assert.notEqual(text, core, topic);
  }
  const wrong = await call(s, "ordo_guide", { topic: "flowchart" });
  assert.equal(wrong.isError, true);
  assert.match(wrong.text, /sequence/);
});

test("validate_ordo by text: a valid diagram says what it holds", async (t) => {
  const s = await serve(t);
  const { text, isError } = await call(s, "validate_ordo", { text: VALID });
  assert.equal(isError, false);
  assert.equal(text, "The diagram is valid: 3 nodes (1 group), 1 edge; no layout yet: Ordo lays it out when the diagram opens.");
});

test("validate_ordo lists every problem in one pass, at line and column, with the nearest match and the guide's page", async (t) => {
  const s = await serve(t);
  const { text, isError } = await call(s, "validate_ordo", { text: BROKEN });
  assert.equal(isError, false); // the diagram has problems; the call did not
  assert.equal(
    text,
    [
      "The diagram has 3 errors, 1 warning.",
      '4:28 error: edge "e1" to "c" is not a node',
      '7:17 error: unknown shape "cylnder"; did you mean "cyl"? (see ordo_guide)',
      '9:17 error: data.edges.e1.line: must be one of solid, dotted, dashed, thick, not "dashd"; did you mean "dashed"?',
      '13:3 warning: layout for unknown node "ghost" (see ordo_guide topic "editing")',
      "",
      "Fix every error and check again. A warning doesn't stop the diagram opening, but read each one.",
    ].join("\n"),
  );
});

test("validate_ordo by path, absolute or relative to the workspace root, reads the diagram from disk", async (t) => {
  const s = await serve(t);
  const relative = await call(s, "validate_ordo", { path: "demo/.ordo/main/ordo.yaml" });
  assert.equal(relative.isError, false);
  assert.match(relative.text, /^demo\/\.ordo\/main\/ordo\.yaml is valid: 3 nodes/);
  const absolute = path.join(s.root, "demo", ".ordo", "broken", "ordo.yaml");
  const broken = await call(s, "validate_ordo", { path: absolute });
  assert.equal(broken.isError, false);
  assert.ok(broken.text.startsWith(`${absolute} has 3 errors, 1 warning.`), broken.text);

  // a layout with a node it doesn't have yet: the agent is told Ordo will place it
  await fs.writeFile(path.join(s.root, "demo", ".ordo", "main", "ordo.yaml"), `${VALID}---\nordo-layout: 1\nnodes:\n  g: { x: 0, y: 0, w: 200, h: 120 }\n  a: { x: 24, y: 56 }\n`);
  assert.match((await call(s, "validate_ordo", { path: "demo/.ordo/main/ordo.yaml" })).text, /1 node without a position yet: Ordo places it/);
});

test("validate_ordo refuses what it can't check, as a failed call with a sentence", async (t) => {
  const s = await serve(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ordo-mcp-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.mkdir(path.join(outside, ".ordo", "x"), { recursive: true });
  await fs.writeFile(path.join(outside, ".ordo", "x", "ordo.yaml"), VALID);
  // a .ordo that is a link out of the repo, as a committed symlink could be
  await fs.mkdir(path.join(s.root, "linked"));
  await fs.symlink(path.join(outside, ".ordo"), path.join(s.root, "linked", ".ordo"));

  const refused: [object, RegExp][] = [
    [{}, /^Pass path/],
    [{ path: "demo/.ordo/main/ordo.yaml", text: VALID }, /not both/],
    [{ path: "demo/README.md" }, /is not a diagram file/],
    [{ path: "demo/.ordo/main/layout.yaml" }, /is not a diagram file/],
    [{ path: path.join(outside, ".ordo", "x", "ordo.yaml") }, /outside the Ordo workspace/],
    [{ path: "demo/.ordo/nope/ordo.yaml" }, /no diagram called "nope"/],
    [{ path: "nope/.ordo/main/ordo.yaml" }, /no folder nope/],
    [{ path: "../demo/.ordo/main/ordo.yaml" }, /may not contain \.\./],
    [{ path: "linked/.ordo/x/ordo.yaml" }, /symbolic link/],
  ];
  for (const [args, message] of refused) {
    const { text, isError } = await call(s, "validate_ordo", args);
    assert.equal(isError, true, JSON.stringify(args));
    assert.match(text, message, JSON.stringify(args));
    assert.doesNotMatch(text, new RegExp(s.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the root's real path stays on the server");
  }
});

test("only local clients: Host and Origin are checked, GET is 405, and bad JSON answers in JSON-RPC", async (t) => {
  const s = await serve(t);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const ok = await raw(s.port, "POST", { ...HEADERS, Host: `localhost:${s.port}` }, body);
  assert.equal(ok.status, 200);
  assert.equal((await raw(s.port, "POST", { ...HEADERS, Host: "evil.example" }, body)).status, 403);
  assert.equal((await raw(s.port, "POST", { ...HEADERS, Origin: "https://evil.example" }, body)).status, 403);
  assert.equal((await raw(s.port, "GET", { Accept: "text/event-stream" })).status, 405);

  const bad = await raw(s.port, "POST", HEADERS, "{ not json");
  assert.equal(bad.status, 400);
  assert.match(bad.type ?? "", /^application\/json/);
  assert.equal(JSON.parse(bad.body).error.code, -32700);
});
