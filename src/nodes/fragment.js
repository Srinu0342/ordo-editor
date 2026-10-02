import { label, line, path, rect } from "../ops.js";
import { measureText } from "../measure.js";

// A combined fragment: the loop / alt / opt / par frame of a sequence diagram.
//
// Structure rather than a shape — an operator tab, one guard per operand, a
// divider between operands — which by the organising cut makes it a node type,
// not a value of Box's `shape`. It is drawn as an op-list like every other
// node; the operator and the guards are label slots, so the canvas can edit
// them and the headless walker can still draw them.
//
// Two more frames share it because they are the same rectangle without the
// tab: `rect` is a highlighted region (Mermaid's `rect rgb(…)`), and `box`
// groups participant columns under a title.
//
// A frame holds nothing. It is drawn round what it frames, but it never adopts
// children: what is inside a fragment is lifelines, riders and messages, which
// belong to the timeline, not to the frame.

export const FRAGMENT_TYPE = "fragment";

export const TAB_H = 22; // the operator tab, and the header band it sits in
export const GUARD_BAND = 22; // the guard line under a divider
const TAB_PAD = 9;
const NOTCH = 6; // the tab's clipped corner
const GUARD_GAP = 8; // tab to first guard
const DIVIDER_DASH = "5 4";

export const OPERATOR_FONT = { size: 12, weight: 700 };
export const GUARD_FONT = { size: 12, weight: 400 };
export const TITLE_FONT = { size: 13, weight: 600 };

const n = (v) => Math.round(v * 100) / 100;

// Frames drawn as a bare rectangle, with no operator tab.
export const isPlain = (operator) => operator === "rect" || operator === "box";

// Guards read the UML way, bracketed.
export const bracket = (guard) => (guard ? `[${guard}]` : "");

// Measured with the shared table, so the importer and the canvas agree on how
// wide a tab is.
export const tabWidth = (operator) =>
  Math.ceil(measureText(operator || " ", OPERATOR_FONT).width) +
  2 * TAB_PAD +
  NOTCH;

/** The narrowest frame that still shows its header in full. */
export function headerWidth({ operator, guards = [] } = {}) {
  if (operator === "rect") return 0;
  const first = guards[0] ?? "";
  if (operator === "box")
    return Math.ceil(measureText(first, TITLE_FONT).width) + 32;
  const guard = first
    ? Math.ceil(measureText(bracket(first), GUARD_FONT).width) + GUARD_GAP + 8
    : 0;
  return tabWidth(operator) + guard + 8;
}

// Divider i's guard is guards[i + 1]. Slot names carry the index, so an edit
// made in a label can be written back to the right guard.
export const guardSlot = (i) => `guard:${i}`;
export const guardIndex = (slot) => Number(String(slot).slice(6));

/** The frame's op-list. `data.dividers` are px from the frame's top. */
export function drawFragment(w, h, data = {}) {
  const operator = data.operator ?? "";

  if (operator === "rect")
    return [rect(0, 0, w, h, { fill: data.fill ?? "node.shade", stroke: "none" })];

  if (operator === "box")
    return [
      rect(0.75, 0.75, n(w - 1.5), n(h - 1.5), {
        rx: 6,
        fill: data.fill ?? "none",
        width: 1.25,
      }),
      label(8, 4, n(Math.max(0, w - 16)), 20, {
        slot: guardSlot(0),
        ...TITLE_FONT,
      }),
    ];

  const tw = n(Math.min(tabWidth(operator), w - 1.5));
  const guard = { ...GUARD_FONT, align: "left", fill: "node.ink.muted" };

  const ops = [
    rect(0.75, 0.75, n(w - 1.5), n(h - 1.5), { fill: "none", width: 1.25 }),
    path(
      `M0.75 0.75 H${tw} V${TAB_H - NOTCH} L${n(tw - NOTCH)} ${TAB_H} H0.75 Z`,
      { fill: "node.shade", width: 1.25 },
    ),
    label(TAB_PAD, 0, n(Math.max(0, tw - TAB_PAD - NOTCH)), TAB_H, {
      slot: "operator",
      ...OPERATOR_FONT,
      align: "left",
    }),
    label(n(tw + GUARD_GAP), 0, n(Math.max(0, w - tw - GUARD_GAP - 8)), TAB_H, {
      slot: guardSlot(0),
      ...guard,
    }),
  ];

  (data.dividers ?? []).forEach((y, i) => {
    // a resize can leave a divider outside the frame; it is kept, not drawn
    if (!(y > TAB_H && y < h - 4)) return;
    ops.push(
      line(0.75, n(y), n(w - 0.75), n(y), { dash: DIVIDER_DASH, width: 1.25 }),
      label(8, n(y + 2), n(Math.max(0, w - 16)), GUARD_BAND - 4, {
        slot: guardSlot(i + 1),
        ...guard,
      }),
    );
  });

  return ops;
}

/**
 * One operand more or fewer. A new one gets a divider halfway down the last
 * operand; removing takes the last divider and its guard. Guards always number
 * one more than dividers.
 */
export function stepOperands(data, delta, h) {
  const dividers = [...(data.dividers ?? [])];

  if (delta > 0) {
    const top = dividers.length ? dividers[dividers.length - 1] : TAB_H;
    if (h - top < 2 * GUARD_BAND) return data; // no room for another operand
    dividers.push(Math.round(top + (h - top) / 2));
  } else if (dividers.length) {
    dividers.pop();
  } else {
    return data;
  }

  const guards = Array.from(
    { length: dividers.length + 1 },
    (_, i) => data.guards?.[i] ?? "",
  );
  return { ...data, dividers, guards };
}
