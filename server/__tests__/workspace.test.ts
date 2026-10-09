// The workspace root and its path rules: how the root is opened and labelled,
// every text a relative path is refused for, that real paths (symlinks
// followed) must stay inside the root, and what the folder picker lists.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FOLDER_LIMIT, HttpError, listFolders, openWorkspace, parseRel, resolveInRoot } from "../workspace.ts";
import type { Workspace } from "../workspace.ts";

// A fresh root per test. mkdtemp's path is left as it is (on macOS it sits
// under the /var → /private/var symlink), so openWorkspace's realpath is
// exercised every time.
async function tempRoot(t: TestContext): Promise<{ given: string; ws: Workspace }> {
  const given = await fs.mkdtemp(path.join(os.tmpdir(), "ordo-ws-"));
  t.after(() => fs.rm(given, { recursive: true, force: true }));
  return { given, ws: await openWorkspace({ ORDO_WORKSPACE: given }) };
}

const dirs = (root: string, ...rels: string[]) =>
  Promise.all(rels.map((r) => fs.mkdir(path.join(root, r), { recursive: true })));

// Rejects with an HttpError of this status.
async function refuses(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === status);
}

// --- openWorkspace ------------------------------------------------------------

test("the root is real-pathed and labelled by its base name", async (t) => {
  const { given, ws } = await tempRoot(t);
  assert.equal(ws.root, await fs.realpath(given));
  assert.equal(ws.label, path.basename(given));
});

test("the home folder is the default root, labelled ~", async () => {
  const ws = await openWorkspace({});
  assert.equal(ws.root, await fs.realpath(os.homedir()));
  assert.equal(ws.label, "~");
  // Named explicitly, it is still ~.
  assert.equal((await openWorkspace({ ORDO_WORKSPACE: os.homedir() })).label, "~");
  // An empty ORDO_WORKSPACE counts as unset, not as the current directory.
  assert.equal((await openWorkspace({ ORDO_WORKSPACE: "" })).label, "~");
});

test("a leading ~ is the home folder, as a .env file writes it", async () => {
  const home = await fs.realpath(os.homedir());
  assert.equal((await openWorkspace({ ORDO_WORKSPACE: "~" })).root, home);
  const missing = "~/ordo-no-such-folder-" + process.pid;
  await assert.rejects(openWorkspace({ ORDO_WORKSPACE: missing }), (e: Error) =>
    e.message.includes(path.join(os.homedir(), missing.slice(2))),
  );
  // ~ inside a path, or ~user, is just a name
  await assert.rejects(openWorkspace({ ORDO_WORKSPACE: "~other/x" }), (e: Error) => e.message.includes(path.resolve("~other/x")));
});

test("a root that is missing or a file is refused with a message naming it", async (t) => {
  const { ws } = await tempRoot(t);
  const missing = path.join(ws.root, "nope");
  const file = path.join(ws.root, "file.txt");
  await fs.writeFile(file, "x");
  await assert.rejects(openWorkspace({ ORDO_WORKSPACE: missing }), (e: Error) => e.message.includes(missing));
  await assert.rejects(openWorkspace({ ORDO_WORKSPACE: file }), (e: Error) => e.message.includes("not a folder"));
});

// --- parseRel -----------------------------------------------------------------

test("parseRel: empty or . is the root, otherwise /-separated segments", () => {
  assert.deepEqual(parseRel(""), []);
  assert.deepEqual(parseRel("."), []);
  assert.deepEqual(parseRel("code"), ["code"]);
  assert.deepEqual(parseRel("code/payments api/x.y"), ["code", "payments api", "x.y"]);
  assert.deepEqual(parseRel("a..b/.ordo"), ["a..b", ".ordo"]);
});

test("parseRel refuses every form that could climb, jump or confuse", () => {
  const refused: [string, unknown][] = [
    ["a repeated parameter (an array)", ["a", "b"]],
    ["a missing parameter", undefined],
    ["a number", 7],
    ["more than 1,024 characters", "a/".repeat(512) + "a"],
    ["a NUL byte", "a\0b"],
    ["a backslash", "a\\b"],
    ["a leading /", "/etc"],
    ["a drive letter", "C:/x"],
    ["a bare drive letter", "c:"],
    ["..", ".."],
    ["a .. segment", "a/../b"],
    ["a leading ..", "../x"],
    ["a . segment", "./a"],
    ["an inner . segment", "a/./b"],
    ["a doubled /", "a//b"],
    ["a trailing /", "a/"],
  ];
  for (const [why, rel] of refused)
    assert.throws(() => parseRel(rel), (e: unknown) => e instanceof HttpError && e.status === 400, why);
});

test("parseRel names the parameter in its message", () => {
  assert.throws(() => parseRel(["a", "b"], "repo"), /^Error: The repo must be given once/);
});

test("parseRel accepts exactly 1,024 characters", () => {
  assert.equal(parseRel("a".repeat(1024)).length, 1);
});

// --- resolveInRoot ------------------------------------------------------------

test("resolveInRoot gives the real path of a folder inside the root", async (t) => {
  const { ws } = await tempRoot(t);
  await dirs(ws.root, "code/api");
  assert.equal(await resolveInRoot(ws, ["code", "api"]), path.join(ws.root, "code", "api"));
  assert.equal(await resolveInRoot(ws, []), ws.root);
});

test("resolveInRoot: 404 for a missing path or a file", async (t) => {
  const { ws } = await tempRoot(t);
  await fs.writeFile(path.join(ws.root, "file.txt"), "x");
  await refuses(resolveInRoot(ws, ["nope"]), 404);
  await refuses(resolveInRoot(ws, ["file.txt"]), 404);
});

test("resolveInRoot: .. reached through a symlink is 403", async (t) => {
  const { ws } = await tempRoot(t);
  await dirs(ws.root, "code");
  await fs.symlink("..", path.join(ws.root, "code", "up"));
  // code/up is the root itself: fine. code/up/.. is the root's parent: outside.
  assert.equal(await resolveInRoot(ws, ["code", "up"]), ws.root);
  await fs.symlink("../..", path.join(ws.root, "code", "out"));
  await refuses(resolveInRoot(ws, ["code", "out"]), 403);
});

test("resolveInRoot: a symlink to a folder outside the root is 403; one inside is followed", async (t) => {
  const { ws } = await tempRoot(t);
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ordo-outside-")));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await dirs(ws.root, "real");
  await fs.symlink(outside, path.join(ws.root, "escape"));
  await fs.symlink(path.join(ws.root, "real"), path.join(ws.root, "alias"));
  await refuses(resolveInRoot(ws, ["escape"]), 403);
  assert.equal(await resolveInRoot(ws, ["alias"]), path.join(ws.root, "real"));
});

test("resolveInRoot: a root whose name is a prefix of a sibling's does not contain the sibling", async (t) => {
  // /tmp/x/root and /tmp/x/root-other: startsWith(root) alone would let this through.
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ordo-prefix-")));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await dirs(base, "root", "root-other");
  await fs.symlink(path.join(base, "root-other"), path.join(base, "root", "sib"));
  const ws = await openWorkspace({ ORDO_WORKSPACE: path.join(base, "root") });
  await refuses(resolveInRoot(ws, ["sib"]), 403);
});

// --- listFolders --------------------------------------------------------------

test("listFolders: subfolders only, dot-folders hidden, A–Z numeric and case-insensitive", async (t) => {
  const { ws } = await tempRoot(t);
  await dirs(ws.root, "b", "A", "a10", "a2", ".hidden", ".git", "node10", "Node9");
  await fs.writeFile(path.join(ws.root, "file.txt"), "x");
  const { path: at, folders, truncated } = await listFolders(ws, "");
  assert.equal(at, "");
  assert.equal(truncated, false);
  assert.deepEqual(
    folders.map((f) => f.name),
    ["A", "a2", "a10", "b", "Node9", "node10"],
  );
});

test("listFolders: git is any .git, ordo only a real .ordo folder", async (t) => {
  const { ws } = await tempRoot(t);
  await dirs(ws.root, "repo/.git", "worktree", "plain", "drawn/.ordo", "fake/.ordo-target", "both/.git", "both/.ordo");
  // A worktree's .git is a file pointing at the main repo.
  await fs.writeFile(path.join(ws.root, "worktree", ".git"), "gitdir: ../repo/.git/worktrees/w\n");
  await fs.symlink(path.join(ws.root, "fake", ".ordo-target"), path.join(ws.root, "fake", ".ordo"));
  const { folders } = await listFolders(ws, "");
  assert.deepEqual(folders, [
    { name: "both", git: true, ordo: true },
    { name: "drawn", git: false, ordo: true },
    { name: "fake", git: false, ordo: false },
    { name: "plain", git: false, ordo: false },
    { name: "repo", git: true, ordo: false },
    { name: "worktree", git: true, ordo: false },
  ]);
});

test("listFolders: a symlinked folder is listed only when it lands inside the root", async (t) => {
  const { ws } = await tempRoot(t);
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ordo-outside-")));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await dirs(ws.root, "code/api/.git", "projects");
  await fs.symlink(path.join(ws.root, "code", "api"), path.join(ws.root, "projects", "api-link"));
  await fs.symlink(outside, path.join(ws.root, "projects", "escape"));
  await fs.symlink("..", path.join(ws.root, "projects", "up")); // the root itself: inside
  await fs.symlink("../..", path.join(ws.root, "projects", "up2")); // the root's parent: outside
  await fs.symlink(path.join(ws.root, "nowhere"), path.join(ws.root, "projects", "dangling"));
  await fs.writeFile(path.join(ws.root, "f.txt"), "x");
  await fs.symlink(path.join(ws.root, "f.txt"), path.join(ws.root, "projects", "to-file"));

  const { path: at, folders } = await listFolders(ws, "projects");
  assert.equal(at, "projects");
  assert.deepEqual(folders, [
    { name: "api-link", git: true, ordo: false },
    { name: "up", git: false, ordo: false },
  ]);
});

test("listFolders: the path is checked like any other", async (t) => {
  const { ws } = await tempRoot(t);
  await refuses(listFolders(ws, "../x"), 400);
  await refuses(listFolders(ws, ["a", "b"]), 400);
  await refuses(listFolders(ws, "missing"), 404);
  assert.equal((await listFolders(ws, ".")).path, "");
});

test(`listFolders: at most ${FOLDER_LIMIT} folders, and says when it cut the list short`, async (t) => {
  const { ws } = await tempRoot(t);
  await dirs(ws.root, ...Array.from({ length: FOLDER_LIMIT }, (_, i) => `full/d${i}`));
  const full = await listFolders(ws, "full");
  assert.equal(full.folders.length, FOLDER_LIMIT);
  assert.equal(full.truncated, false);

  await dirs(ws.root, `full/d${FOLDER_LIMIT}`);
  const over = await listFolders(ws, "full");
  assert.equal(over.folders.length, FOLDER_LIMIT);
  assert.equal(over.truncated, true);
  // The first FOLDER_LIMIT in A–Z order, numeric: d0 … d999, not d1000.
  assert.equal(over.folders.at(-1)?.name, `d${FOLDER_LIMIT - 1}`);
});

test("listFolders: a folder that can't be read is skipped; listing an unreadable folder is 403", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root reads everything");
  const { ws } = await tempRoot(t);
  await dirs(ws.root, "open", "locked/inner");
  const locked = path.join(ws.root, "locked");
  await fs.chmod(locked, 0o000);
  try {
    assert.deepEqual(
      (await listFolders(ws, "")).folders.map((f) => f.name),
      ["open"],
    );
    await refuses(listFolders(ws, "locked"), 403);
  } finally {
    // Here rather than in t.after, so the root's removal can always get in.
    await fs.chmod(locked, 0o755);
  }
});
