// Where the editor is, as the address bar says it: free-form, or a repo and
// one of its diagrams. The URL is the only place this lives, so a reload, a
// bookmark or a second browser tab opens exactly the same thing, and the
// server never has to remember which repo a tab is on.
//
//   /                                                   free-form
//   /?source=local&repo=code/payments-api&tab=checkout  local mode
//
// `repo` is relative to the server's workspace root. An empty `repo` is the
// root itself; a missing one is not local mode at all.

export type Place = { source: "free" } | { source: "local"; repo: string; tab: string | null };

export const FREE: Place = { source: "free" };

/** The place `search` (a location.search string) names. Anything but `source=local` with a `repo` reads as free-form. */
export function readPlace(search: string): Place {
  const params = new URLSearchParams(search);
  const repo = params.get("repo");
  if (params.get("source") !== "local" || repo === null) return FREE;
  return { source: "local", repo, tab: params.get("tab") || null };
}

// encodeURIComponent, with the slashes of a repo path put back so the address
// bar reads code/payments-api rather than code%2Fpayments-api.
const encodeRepo = (repo: string) => encodeURIComponent(repo).replace(/%2F/g, "/");

/** The URL for `place`: "/" or "/?source=local&repo=code/payments-api&tab=auth%20flow". */
export function placeUrl(place: Place): string {
  if (place.source === "free") return "/";
  const tab = place.tab === null ? "" : `&tab=${encodeURIComponent(place.tab)}`;
  return `/?source=local&repo=${encodeRepo(place.repo)}${tab}`;
}

export const samePlace = (a: Place, b: Place) => placeUrl(a) === placeUrl(b);
