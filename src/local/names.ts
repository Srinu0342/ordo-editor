// Diagram names: which ones Ordo will create, and which folder names are safe
// to recreate.
//
// A diagram's name is its folder's name, <repo>/.ordo/<name>/, and that folder
// is committed and checked out on every machine that clones the repo. So a
// new name has to be a folder name that works everywhere: ASCII only, nothing
// Windows reserves, nothing a case-insensitive filesystem (macOS, Windows)
// would fold onto an existing diagram.
//
// Shared by the server, which enforces the rules, and the tab bar's `+`
// field, which checks as you type. No Node imports, so it bundles for the
// browser.

const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
const MAX_NAME = 64;
// Reserved device names on Windows, with or without an extension: `con`,
// `CON.yaml` and `lpt1.txt` all name a device, not a folder.
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export type NameProblem = { reason: "invalid" | "taken"; message: string };

/** null when `name` may be created; otherwise why not, as a reason the server maps to 400 or 409 and one sentence for the UI. */
export function checkDiagramName(name: string, existing: readonly string[]): NameProblem | null {
  const invalid = (message: string): NameProblem => ({ reason: "invalid", message });
  if (name === "") return invalid("Give the diagram a name.");
  if (name.length > MAX_NAME) return invalid(`A name can be at most ${MAX_NAME} characters.`);
  if (!/^[A-Za-z0-9]/.test(name)) return invalid("A name must start with a letter or a digit.");
  if (!NAME.test(name)) return invalid("A name can use only letters, digits, spaces, -, _ and dots.");
  if (/[ .]$/.test(name)) return invalid("A name can't end with a space or a dot.");
  if (DEVICE.test(name)) return invalid(`"${name}" is a name Windows reserves; choose another.`);

  // Case-insensitive: on macOS and Windows "Auth" and "auth" are one folder.
  const lower = name.toLowerCase();
  const clash = existing.find((e) => e.toLowerCase() === lower);
  if (clash !== undefined) return { reason: "taken", message: `There is already a diagram called "${clash}".` };
  return null;
}

/**
 * A name that is safe as one folder name, for recreating a diagram whose
 * folder is gone: non-empty, at most 255 bytes, not "." or "..", no "/", "\"
 * or NUL. Looser than checkDiagramName on purpose: the folder may have been
 * made by hand, and recreating it must keep its name.
 */
export function isSafeSegment(name: string): boolean {
  if (typeof name !== "string" || name === "" || name === "." || name === "..") return false;
  if (/[/\\\0]/.test(name)) return false;
  return new TextEncoder().encode(name).length <= 255;
}
