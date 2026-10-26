import fs from "node:fs/promises";
import {
  DEFAULTS,
  EDGE_ROUTES,
  GUIDE_TOPICS,
  LEAF_KINDS,
  LINES,
  MARKERS,
  PLACEMENTS,
  TEXT_ALIGNS,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_WEIGHTS,
  type GuidePage,
} from "../src/ordo/types.ts";
import { measureText } from "../src/measure.ts";
import { OP, flatten } from "../src/ops.ts";
import type { LabelOp } from "../src/ops.ts";
import { SHAPE_GROUPS, drawShape, shapeDef } from "../src/shapes/registry.ts";

// The agent guide that ordo_guide serves: how to write an Ordo file, for a
// model that has never seen one.
//
// The prose is written by hand, one page per file in docs/agents/, so the
// Ordo skill can ship the same text. The lists in it are not: a page says
// {{list:shapes}} or {{list:markers}} and gets them from the registry and the
// format's vocabularies here, so a shape or a marker added to the code is in
// the guide the next time it is read. (`list:` keeps them apart from what a
// page may quote, such as Mermaid's {{hexagon}}.) Pages are read on every
// call, so an edit to the prose shows up without a restart.

const PAGES = new URL("../docs/agents/", import.meta.url);

export const GUIDE_PAGES: readonly GuidePage[] = ["core", ...GUIDE_TOPICS];

/** "`a`, `b`, `c`": a vocabulary as the guide prints it. */
const words = (list: readonly string[]) => list.map((w) => `\`${w}\``).join(", ");

// A label of ordinary words, to take the average width of a letter from.
const SAMPLE = "Payment service";
// The browser's `normal` line height, which a label slot is drawn with.
const LINE = 1.15;

/** About how much text fits in a shape's label at its default size, as "15 × 2" (letters a line × lines), or "no label". */
function room(key: string): string {
  const [w, h] = shapeDef(key).size;
  const slot = flatten(drawShape(key, w, h)).find((op): op is LabelOp => op.op === OP.LABEL);
  if (!slot) return "no label";
  const letter = measureText(SAMPLE, { size: slot.size, weight: slot.weight }).width / SAMPLE.length;
  return `${Math.floor(slot.w / letter)} × ${Math.max(1, Math.floor(slot.h / (slot.size * LINE)))}`;
}

/** Every shape key, one line per palette group, with the palette's name for it where the key alone doesn't say, and its label's room. */
function shapeLines(): string {
  return SHAPE_GROUPS.map(([, title, set]) => {
    const shapes = Object.entries(set).map(([key, s]) => {
      // "Comment (right)" reads "comment, right" inside the parentheses it is printed in.
      const name = s.label.toLowerCase().replace(/ \((.*)\)$/, ", $1");
      return `\`${key}\` (${name === key.toLowerCase() ? "" : `${name}, `}${room(key)})`;
    });
    return `- ${title}: ${shapes.join(", ")}`;
  }).join("\n");
}

const LISTS: Record<string, () => string> = {
  shapes: shapeLines,
  kinds: () => words(LEAF_KINDS),
  routes: () => words(EDGE_ROUTES),
  lines: () => words(LINES),
  markers: () => words(MARKERS),
  placements: () => words(PLACEMENTS),
  weights: () => words(TEXT_WEIGHTS),
  aligns: () => words(TEXT_ALIGNS),
  textSizes: () => `${TEXT_SIZE_MIN}–${TEXT_SIZE_MAX}`,
  color: () => `\`${DEFAULTS.color}\``,
};

/** A page's prose with its {{list:…}} filled in. A name with no list is a mistake in the page, so it throws. */
export function fill(text: string): string {
  return text.replace(/\{\{list:([^}]*)\}\}/g, (_, name: string) => {
    if (!Object.hasOwn(LISTS, name)) throw new Error(`the guide asks for {{list:${name}}}, which is not a list Ordo has`);
    return LISTS[name]();
  });
}

/** One page of the guide, ready to send. */
export async function guidePage(page: GuidePage = "core"): Promise<string> {
  return fill(await fs.readFile(new URL(`${page}.md`, PAGES), "utf8"));
}
