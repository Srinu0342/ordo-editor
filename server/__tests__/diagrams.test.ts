// The .ordo store: which folders count as diagrams and in what order, how a
// new one is created, the compare-and-swap rules a write must pass (412 for a
// stale or missing file, 422 for invalid YAML), CRLF kept, atomic replacement,
// and that no symlink inside .ordo is ever followed.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DIAGRAM_FILE,
  EMPTY_DIAGRAM,
  ORDO_DIR,
  createDiagram,
  etagOf,
  listDiagrams,
  readDiagramFile,
  writeDiagramFile,
} from "../diagrams.ts";
import { HttpError } from "../workspace.ts";
import { readDiagram } from "../../src/ordo/index.ts";

// Two boxes and an edge: the smallest diagram that is more than empty.
const DIAGRAM = "ordo: 1\nnodes:\n  - a\n  - b\nedges:\n  - { id: e1, from: a, to: b }\n---\nordo-layout: 1\n";
const OTHER = "ordo: 1\nnodes:\n  - a\n---\nordo-layout: 1\n";
const INVALID = "ordo: 1\nnodes: [\n";

// A fresh repo folder per test, real-pathed the way resolveInRoot hands it over.
async function tempRepo(t: TestContext): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ordo-repo-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const sha = (text: string) => `"${createHash("sha256").update(text, "utf8").digest("hex")}"`;
const fileOf = (repo: string, tab: string) => path.join(repo, ORDO_DIR, tab, DIAGRAM_FILE);
const readText = (repo: string, tab: string) => fs.readFile(fileOf(repo, tab), "utf8");
const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

// Write .ordo/<tab>/ordo.yaml directly, as a git checkout or an agent would.
async function put(repo: string, tab: string, text: string) {
  await fs.mkdir(path.join(repo, ORDO_DIR, tab), { recursive: true });
  await fs.writeFile(fileOf(repo, tab), text);
}

async function refuses(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof HttpError, String(e));
    assert.equal(e.status, status, e.message);
    return true;
  });
}

test("EMPTY_DIAGRAM is what an empty canvas exports, and it reads back cleanly", () => {
  assert.equal(EMPTY_DIAGRAM, "ordo: 1\nnodes: []\n---\nordo-layout: 1\n");
  assert.equal(readDiagram(EMPTY_DIAGRAM).ok, true);
});

test("the ETag is the quoted SHA-256 of the bytes", () => {
  assert.equal(etagOf(DIAGRAM), sha(DIAGRAM));
  assert.equal(etagOf(Buffer.from(DIAGRAM)), sha(DIAGRAM));
  assert.match(etagOf(""), /^"[0-9a-f]{64}"$/);
});

// --- listDiagrams -------------------------------------------------------------

test("listDiagrams: no .ordo is an empty list, and listing creates nothing", async (t) => {
  const repo = await tempRepo(t);
  assert.deepEqual(await listDiagrams(repo), []);
  assert.equal(await exists(path.join(repo, ORDO_DIR)), false);
});

test("listDiagrams: real folders holding a regular ordo.yaml, A–Z", async (t) => {
  const repo = await tempRepo(t);
  for (const tab of ["b", "A", "a10", "a2", "auth flow"]) await put(repo, tab, DIAGRAM);
  const ordo = path.join(repo, ORDO_DIR);
  await fs.mkdir(path.join(ordo, "empty"));
  await fs.mkdir(path.join(ordo, "dir-not-file", DIAGRAM_FILE), { recursive: true });
  await fs.symlink(path.join(ordo, "b"), path.join(ordo, "linked-folder"));
  await fs.mkdir(path.join(ordo, "linked-file"));
  await fs.symlink(fileOf(repo, "b"), path.join(ordo, "linked-file", DIAGRAM_FILE));
  await fs.writeFile(path.join(ordo, "loose.yaml"), DIAGRAM);
  await fs.writeFile(path.join(ordo, ".DS_Store"), "");
  assert.deepEqual(await listDiagrams(repo), ["A", "a2", "a10", "auth flow", "b"]);
});

test("listDiagrams: .ordo as a file means no diagrams", async (t) => {
  const repo = await tempRepo(t);
  await fs.writeFile(path.join(repo, ORDO_DIR), "");
  assert.deepEqual(await listDiagrams(repo), []);
});

// --- createDiagram ------------------------------------------------------------

test("createDiagram creates .ordo and the folder, and writes EMPTY_DIAGRAM", async (t) => {
  const repo = await tempRepo(t);
  const created = await createDiagram(repo, "billing");
  assert.deepEqual(created, { text: EMPTY_DIAGRAM, etag: sha(EMPTY_DIAGRAM) });
  assert.equal(await readText(repo, "billing"), EMPTY_DIAGRAM);
  assert.deepEqual(await listDiagrams(repo), ["billing"]);
  // And it reads back with the same ETag.
  assert.deepEqual(await readDiagramFile(repo, "billing"), created);
});

test("createDiagram: an existing diagram, in any case, is 409 and untouched", async (t) => {
  const repo = await tempRepo(t);
  await put(repo, "auth", DIAGRAM);
  await refuses(createDiagram(repo, "auth"), 409);
  await refuses(createDiagram(repo, "AUTH"), 409);
  assert.equal(await readText(repo, "auth"), DIAGRAM);
});

test("createDiagram: an invalid name is 400 and creates nothing", async (t) => {
  const repo = await tempRepo(t);
  for (const name of ["", "con", "lpt1.yaml", "a/b", "../x", "x.", " x"]) await refuses(createDiagram(repo, name), 400);
  assert.equal(await exists(path.join(repo, ORDO_DIR)), false);
});

test("createDiagram reuses a folder spelled exactly like the name that holds no ordo.yaml", async (t) => {
  const repo = await tempRepo(t);
  await fs.mkdir(path.join(repo, ORDO_DIR, "billing", "notes"), { recursive: true });
  await createDiagram(repo, "billing");
  assert.equal(await readText(repo, "billing"), EMPTY_DIAGRAM);
  assert.equal(await exists(path.join(repo, ORDO_DIR, "billing", "notes")), true);
});

test("createDiagram refuses a folder that differs from the name only in case", async (t) => {
  const repo = await tempRepo(t);
  await fs.mkdir(path.join(repo, ORDO_DIR, "Billing"), { recursive: true });
  await refuses(createDiagram(repo, "billing"), 409);
  assert.deepEqual(await fs.readdir(path.join(repo, ORDO_DIR, "Billing")), []);
});

test("createDiagram: a file where .ordo or the tab folder should be is 409", async (t) => {
  const repo = await tempRepo(t);
  await fs.writeFile(path.join(repo, ORDO_DIR), "");
  await refuses(createDiagram(repo, "billing"), 409);

  const repo2 = await tempRepo(t);
  await fs.mkdir(path.join(repo2, ORDO_DIR));
  await fs.writeFile(path.join(repo2, ORDO_DIR, "billing"), "");
  await refuses(createDiagram(repo2, "billing"), 409);
});

// --- readDiagramFile ----------------------------------------------------------

test("readDiagramFile gives the file's text and ETag", async (t) => {
  const repo = await tempRepo(t);
  await put(repo, "auth flow", DIAGRAM);
  assert.deepEqual(await readDiagramFile(repo, "auth flow"), { text: DIAGRAM, etag: sha(DIAGRAM) });
});

test("readDiagramFile: a missing diagram is 404", async (t) => {
  const repo = await tempRepo(t);
  await refuses(readDiagramFile(repo, "auth"), 404); // no .ordo at all
  await put(repo, "auth", DIAGRAM);
  await fs.mkdir(path.join(repo, ORDO_DIR, "empty"));
  await refuses(readDiagramFile(repo, "billing"), 404);
  await refuses(readDiagramFile(repo, "empty"), 404);
  // Exact match only: the folder is "auth".
  await refuses(readDiagramFile(repo, "Auth"), 404);
});

test("readDiagramFile: tab is matched against folder names, never joined into a path", async (t) => {
  const repo = await tempRepo(t);
  await put(repo, "auth", DIAGRAM);
  // .ordo/../../ordo.yaml is the repo's parent's ordo.yaml, and .ordo/../ordo.yaml
  // the repo's own: plant both, valid, where a joined path would find them.
  const inner = path.join(repo, "inner");
  await fs.mkdir(path.join(inner, ORDO_DIR), { recursive: true });
  await fs.writeFile(path.join(repo, DIAGRAM_FILE), DIAGRAM);
  await fs.writeFile(path.join(inner, DIAGRAM_FILE), DIAGRAM);
  for (const tab of ["../..", "..", ".", "", "auth/../auth", "auth/"]) await refuses(readDiagramFile(inner, tab), 404);
  await refuses(readDiagramFile(repo, ".."), 404);
});

// --- writeDiagramFile ---------------------------------------------------------

test("an If-Match write with the current ETag lands, and returns the new ETag", async (t) => {
  const repo = await tempRepo(t);
  const { etag } = await createDiagram(repo, "auth");
  const written = await writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: etag });
  assert.deepEqual(written, { etag: sha(DIAGRAM) });
  assert.notEqual(written.etag, etag);
  assert.deepEqual(await readDiagramFile(repo, "auth"), { text: DIAGRAM, etag: written.etag });
});

test("a stale If-Match is 412 and the file is untouched", async (t) => {
  const repo = await tempRepo(t);
  const { etag: old } = await createDiagram(repo, "auth");
  await writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: old });
  await refuses(writeDiagramFile(repo, "auth", OTHER, { ifMatch: old }), 412);
  await refuses(writeDiagramFile(repo, "auth", OTHER, { ifMatch: '"nonsense"' }), 412);
  assert.equal(await readText(repo, "auth"), DIAGRAM);
});

test("If-Match on a deleted file, folder or .ordo is 412, and nothing is recreated", async (t) => {
  const repo = await tempRepo(t);
  const { etag } = await createDiagram(repo, "auth");
  await fs.rm(fileOf(repo, "auth"));
  await refuses(writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: etag }), 412);
  assert.equal(await exists(fileOf(repo, "auth")), false);

  await fs.rm(path.join(repo, ORDO_DIR, "auth"), { recursive: true });
  await refuses(writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: etag }), 412);
  await fs.rm(path.join(repo, ORDO_DIR), { recursive: true });
  await refuses(writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: etag }), 412);
  assert.equal(await exists(path.join(repo, ORDO_DIR)), false);
});

test("If-Match never climbs out of .ordo, whatever the tab says", async (t) => {
  const repo = await tempRepo(t);
  const inner = path.join(repo, "inner");
  await fs.mkdir(path.join(inner, ORDO_DIR), { recursive: true });
  await fs.writeFile(path.join(repo, DIAGRAM_FILE), DIAGRAM);
  await refuses(writeDiagramFile(inner, "../..", OTHER, { ifMatch: sha(DIAGRAM) }), 412);
  assert.equal(await fs.readFile(path.join(repo, DIAGRAM_FILE), "utf8"), DIAGRAM);
});

test("If-None-Match: * over an existing file is 412", async (t) => {
  const repo = await tempRepo(t);
  await createDiagram(repo, "auth");
  await refuses(writeDiagramFile(repo, "auth", DIAGRAM, { ifNoneMatch: "*" }), 412);
  assert.equal(await readText(repo, "auth"), EMPTY_DIAGRAM);
});

test("a recreate after git removed the folder, or all of .ordo, succeeds", async (t) => {
  const repo = await tempRepo(t);
  await createDiagram(repo, "auth");
  await createDiagram(repo, "billing");
  // `git rm` takes the emptied folder with the file.
  await fs.rm(path.join(repo, ORDO_DIR, "auth"), { recursive: true });
  assert.deepEqual(await writeDiagramFile(repo, "auth", DIAGRAM, { ifNoneMatch: "*" }), { etag: sha(DIAGRAM) });
  assert.equal(await readText(repo, "auth"), DIAGRAM);

  await fs.rm(path.join(repo, ORDO_DIR), { recursive: true });
  await writeDiagramFile(repo, "billing", OTHER, { ifNoneMatch: "*" });
  assert.deepEqual(await listDiagrams(repo), ["billing"]);
});

test("a recreate keeps a hand-made name that checkDiagramName would not create", async (t) => {
  const repo = await tempRepo(t);
  await writeDiagramFile(repo, "café flow", DIAGRAM, { ifNoneMatch: "*" });
  assert.deepEqual(await listDiagrams(repo), ["café flow"]);
});

test("a recreate under a name that isn't one safe folder name is 400 and creates nothing", async (t) => {
  const repo = await tempRepo(t);
  for (const tab of ["..", ".", "", "a/b", "../x", "a\\b", "a\0b"])
    await refuses(writeDiagramFile(repo, tab, DIAGRAM, { ifNoneMatch: "*" }), 400);
  assert.equal(await exists(path.join(repo, ORDO_DIR)), false);
  assert.deepEqual(await fs.readdir(repo), []);
});

test("invalid YAML is 422 with diagnostics, and nothing is written or created", async (t) => {
  const repo = await tempRepo(t);
  const { etag } = await createDiagram(repo, "auth");
  await assert.rejects(writeDiagramFile(repo, "auth", INVALID, { ifMatch: etag }), (e: unknown) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 422);
    const { diagnostics } = e.body as { diagnostics: { severity: string; line?: number }[] };
    assert.ok(diagnostics.length > 0);
    assert.equal(diagnostics[0].severity, "error");
    assert.equal(typeof diagnostics[0].line, "number");
    return true;
  });
  assert.equal(await readText(repo, "auth"), EMPTY_DIAGRAM);
  await refuses(writeDiagramFile(repo, "auth", "hello: world\n", { ifMatch: etag }), 422);

  // A recreate that fails validation leaves no empty folder behind.
  await refuses(writeDiagramFile(repo, "gone", INVALID, { ifNoneMatch: "*" }), 422);
  assert.equal(await exists(path.join(repo, ORDO_DIR, "gone")), false);
  // And no temp file anywhere.
  assert.deepEqual(await fs.readdir(path.join(repo, ORDO_DIR, "auth")), [DIAGRAM_FILE]);
});

test("a file with CRLF line endings keeps them", async (t) => {
  const repo = await tempRepo(t);
  const crlf = (s: string) => s.replace(/\n/g, "\r\n");
  await put(repo, "auth", crlf(EMPTY_DIAGRAM));
  const { etag } = await readDiagramFile(repo, "auth");
  assert.equal(etag, sha(crlf(EMPTY_DIAGRAM)));

  const written = await writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: etag });
  const disk = await readText(repo, "auth");
  assert.equal(disk, crlf(DIAGRAM));
  assert.equal(written.etag, sha(crlf(DIAGRAM)));
  // Text that already has CRLF isn't doubled.
  await writeDiagramFile(repo, "auth", crlf(OTHER), { ifMatch: written.etag });
  assert.equal(await readText(repo, "auth"), crlf(OTHER));

  // An LF file stays LF.
  await put(repo, "lf", EMPTY_DIAGRAM);
  await writeDiagramFile(repo, "lf", DIAGRAM, { ifMatch: sha(EMPTY_DIAGRAM) });
  assert.equal(await readText(repo, "lf"), DIAGRAM);
});

test("a failed rename leaves the old file intact and no temp file behind", async (t) => {
  const repo = await tempRepo(t);
  const { etag } = await createDiagram(repo, "auth");
  t.mock.method(fs, "rename", async () => {
    throw Object.assign(new Error("disk on fire"), { code: "EIO" });
  });
  await assert.rejects(writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: etag }), /disk on fire/);
  t.mock.restoreAll();
  assert.equal(await readText(repo, "auth"), EMPTY_DIAGRAM);
  assert.deepEqual(await fs.readdir(path.join(repo, ORDO_DIR, "auth")), [DIAGRAM_FILE]);
  // The lock was released: the next write goes through.
  await writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: etag });
  assert.equal(await readText(repo, "auth"), DIAGRAM);
});

test("two writes from one ETag: exactly one lands, the other is 412", async (t) => {
  const repo = await tempRepo(t);
  const { etag } = await createDiagram(repo, "auth");
  const results = await Promise.allSettled([
    writeDiagramFile(repo, "auth", DIAGRAM, { ifMatch: etag }),
    writeDiagramFile(repo, "auth", OTHER, { ifMatch: etag }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["fulfilled", "rejected"],
  );
  assert.equal((results[1] as PromiseRejectedResult).reason.status, 412);
  assert.equal(await readText(repo, "auth"), DIAGRAM);
});

// --- symlinks -----------------------------------------------------------------

test("a symlinked .ordo is 403 for every operation", async (t) => {
  const repo = await tempRepo(t);
  const elsewhere = await tempRepo(t);
  await put(elsewhere, "auth", DIAGRAM);
  await fs.symlink(path.join(elsewhere, ORDO_DIR), path.join(repo, ORDO_DIR));
  await refuses(listDiagrams(repo), 403);
  await refuses(readDiagramFile(repo, "auth"), 403);
  await refuses(createDiagram(repo, "billing"), 403);
  await refuses(writeDiagramFile(repo, "auth", OTHER, { ifMatch: sha(DIAGRAM) }), 403);
  await refuses(writeDiagramFile(repo, "billing", OTHER, { ifNoneMatch: "*" }), 403);
  assert.deepEqual(await fs.readdir(path.join(elsewhere, ORDO_DIR)), ["auth"]);
  assert.equal(await readText(elsewhere, "auth"), DIAGRAM);
});

test("a symlinked tab folder is 403 for read, write, recreate and create", async (t) => {
  const repo = await tempRepo(t);
  const elsewhere = await tempRepo(t);
  await fs.writeFile(path.join(elsewhere, DIAGRAM_FILE), DIAGRAM);
  await fs.mkdir(path.join(repo, ORDO_DIR));
  await fs.symlink(elsewhere, path.join(repo, ORDO_DIR, "auth"));
  await fs.symlink(path.join(repo, "nowhere"), path.join(repo, ORDO_DIR, "billing")); // dangling
  await refuses(readDiagramFile(repo, "auth"), 403);
  await refuses(writeDiagramFile(repo, "auth", OTHER, { ifMatch: sha(DIAGRAM) }), 403);
  await refuses(writeDiagramFile(repo, "auth", OTHER, { ifNoneMatch: "*" }), 403);
  await refuses(writeDiagramFile(repo, "billing", OTHER, { ifNoneMatch: "*" }), 403);
  await refuses(createDiagram(repo, "billing"), 403);
  assert.equal(await fs.readFile(path.join(elsewhere, DIAGRAM_FILE), "utf8"), DIAGRAM);
  assert.equal(await exists(path.join(repo, "nowhere")), false);
});

test("a symlinked ordo.yaml is 403 to read or write, and not overwritten by a recreate", async (t) => {
  const repo = await tempRepo(t);
  const target = path.join(repo, "target.yaml");
  await fs.writeFile(target, DIAGRAM);
  await fs.mkdir(path.join(repo, ORDO_DIR, "auth"), { recursive: true });
  await fs.symlink(target, fileOf(repo, "auth"));
  await refuses(readDiagramFile(repo, "auth"), 403);
  await refuses(writeDiagramFile(repo, "auth", OTHER, { ifMatch: sha(DIAGRAM) }), 403);
  await refuses(writeDiagramFile(repo, "auth", OTHER, { ifNoneMatch: "*" }), 412);
  await refuses(createDiagram(repo, "auth"), 409);
  assert.equal(await fs.readFile(target, "utf8"), DIAGRAM);
  assert.equal((await fs.lstat(fileOf(repo, "auth"))).isSymbolicLink(), true);
});
