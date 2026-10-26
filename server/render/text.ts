import { measureText } from "../../src/measure.ts";
import { CLASS_FONT, NODE_TYPE_DEFAULTS } from "../../src/nodes/defaults.ts";
import { fontOf } from "../../src/textStyle.ts";
import type { Font } from "../../src/textStyle.ts";
import type { NodeData } from "../../src/types.ts";

// Text as the canvas sets it, without a browser. The canvas draws in
// system-ui, which the rasteriser can't find; the render bundles Liberation
// Sans, which has Helvetica's widths, the table src/measure.ts measures with.
// Against the editor in Chrome on macOS, system-ui runs within a few percent
// of it either way (bold a little narrower, regular a little wider), so text
// is drawn at its own width, and measured without measure.ts's SPREAD, which
// is there to make room rather than to match.

export const FONT_FAMILY = "Liberation Sans";
const SPREAD = 1.08; // measure.ts's

// Liberation Sans's vertical metrics (hhea, 2048 units an em), to set a
// baseline in a line box.
const ASCENT = 1854 / 2048;
const DESCENT = 434 / 2048;

// The browser's `normal` line height, which box labels, class rows and a
// group's title are set in: system-ui's, measured off the editor's class boxes
// in Chrome on macOS.
export const NORMAL_LINE = 1.18;

/** A line's width in px, as it is drawn. */
export const widthOf = (line: string, font: Font) => measureText(line, font).width / SPREAD;

/** Where the baseline sits in a line box `lineH` px tall that starts at `top`: CSS centres the glyphs' ascent and descent in it. */
export const baselineOf = (top: number, lineH: number, size: number) =>
  top + (lineH - (ASCENT + DESCENT) * size) / 2 + ASCENT * size;

// What a class's rows are laid out with (CompartmentNode): a name band padded
// 5 px, rows padded 3 px, a compartment padded 3 px and at least 22 px inside,
// and a 1.5 px rule round the box and between its parts.
const BORDER = 1.5;
const BAND_PAD = 5;
const ROW_PAD = 3;
const SECTION_PAD = 3;
const SECTION_MIN = 22;

export type ClassLayout = {
  font: Font; // the name's
  rowFont: Font;
  bandH: number;
  sections: { top: number; rows: string[]; rowsTop: number; rowH: number; bottom: number }[];
  height: number;
};

/** Where a class's band, compartments and rows go, and how tall that makes it. */
export function classLayout(data: NodeData): ClassLayout {
  const font = fontOf(CLASS_FONT, data);
  const rowFont = { size: font.size - 1, weight: data.textWeight ? font.weight : 400 };
  const nameLines = (data.label ?? "").split("\n").length;
  const bandH = 2 * BAND_PAD + nameLines * font.size * NORMAL_LINE;
  const rowH = 2 * ROW_PAD + rowFont.size * NORMAL_LINE;
  const all = data.sections ?? NODE_TYPE_DEFAULTS.compartment.data.sections ?? [];

  let y = BORDER + bandH + BORDER;
  const sections = all.map((rows, i) => {
    const top = y;
    const inner = Math.max(SECTION_MIN, rows.length * rowH);
    y += SECTION_PAD + inner + SECTION_PAD;
    const bottom = y;
    if (i < all.length - 1) y += BORDER;
    return { top, rows, rowsTop: top + SECTION_PAD, rowH, bottom };
  });
  return { font, rowFont, bandH, sections, height: y + BORDER };
}
