import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The workspace root and the rules for reaching anything under it.
//
// One Ordo process serves every repo below one root folder: the home folder
// for npm, /workspace in Docker, or ORDO_WORKSPACE. The browser only ever
// names places relative to that root, and only the server knows where the
// root is; the label "~" or the root's base name is all that leaves it.
//
// A relative path is checked twice. parseRel looks at the text alone and
// refuses anything that could climb or jump (`..`, a leading `/`, a drive
// letter). resolveInRoot then asks the filesystem where the path really lands,
// symlinks followed, and refuses anything that ends up outside the root.

export type Workspace = { root: string; label: string };
export type Folder = { name: string; git: boolean; ordo: boolean };

/** An error that already knows its HTTP status; the API's error handler sends it as `{ error, ...body }`. */
// Fields declared, not constructor parameter properties: tsconfig sets erasableSyntaxOnly.
export class HttpError extends Error {
  status: number;
  body?: object;
  constructor(status: number, message: string, body?: object) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Every A–Z list Ordo shows: "a2" before "a10", "Auth" next to "auth".
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** A–Z by the shared collation; names equal to it fall back to code-unit order so the result never depends on readdir. */
export function byName(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

// Past this the picker says the list was cut short rather than sending a
// folder of node_modules-sized siblings to the browser.
export const FOLDER_LIMIT = 1000;

const MAX_REL = 1024;

/**
 * Root = realpath(ORDO_WORKSPACE ?? the home folder). Throws when that is not
 * a directory, so the caller decides how to stop; server/index.ts prints the
 * message and exits.
 */
export async function openWorkspace(env: NodeJS.ProcessEnv = process.env): Promise<Workspace> {
  const home = os.homedir();
  // An empty ORDO_WORKSPACE would resolve to the current directory, which is
  // never what someone meant by leaving it blank.
  const given = env.ORDO_WORKSPACE || home;
  // A shell expands ~ before Ordo sees it; a .env file does not, so a leading
  // ~ (alone, or as ~/...) is taken as the home folder here.
  const wanted = path.resolve(given === "~" ? home : given.startsWith("~/") ? path.join(home, given.slice(2)) : given);
  let root: string;
  try {
    // Real-pathed once here, so containment checks compare real path with
    // real path (on macOS the temp folder alone is /var → /private/var).
    root = await fs.realpath(wanted);
  } catch {
    throw new Error(`workspace root ${wanted} does not exist; set ORDO_WORKSPACE to a folder`);
  }
  if (!(await fs.stat(root)).isDirectory())
    throw new Error(`workspace root ${wanted} is not a folder; set ORDO_WORKSPACE to a folder`);

  const realHome = await fs.realpath(home).catch(() => home);
  return { root, label: root === realHome ? "~" : path.basename(root) };
}

/**
 * Syntax only: "" or "." is the root itself, []; anything else must be
 * `/`-separated segments under it. `what` names the parameter in the message.
 * Throws HttpError(400).
 */
export function parseRel(rel: unknown, what = "path"): string[] {
  const bad = (why: string) => new HttpError(400, `The ${what} ${why}.`);
  // A repeated query parameter arrives as an array, a missing one as undefined.
  if (typeof rel !== "string") throw bad("must be given once, as text");
  if (rel.length > MAX_REL) throw bad(`is longer than ${MAX_REL} characters`);
  if (rel.includes("\0")) throw bad("contains a NUL byte");
  if (rel.includes("\\")) throw bad("must use / between folders, not \\");
  if (rel.startsWith("/")) throw bad("must be relative to the workspace, not start with /");
  if (/^[A-Za-z]:/.test(rel)) throw bad("must be relative to the workspace, not start with a drive letter");
  if (rel === "" || rel === ".") return [];
  const segments = rel.split("/");
  for (const s of segments) {
    if (s === "") throw bad("has an empty folder name (a doubled or trailing /)");
    if (s === "." || s === "..") throw bad(`may not contain ${s} as a folder name`);
  }
  return segments;
}

const code = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;
const denied = (e: unknown) => code(e) === "EACCES" || code(e) === "EPERM";

/** True when the real path `real` is the root or below it. */
export function insideRoot(ws: Workspace, real: string): boolean {
  return real === ws.root || real.startsWith(ws.root + path.sep);
}

/**
 * Joins the segments under the root, takes the real path, and requires it to
 * be inside the root and a directory. 403 outside, 404 missing.
 */
export async function resolveInRoot(ws: Workspace, segments: string[]): Promise<string> {
  const shown = segments.join("/") || "the workspace root";
  let real: string;
  try {
    real = await fs.realpath(path.join(ws.root, ...segments));
  } catch (e) {
    if (denied(e)) throw new HttpError(403, `Ordo is not allowed to open ${shown}.`);
    throw new HttpError(404, `There is no folder ${shown} in the workspace.`);
  }
  // A symlink inside the root can still point anywhere; only where it lands counts.
  if (!insideRoot(ws, real)) throw new HttpError(403, `${shown} leads outside the workspace.`);
  const stat = await fs.stat(real).catch(() => null);
  if (!stat?.isDirectory()) throw new HttpError(404, `${shown} is not a folder.`);
  return real;
}

// Whether something exists at `p` in any form, symlink included; null when
// the folder holding it can't be read, which hides that folder.
async function present(p: string): Promise<{ dir: boolean } | false | null> {
  try {
    return { dir: (await fs.lstat(p)).isDirectory() };
  } catch (e) {
    return code(e) === "ENOENT" || code(e) === "ENOTDIR" ? false : null;
  }
}

/**
 * Subfolders only: dot-folders hidden, A–Z (numeric, case-insensitive), at
 * most FOLDER_LIMIT. `rel` is taken as it came in the query and checked by
 * parseRel here.
 */
export async function listFolders(
  ws: Workspace,
  rel: unknown,
): Promise<{ path: string; folders: Folder[]; truncated: boolean }> {
  const segments = parseRel(rel);
  const dir = await resolveInRoot(ws, segments);
  const shown = segments.join("/") || "the workspace root";
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    // macOS privacy controls (Desktop, Documents, Downloads) answer EPERM.
    if (denied(e)) throw new HttpError(403, `Ordo is not allowed to read ${shown}.`);
    throw e;
  }

  // Names are sorted before anything is probed, so a huge folder costs one
  // readdir plus probes for the first FOLDER_LIMIT + 1 listable entries only.
  const candidates = entries
    .filter((d) => !d.name.startsWith(".") && (d.isDirectory() || d.isSymbolicLink()))
    .sort((a, b) => byName(a.name, b.name));

  const probe = async (d: (typeof candidates)[number]): Promise<Folder | null> => {
    let full = path.join(dir, d.name);
    if (d.isSymbolicLink()) {
      // Listed only when it lands on a folder inside the root; the picker
      // must not offer a door that resolveInRoot would then refuse.
      const real = await fs.realpath(full).catch(() => null);
      if (!real || !insideRoot(ws, real)) return null;
      if (!(await fs.stat(real).catch(() => null))?.isDirectory()) return null;
      full = real;
    }
    // A worktree's .git is a file, so any form counts; .ordo must be a real
    // directory, matching what diagrams.ts will accept.
    const git = await present(path.join(full, ".git"));
    const ordo = await present(path.join(full, ".ordo"));
    if (git === null || ordo === null) return null;
    return { name: d.name, git: git !== false, ordo: ordo !== false && ordo.dir };
  };

  const folders: Folder[] = [];
  const BATCH = 64;
  for (let i = 0; i < candidates.length && folders.length <= FOLDER_LIMIT; i += BATCH) {
    const found = await Promise.all(candidates.slice(i, i + BATCH).map(probe));
    for (const f of found) if (f) folders.push(f);
  }
  return {
    path: segments.join("/"),
    folders: folders.slice(0, FOLDER_LIMIT),
    truncated: folders.length > FOLDER_LIMIT,
  };
}
