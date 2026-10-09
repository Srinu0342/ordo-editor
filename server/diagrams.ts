import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { exportOrdo, readDiagram } from "../src/ordo/index.ts";
import { checkDiagramName, isSafeSegment } from "../src/local/names.ts";
import { HttpError, byName } from "./workspace.ts";

// A repo's diagrams on disk: <repo>/.ordo/<name>/ordo.yaml, one folder per
// diagram, the folder's name being the tab's.
//
// Everything here takes a repo folder that resolveInRoot has already
// checked, and touches nothing but .ordo, its tab folders, their ordo.yaml
// and the temp file a write renames over it. None of the three may be a
// symlink: a link committed to a repo could otherwise point a write anywhere
// on the machine.
//
// Writes are compare-and-swap. The client sends the ETag it last saw (or
// If-None-Match: * to recreate a deleted file), and the write only lands if
// the file on disk still matches. That is how an agent's edit, or another
// browser tab's Sync, is never overwritten without being seen first.

export const ORDO_DIR = ".ordo";
export const DIAGRAM_FILE = "ordo.yaml";
// What View Ordo YAML shows for an empty canvas, so a new diagram's file is
// byte for byte what its first Sync would write.
export const EMPTY_DIAGRAM = exportOrdo([], [], null).text!; // "ordo: 1\nnodes: []\n---\nordo-layout: 1\n"

export type Precondition = { ifMatch: string } | { ifNoneMatch: "*" };

/** The quoted SHA-256 of a file's bytes; strings are hashed as UTF-8, the way they are written. */
export const etagOf = (bytes: string | Buffer) => `"${createHash("sha256").update(bytes).digest("hex")}"`;

const code = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;
const missing = (e: unknown) => code(e) === "ENOENT" || code(e) === "ENOTDIR";

const symlinked = (rel: string) =>
  new HttpError(403, `${rel} is a symbolic link, which Ordo does not follow inside .ordo.`);

async function lstatOrNull(p: string) {
  try {
    return await fs.lstat(p);
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

// The file's bytes, or null when it is gone. O_NOFOLLOW makes the "never a
// symlink" rule hold even if the file is swapped for one after its lstat.
async function readNoFollow(file: string, rel: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (e) {
    if (missing(e)) return null;
    if (code(e) === "ELOOP") throw symlinked(rel);
    throw e;
  }
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

// The repo's .ordo, or null when there is none (or something other than a
// folder sits there). Never created here: opening a repo writes nothing.
async function existingOrdoDir(repoDir: string): Promise<string | null> {
  const dir = path.join(repoDir, ORDO_DIR);
  const stat = await lstatOrNull(dir);
  if (stat?.isSymbolicLink()) throw symlinked(ORDO_DIR);
  return stat?.isDirectory() ? dir : null;
}

// mkdir, then lstat whatever is there now: a folder made by someone else in
// between is fine, a symlink or a file is not.
async function ensureDir(dir: string, rel: string): Promise<void> {
  await fs.mkdir(dir).catch((e) => {
    if (code(e) !== "EEXIST") throw e;
  });
  const stat = await fs.lstat(dir);
  if (stat.isSymbolicLink()) throw symlinked(rel);
  if (!stat.isDirectory()) throw new HttpError(409, `${rel} is a file, where Ordo needs a folder.`);
}

async function entriesOf(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

/** The repo's diagrams A–Z: real folders in .ordo holding a regular ordo.yaml. No .ordo is an empty list. */
export async function listDiagrams(repoDir: string): Promise<string[]> {
  const ordo = await existingOrdoDir(repoDir);
  if (!ordo) return [];
  // Dirent types come from readdir without following links, so a symlinked
  // folder is not isDirectory() and drops out here.
  const names = await Promise.all(
    (await entriesOf(ordo))
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const stat = await fs.lstat(path.join(ordo, d.name, DIAGRAM_FILE)).catch(() => null);
        return stat?.isFile() ? d.name : null;
      }),
  );
  return names.filter((n): n is string => n !== null).sort(byName);
}

type Found = { dir: string; file: string; rel: string };

// The diagram `tab` names, for a read or an If-Match write. `tab` is matched
// against .ordo's entries, never joined into a path: Express decodes %2F, so a
// URL can carry "../..", and the only way to be sure it can't climb is never
// to hand it to path.join. null when there is no such diagram.
async function findDiagram(repoDir: string, tab: string): Promise<Found | null> {
  const ordo = await existingOrdoDir(repoDir);
  if (!ordo) return null;
  const entry = (await entriesOf(ordo)).find((d) => d.name === tab);
  if (!entry) return null;
  const rel = `${ORDO_DIR}/${entry.name}`;
  if (entry.isSymbolicLink()) throw symlinked(rel);
  if (!entry.isDirectory()) return null;
  const dir = path.join(ordo, entry.name);
  const file = path.join(dir, DIAGRAM_FILE);
  const stat = await lstatOrNull(file);
  if (stat?.isSymbolicLink()) throw symlinked(`${rel}/${DIAGRAM_FILE}`);
  return stat?.isFile() ? { dir, file, rel: `${rel}/${DIAGRAM_FILE}` } : null;
}

/** A diagram's text and ETag. 404 when there is no such diagram. */
export async function readDiagramFile(repoDir: string, tab: string): Promise<{ text: string; etag: string }> {
  const found = await findDiagram(repoDir, tab);
  const bytes = found && (await readNoFollow(found.file, found.rel));
  if (!bytes) throw new HttpError(404, `There is no diagram called "${tab}" in this repo.`);
  return { text: bytes.toString("utf8"), etag: etagOf(bytes) };
}

// --- writes -----------------------------------------------------------------

// One chain per diagram, so a write's check and its rename can't interleave
// with another write to the same file from this process. Keyed lower-case:
// on macOS and Windows "Auth" and "auth" are one folder.
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(repoDir: string, tab: string, run: () => Promise<T>): Promise<T> {
  const key = path.join(repoDir, ORDO_DIR, tab).toLowerCase();
  const turn = (locks.get(key) ?? Promise.resolve()).then(run);
  const tail = turn.catch(() => {});
  locks.set(key, tail);
  try {
    return await turn;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/**
 * Create `.ordo/<name>/ordo.yaml` holding EMPTY_DIAGRAM, making `.ordo` if
 * needed. 400 for a name checkDiagramName refuses, 409 for one that is taken.
 */
export async function createDiagram(repoDir: string, name: string): Promise<{ text: string; etag: string }> {
  const problem = checkDiagramName(name, await listDiagrams(repoDir));
  if (problem) throw new HttpError(problem.reason === "taken" ? 409 : 400, problem.message);

  return withLock(repoDir, name, async () => {
    const ordo = path.join(repoDir, ORDO_DIR);
    await ensureDir(ordo, ORDO_DIR);
    // A folder spelled exactly `name` with no ordo.yaml in it (made by hand,
    // or left behind when the file went) is reused. One that differs only in
    // case is refused: on macOS and Windows it is the same folder, and the
    // tab would show one name while the disk holds the other.
    const lower = name.toLowerCase();
    const variant = (await entriesOf(ordo)).find((d) => d.name !== name && d.name.toLowerCase() === lower);
    if (variant)
      throw new HttpError(409, `.ordo already has a folder called "${variant.name}", which differs from "${name}" only in case.`);
    const dir = path.join(ordo, name);
    await ensureDir(dir, `${ORDO_DIR}/${name}`);
    try {
      // wx: never replace a file that appeared since the listing.
      await fs.writeFile(path.join(dir, DIAGRAM_FILE), EMPTY_DIAGRAM, { flag: "wx" });
    } catch (e) {
      if (code(e) === "EEXIST") throw new HttpError(409, `There is already a diagram called "${name}".`);
      throw e;
    }
    return { text: EMPTY_DIAGRAM, etag: etagOf(EMPTY_DIAGRAM) };
  });
}

// Where a write lands and what is there now. For If-Match the diagram must
// exist and be found by name; for a recreate the folder may be gone (git
// removes a folder with its last file), so `tab` is joined, but only once
// isSafeSegment has passed it. Nothing is created yet: an invalid body must
// not leave an empty folder behind.
async function writeTarget(
  repoDir: string,
  tab: string,
  pre: Precondition,
): Promise<{ dir: string; file: string; current: Buffer | null }> {
  const stale = (message: string) => new HttpError(412, message);

  if ("ifMatch" in pre) {
    const found = await findDiagram(repoDir, tab);
    const current = found && (await readNoFollow(found.file, found.rel));
    if (!found || !current) throw stale(`The diagram "${tab}" is gone from disk.`);
    if (etagOf(current) !== pre.ifMatch) throw stale(`The diagram "${tab}" changed on disk since it was last read.`);
    return { dir: found.dir, file: found.file, current };
  }

  if (!isSafeSegment(tab)) throw new HttpError(400, `"${tab}" can't be used as a folder name.`);
  const ordo = path.join(repoDir, ORDO_DIR);
  const dir = path.join(ordo, tab);
  const file = path.join(dir, DIAGRAM_FILE);
  for (const [p, rel] of [
    [ordo, ORDO_DIR],
    [dir, `${ORDO_DIR}/${tab}`],
  ]) {
    const stat = await lstatOrNull(p);
    if (stat?.isSymbolicLink()) throw symlinked(rel);
    if (stat && !stat.isDirectory()) throw new HttpError(409, `${rel} is a file, where Ordo needs a folder.`);
  }
  // Present in any form, a symlink included, means "not absent".
  if (await lstatOrNull(file)) throw stale(`The diagram "${tab}" already exists on disk.`);
  return { dir, file, current: null };
}

/**
 * Write a diagram's text if the precondition still holds, validating it
 * first and keeping the file's CRLF line endings. Atomic: a temp file in the
 * same folder is renamed over ordo.yaml, so a reader sees the old file or the
 * new one, never half of either.
 */
export async function writeDiagramFile(
  repoDir: string,
  tab: string,
  text: string,
  pre: Precondition,
): Promise<{ etag: string }> {
  return withLock(repoDir, tab, async () => {
    const { dir, file, current } = await writeTarget(repoDir, tab, pre);

    // The same checks the import dialog runs: nothing that fails them reaches a file.
    const read = readDiagram(text);
    if (!read.ok)
      throw new HttpError(422, "The diagram has errors, so nothing was written.", { diagnostics: read.diagnostics });

    // Ordo writes LF. A file checked out with CRLF (Windows, autocrlf) keeps
    // CRLF, or every line would show as changed.
    const crlf = current !== null && /^[^\n]*\r\n/.test(current.toString("utf8"));
    const out = crlf ? text.replace(/\r?\n/g, "\r\n") : text;

    if (!current) {
      await ensureDir(path.join(repoDir, ORDO_DIR), ORDO_DIR);
      await ensureDir(dir, `${ORDO_DIR}/${tab}`);
    }
    const tmp = path.join(dir, `.${DIAGRAM_FILE}.${randomUUID()}.tmp`);
    try {
      const handle = await fs.open(tmp, "wx");
      try {
        await handle.writeFile(out);
        // On disk before the rename, so a crash can't leave ordo.yaml empty.
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, file);
    } catch (e) {
      // The old file is untouched; only the temp file needs tidying.
      await fs.unlink(tmp).catch(() => {});
      throw e;
    }
    return { etag: etagOf(out) };
  });
}
