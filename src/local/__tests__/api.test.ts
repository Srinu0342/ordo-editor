// The API client against a stubbed fetch: what it sends, and which statuses
// come back as answers rather than errors.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createDiagram, listDiagrams, readDiagramFile, writeDiagramFile } from "../api.ts";

type Call = { url: string; init?: RequestInit };

function stubFetch(t: TestContext, reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const had = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return reply(call);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = had;
  });
  return calls;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("a diagram is addressed by its tab in the path and its repo in the query", async (t) => {
  const calls = stubFetch(t, () => new Response("ordo: 1\n", { status: 200, headers: { ETag: '"abc"' } }));
  const file = await readDiagramFile("code/payments api", "auth flow/x");
  assert.deepEqual(file, { text: "ordo: 1\n", etag: '"abc"' });
  assert.equal(calls[0].url, "/api/diagrams/auth%20flow%2Fx?repo=code%2Fpayments+api");
});

test("a read of a diagram that is not there is null; other failures throw with the server's sentence", async (t) => {
  let status = 404;
  stubFetch(t, () => json(status, { error: "No such repo." }));
  assert.equal(await readDiagramFile("r", "gone"), null);
  status = 403;
  await assert.rejects(readDiagramFile("r", "x"), (e: unknown) => e instanceof ApiError && e.status === 403 && e.message === "No such repo.");
  await assert.rejects(listDiagrams("r"), ApiError);
});

test("a write sends YAML with its precondition, and 412 and 422 come back as answers", async (t) => {
  const replies = [
    json(200, { etag: '"b"' }, { ETag: '"b"' }),
    json(412, { error: "changed" }),
    json(422, { error: "invalid", diagnostics: [{ severity: "error", code: "schema", message: "m", file: "ordo" }] }),
  ];
  const calls = stubFetch(t, () => replies.shift()!);

  assert.deepEqual(await writeDiagramFile("r", "t", "x", { ifMatch: '"a"' }), { ok: true, etag: '"b"' });
  const headers = calls[0].init!.headers as Record<string, string>;
  assert.equal(calls[0].init!.method, "PUT");
  assert.equal(headers["Content-Type"], "application/yaml");
  assert.equal(headers["If-Match"], '"a"');

  assert.deepEqual(await writeDiagramFile("r", "t", "x", { ifNoneMatch: "*" }), { ok: false, status: 412 });
  assert.equal((calls[1].init!.headers as Record<string, string>)["If-None-Match"], "*");

  const invalid = await writeDiagramFile("r", "t", "x", { ifMatch: '"a"' });
  assert.equal(invalid.ok, false);
  assert.equal(!invalid.ok && invalid.status === 422 && invalid.diagnostics.length, 1);
});

test("create posts the name as JSON and throws the server's reason on 409", async (t) => {
  const replies = [json(201, { text: "ordo: 1\n", etag: '"e"' }, { ETag: '"e"' }), json(409, { error: "A diagram called auth already exists." })];
  const calls = stubFetch(t, () => replies.shift()!);
  assert.deepEqual(await createDiagram("r", "auth"), { text: "ordo: 1\n", etag: '"e"' });
  assert.equal(calls[0].init!.body, JSON.stringify({ name: "auth" }));
  await assert.rejects(createDiagram("r", "Auth"), /already exists/);
});
