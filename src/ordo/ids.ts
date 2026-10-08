// Ids are the format's stable keys: the skeleton, the edge list, the data
// section and the layout file all refer to a node or an edge by its id, so an
// id is never derived from a label and the canvas never rewrites one. New ones
// are minted as n<k> and e<k>, with k one above the highest number in use.

/**
 * A fresh id: `prefix` followed by one more than the highest number any id of
 * that form already uses. Ids are unique across nodes and edges together, so
 * `taken` should hold both.
 */
export function mintId(prefix: "n" | "e", taken: Iterable<string>): string {
  const form = new RegExp(`^${prefix}(\\d+)$`);
  const used = new Set<string>();
  let highest = 0n; // a BigInt, so a twenty-digit id cannot round into a duplicate
  for (const id of taken) {
    used.add(id);
    const m = form.exec(id);
    if (m && BigInt(m[1]) > highest) highest = BigInt(m[1]);
  }
  let k = highest + 1n;
  while (used.has(`${prefix}${k}`)) k += 1n;
  return `${prefix}${k}`;
}

/** Mints a run of ids against one snapshot, counting each one it hands out as taken. */
export function idMinter(taken: Iterable<string>) {
  const used = new Set(taken);
  const next = (prefix: "n" | "e") => {
    const id = mintId(prefix, used);
    used.add(id);
    return id;
  };
  return { node: () => next("n"), edge: () => next("e") };
}
