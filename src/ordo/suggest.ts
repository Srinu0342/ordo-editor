// "Did you mean …?": the nearest known word to one that isn't, for the
// validator's messages. An agent that writes `cylnder` or `dashd` gets the fix
// in the same answer, rather than a second round to look the word up.
//
// No Node imports: the validator runs in the browser too.

/** Edits between `a` and `b`, an adjacent swap counting as one (optimal string alignment). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

// How many edits still read as a slip rather than another word. A word of one
// or two letters is a different word after any edit.
const slack = (length: number) => (length <= 2 ? 0 : length <= 4 ? 1 : length <= 8 ? 2 : 3);

/**
 * The candidate `word` most likely meant, or undefined when none is close: the
 * same word in another case, then the fewest edits within a slip's reach,
 * then the one candidate it is the start of (`ortho` for `orthogonal`), then
 * the longest candidate it starts with (`arrowhead` for `arrow`).
 */
export function closest(word: string, candidates: Iterable<string>): string | undefined {
  const all = [...new Set(candidates)];
  const lower = word.toLowerCase();
  const same = all.find((c) => c.toLowerCase() === lower);
  if (same !== undefined) return same;

  let best: string | undefined;
  let bestDistance = slack(lower.length) + 1;
  for (const c of all) {
    const d = distance(lower, c.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  if (best !== undefined) return best;

  if (lower.length >= 3) {
    const starts = all.filter((c) => c.toLowerCase().startsWith(lower));
    if (starts.length === 1) return starts[0];
  }
  const inside = all
    .filter((c) => c.length >= 3 && lower.startsWith(c.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  return inside[0];
}
