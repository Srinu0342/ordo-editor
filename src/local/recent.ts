// Per-browser conveniences for the repo picker: the repos opened lately, and
// the folder the picker was last in. Nice to have and nothing more, so every
// read and write is wrapped: storage can be blocked, full, or missing (a
// private window, a test), and the picker works the same without it.

const RECENT_KEY = "ordo.recentRepos";
const PATH_KEY = "ordo.pickerPath";
export const RECENT_LIMIT = 8;

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // nothing to do: the picker simply won't remember
  }
}

/** Repos opened in this browser, newest first, at most RECENT_LIMIT. */
export function recentRepos(): string[] {
  try {
    const list: unknown = JSON.parse(read(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((r): r is string => typeof r === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRepo(repo: string) {
  const list = [repo, ...recentRepos().filter((r) => r !== repo)].slice(0, RECENT_LIMIT);
  write(RECENT_KEY, JSON.stringify(list));
}

/** The folder the picker was last showing, relative to the root; "" for the root. */
export const lastPickerPath = (): string => read(PATH_KEY) ?? "";

export const rememberPickerPath = (path: string) => write(PATH_KEY, path);
