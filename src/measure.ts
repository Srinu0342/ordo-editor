// Text metrics, deterministically.
//
// Layout that depends on how wide a label is has to agree with itself wherever
// it runs: the importer sizing a sequence diagram's columns, the editor sizing a
// frame's operator tab, the headless renderer drawing the same file on a
// server. A browser's canvas cannot give that — it answers in whatever font the
// machine happens to have — so this is a fixed advance-width table instead: the
// same numbers in Node and in every browser, which is what makes an import
// reproducible.
//
// The table is Helvetica's, regular and bold, in units of 1/1000 em. The
// canvas draws in system-ui, which runs a few percent wider on most platforms;
// SPREAD covers that, so a label sized here comes out roomy rather than
// clipped.

const FIRST = 32; // the table starts at space and runs to "~"

// prettier-ignore
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// prettier-ignore
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Outside the table: an average lowercase glyph, or a full em for the scripts
// and symbols (CJK, emoji) that are drawn square.
const FALLBACK = 556;
const WIDE = 1000;
const WIDE_FROM = 0x2e80;

const SPREAD = 1.08;

// Line box as a multiple of the font size — a little over the browser's
// `normal`, for the same reason as SPREAD.
export const LINE_HEIGHT = 1.25;

const advance = (table, ch) => {
  const code = ch.codePointAt(0);
  const i = code - FIRST;
  if (i >= 0 && i < table.length) return table[i];
  return code >= WIDE_FROM ? WIDE : FALLBACK;
};

/**
 * Size of `text` in px. One line per "\n"; the width is the widest line.
 * Weights of 600 and up read the bold table.
 */
export function measureText(text, { size = 14, weight = 400 } = {}) {
  const table = weight >= 600 ? BOLD : REGULAR;
  const lines = String(text ?? "").split("\n");

  let widest = 0;
  for (const line of lines) {
    let units = 0;
    for (const ch of line) units += advance(table, ch);
    widest = Math.max(widest, units);
  }

  return {
    width: (widest * size * SPREAD) / 1000,
    height: lines.length * size * LINE_HEIGHT,
    lines: lines.length,
  };
}

/**
 * Greedy word wrap to `maxWidth`, measured with the same table. Existing line
 * breaks are kept; a single word wider than the limit gets a line to itself
 * rather than being cut.
 */
export function wrapText(text, maxWidth, font, measure = measureText) {
  return String(text ?? "")
    .split("\n")
    .map((para) => {
      const out = [];
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next, font).width > maxWidth) {
          out.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      out.push(line);
      return out.join("\n");
    })
    .join("\n");
}
