// End markers. One slot per end, independently valued.
//
// That independence is the whole reason this is a map rather than an
// `arrowType` enum on the edge: an ER relation routinely carries a different
// cardinality at each end, UML aggregation puts a diamond at one end and
// nothing at the other, and Mermaid's o--o / x--x say the same thing cheaply.
//
// `context-stroke` makes every marker inherit the edge's own colour, so the
// palette does not have to be multiplied by the marker set. Hollow interiors
// are painted with an explicit surface colour: a marker cannot read the page's
// theme variables reliably, so this is the one place a literal is correct.

// Paint is expressed as inline style with CSS custom-property fallbacks rather
// than as presentation attributes. Inside a <marker> the vars are unset, so
// each one falls through to `context-stroke` and the marker inherits the edge's
// own colour — no marker set multiplied by the palette. Anywhere else (the
// sidebar reference, a legend, an export) a wrapper sets --mk-line / --mk-solid
// and the same elements draw in a literal colour. Hollow interiors need an
// opaque fill so the line does not show through, and that one literal is the
// reason --mk-hollow exists.

import type { CSSProperties, ReactNode } from "react";

export type MarkerDef = {
  label: string;
  group: string;
  w: number;
  h: number;
  refX: number;
  body: ReactNode;
};

const SOLID = "var(--mk-solid, context-stroke)";
const LINE = "var(--mk-line, context-stroke)";
const HOLLOW = "var(--mk-hollow, #ffffff)";

const S: { style: CSSProperties } = { style: { fill: SOLID, stroke: "none" } };
const O: { style: CSSProperties } = {
  style: {
    fill: "none",
    stroke: LINE,
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
};
const H: { style: CSSProperties } = {
  style: {
    fill: HOLLOW,
    stroke: LINE,
    strokeWidth: 1.6,
    strokeLinejoin: "round",
  },
};

export const MARKERS: Record<string, MarkerDef> = {
  none: { label: "None", group: "flow", w: 1, h: 1, refX: 0, body: null },

  arrow: {
    label: "Arrow",
    group: "flow",
    w: 12,
    h: 12,
    refX: 11,
    body: <path d="M1.5 1.5 L11 6 L1.5 10.5" {...O} />,
  },
  "arrow-filled": {
    label: "Filled arrow",
    group: "flow",
    w: 12,
    h: 12,
    refX: 11,
    body: <path d="M1 1 L11.5 6 L1 11 Z" {...S} />,
  },
  circle: {
    label: "Circle",
    group: "flow",
    w: 12,
    h: 12,
    refX: 11,
    body: <circle cx="6" cy="6" r="4.6" {...H} />,
  },
  cross: {
    label: "Cross",
    group: "flow",
    w: 12,
    h: 12,
    refX: 10,
    body: <path d="M2 2 L10 10 M10 2 L2 10" {...O} />,
  },

  inheritance: {
    label: "Inheritance",
    group: "uml",
    w: 14,
    h: 12,
    refX: 13,
    body: <path d="M1 1 L13 6 L1 11 Z" {...H} />,
  },
  composition: {
    label: "Composition",
    group: "uml",
    w: 18,
    h: 12,
    refX: 17,
    body: <path d="M1 6 L9 1.5 L17 6 L9 10.5 Z" {...S} />,
  },
  aggregation: {
    label: "Aggregation",
    group: "uml",
    w: 18,
    h: 12,
    refX: 17,
    body: <path d="M1 6 L9 1.5 L17 6 L9 10.5 Z" {...H} />,
  },
  dependency: {
    label: "Dependency",
    group: "uml",
    w: 12,
    h: 12,
    refX: 11,
    body: <path d="M1.5 1.5 L11 6 L1.5 10.5" {...O} />,
  },

  "er-one": {
    label: "One",
    group: "er",
    w: 14,
    h: 12,
    refX: 13,
    body: <path d="M7 1 V11" {...O} />,
  },
  "er-many": {
    label: "Many",
    group: "er",
    w: 14,
    h: 12,
    refX: 13,
    body: <path d="M1 6 L13 1 M1 6 H13 M1 6 L13 11" {...O} />,
  },
  "er-zero-one": {
    label: "Zero or one",
    group: "er",
    w: 20,
    h: 12,
    refX: 19,
    body: (
      <>
        <circle cx="5.5" cy="6" r="4.2" {...H} />
        <path d="M15 1 V11" {...O} />
      </>
    ),
  },
  "er-zero-many": {
    label: "Zero or many",
    group: "er",
    w: 22,
    h: 12,
    refX: 21,
    body: (
      <>
        <circle cx="5" cy="6" r="4.2" {...H} />
        <path d="M10 6 L21 1 M10 6 H21 M10 6 L21 11" {...O} />
      </>
    ),
  },
  "er-one-many": {
    label: "One or many",
    group: "er",
    w: 22,
    h: 12,
    refX: 21,
    body: (
      <>
        <path d="M5 1 V11" {...O} />
        <path d="M9 6 L21 1 M9 6 H21 M9 6 L21 11" {...O} />
      </>
    ),
  },
};

export const MARKER_KEYS = Object.keys(MARKERS);
export const markerId = (key: string) => `ordo-mk-${key}`;
export const markerUrl = (key: string | undefined) =>
  key && key !== "none" && MARKERS[key] ? `url(#${markerId(key)})` : undefined;

// Mounted once next to the canvas. `auto-start-reverse` is what lets a single
// definition serve both ends — without it every marker would need a mirrored
// twin and the start/end slots could not share a vocabulary.
export function EdgeMarkers() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        {MARKER_KEYS.filter((k) => MARKERS[k].body).map((k) => {
          const m = MARKERS[k];
          return (
            <marker
              key={k}
              id={markerId(k)}
              viewBox={`0 0 ${m.w} ${m.h}`}
              markerWidth={m.w}
              markerHeight={m.h}
              refX={m.refX}
              refY={m.h / 2}
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              {m.body}
            </marker>
          );
        })}
      </defs>
    </svg>
  );
}
