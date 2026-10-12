// Text appearance, for nodes and lines alike: how big a label is and how
// heavy. Kept apart from what draws the text, the same cut edgeStyle.ts makes
// for a line: every kind has a font of its own (nodes/defaults.ts, edgeStyle's
// EDGE_LABEL_FONT), and a node or line that carries `textSize` / `textWeight`
// in its data overrides it. Absent means "the kind's own", so a diagram nobody
// restyled writes nothing, and a change to a kind's font reaches it.

import { TEXT_ALIGNS, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_WEIGHTS } from "./ordo/types.ts";
import type { TextAlign, TextWeight } from "./ordo/types.ts";

export { TEXT_ALIGNS, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_WEIGHTS };
export type { TextAlign, TextWeight };

export type Font = { size: number; weight: number };

// What a node or a line may say about its own text. Only a text node has
// lines of its own to align, so only it reads textAlign.
export type TextStyle = {
  textSize?: number;
  textWeight?: TextWeight;
  textAlign?: TextAlign;
};

const WEIGHT_VALUE: Record<TextWeight, number> = {
  regular: 400,
  semibold: 600,
  bold: 700,
};

export const WEIGHT_LABELS: Record<TextWeight, string> = {
  regular: "Regular",
  semibold: "Semibold",
  bold: "Bold",
};

export const weightValue = (w: TextWeight) => WEIGHT_VALUE[w];

// The name for a CSS weight: the heaviest one it reaches.
export const weightName = (value: number): TextWeight =>
  value >= WEIGHT_VALUE.bold
    ? "bold"
    : value >= WEIGHT_VALUE.semibold
      ? "semibold"
      : "regular";

export const clampTextSize = (size: number) =>
  Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(size)));

/** The font text is drawn in: its own size and weight where it has them, over `base`. */
export const fontOf = (base: Font, own?: TextStyle | null): Font => ({
  size: typeof own?.textSize === "number" ? own.textSize : base.size,
  weight:
    own?.textWeight && Object.hasOwn(WEIGHT_VALUE, own.textWeight)
      ? WEIGHT_VALUE[own.textWeight]
      : base.weight,
});

/**
 * `data` with its text set to `next`. A value equal to the kind's own is
 * dropped rather than stored, so going back to the default leaves no trace in
 * the file.
 */
export function withTextStyle<D extends TextStyle>(
  data: D,
  next: TextStyle,
  base: Font,
): D {
  const { textSize: _size, textWeight: _weight, ...rest } = data;
  const size = next.textSize;
  const weight = next.textWeight;
  return {
    ...rest,
    ...(size !== undefined && size !== base.size ? { textSize: size } : {}),
    ...(weight !== undefined && WEIGHT_VALUE[weight] !== base.weight
      ? { textWeight: weight }
      : {}),
  } as D;
}

// A text node's lines run from the left unless it says otherwise: it is where
// a paragraph reads from, and for a single line it makes no difference at all.
export const TEXT_ALIGN: TextAlign = "left";

export const ALIGN_LABELS: Record<TextAlign, string> = {
  left: "Align left",
  center: "Align centre",
  right: "Align right",
};

export const alignOf = (own?: TextStyle | null): TextAlign =>
  own?.textAlign && (TEXT_ALIGNS as readonly string[]).includes(own.textAlign)
    ? own.textAlign
    : TEXT_ALIGN;

/** `data` aligned to `align`; left, or undefined, leaves no trace in the file. */
export function withTextAlign<D extends TextStyle>(
  data: D,
  align?: TextAlign,
): D {
  const { textAlign: _align, ...rest } = data;
  return (
    align !== undefined && align !== TEXT_ALIGN
      ? { ...rest, textAlign: align }
      : rest
  ) as D;
}

// What the selection's text looks like, for a control to show: the size and
// weight they share, or null where they differ, and whether any of them has a
// size or weight of its own to reset. Alignment is summed over the items that
// can be aligned only; `alignable` is how many there are.
export type TextSummary = {
  count: number;
  size: number | null;
  weight: TextWeight | null;
  alignable: number;
  align: TextAlign | null;
  restyled: boolean;
};

const shared = <T>(values: T[]): T | null =>
  values.length > 0 && values.every((v) => v === values[0]) ? values[0] : null;

export function summarizeText(
  items: { base: Font; own?: TextStyle | null; alignable?: boolean }[],
): TextSummary {
  const fonts = items.map(({ base, own }) => fontOf(base, own));
  const aligned = items.filter((item) => item.alignable);
  return {
    count: items.length,
    size: shared(fonts.map((f) => f.size)),
    weight: shared(fonts.map((f) => weightName(f.weight))),
    alignable: aligned.length,
    align: shared(aligned.map(({ own }) => alignOf(own))),
    restyled: items.some(
      ({ own, alignable }) =>
        own?.textSize !== undefined ||
        own?.textWeight !== undefined ||
        (alignable && own?.textAlign !== undefined),
    ),
  };
}
