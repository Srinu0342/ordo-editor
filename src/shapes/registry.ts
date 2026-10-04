import { rect, ellipse, path, line, label, rule } from "../ops.js";

// One path generator per shape, parameterised on the node's width and height.
//
// This file is the proof of WS3's organising cut: every entry below is a VALUE
// of Box's `shape` property, not a component. They share one drawNode
// signature, one label slot, one anchor derivation. Adding a shape is adding a
// row here — it does not add a component, a node type, or a file.
//
// Coordinates are node-local with (0,0) at the top-left. Generators must not
// assume a particular size: everything derives from w and h so a shape stays
// itself when resized.

const n = (v) => Math.round(v * 100) / 100;

// Corner radius that stays proportionate at small sizes but does not grow
// absurd on a wide node.
const soft = (w, h) => n(Math.min(10, Math.min(w, h) * 0.22));
// Diagonal inset used by hexagons, parallelograms and trapezoids.
const slant = (w, h) => n(Math.min(w * 0.22, h * 0.62));
// Cylinder cap depth.
const cap = (h) => n(Math.min(h * 0.2, 14));

const pad = (w, h, l = 0.12, t = 0.16) => [
  n(w * l),
  n(h * t),
  n(w * (1 - l * 2)),
  n(h * (1 - t * 2)),
];

// A plain centred label filling the node minus a small inset. Shapes whose
// outline eats into the middle (diamond, triangle) pass a tighter box.
const mid = (w, h, inx = 0.1, iny = 0.14) =>
  label(n(w * inx), n(h * iny), n(w * (1 - inx * 2)), n(h * (1 - iny * 2)));

// ---------------------------------------------------------------------------
// Terminators and junctions
// ---------------------------------------------------------------------------
const TERM = {
  circle: {
    label: "Circle",
    size: [96, 96],
    draw: (w, h) => [
      ellipse(n(w / 2), n(h / 2), n(w / 2 - 1), n(h / 2 - 1)),
      mid(w, h, 0.18, 0.3),
    ],
  },
  "sm-circ": {
    label: "Start",
    size: [40, 40],
    draw: (w, h) => [ellipse(n(w / 2), n(h / 2), n(w / 2 - 1), n(h / 2 - 1))],
  },
  "dbl-circ": {
    label: "Double circle",
    size: [96, 96],
    draw: (w, h) => [
      ellipse(n(w / 2), n(h / 2), n(w / 2 - 1), n(h / 2 - 1)),
      ellipse(n(w / 2), n(h / 2), n(w / 2 - 6), n(h / 2 - 6), { fill: "none" }),
      mid(w, h, 0.2, 0.32),
    ],
  },
  "fr-circ": {
    label: "Stop",
    size: [48, 48],
    draw: (w, h) => [
      ellipse(n(w / 2), n(h / 2), n(w / 2 - 1), n(h / 2 - 1)),
      ellipse(n(w / 2), n(h / 2), n(w / 2 - 7), n(h / 2 - 7), {
        fill: "node.ink",
        stroke: "none",
      }),
    ],
  },
  "f-circ": {
    label: "Junction",
    size: [32, 32],
    draw: (w, h) => [
      ellipse(n(w / 2), n(h / 2), n(w / 2 - 1), n(h / 2 - 1), {
        fill: "node.ink",
        stroke: "none",
      }),
    ],
  },
  "cross-circ": {
    label: "Summary",
    size: [64, 64],
    draw: (w, h) => {
      const k = n(w * 0.16);
      const j = n(h * 0.16);
      return [
        ellipse(n(w / 2), n(h / 2), n(w / 2 - 1), n(h / 2 - 1)),
        line(k, j, n(w - k), n(h - j)),
        line(n(w - k), j, k, n(h - j)),
      ];
    },
  },
  stadium: {
    label: "Terminal",
    size: [160, 48],
    draw: (w, h) => [
      rect(1, 1, n(w - 2), n(h - 2), { rx: n(h / 2) }),
      mid(w, h, 0.14),
    ],
  },
  fork: {
    label: "Fork / join",
    size: [160, 14],
    draw: (w, h) => [
      rect(0, 0, w, h, { fill: "node.ink", stroke: "none", rx: 2 }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Process and decision
// ---------------------------------------------------------------------------
const PROC = {
  rect: {
    label: "Process",
    size: [160, 48],
    draw: (w, h) => [rect(1, 1, n(w - 2), n(h - 2)), mid(w, h)],
  },
  rounded: {
    label: "Event",
    size: [160, 48],
    draw: (w, h) => [
      rect(1, 1, n(w - 2), n(h - 2), { rx: soft(w, h) }),
      mid(w, h),
    ],
  },
  diam: {
    label: "Decision",
    size: [140, 88],
    draw: (w, h) => [
      path(
        `M${n(w / 2)} 1 L${n(w - 1)} ${n(h / 2)} L${n(w / 2)} ${n(h - 1)} L1 ${n(h / 2)} Z`,
      ),
      mid(w, h, 0.24, 0.28),
    ],
  },
  hex: {
    label: "Preparation",
    size: [170, 56],
    draw: (w, h) => {
      const s = slant(w, h);
      return [
        path(
          `M${s} 1 H${n(w - s)} L${n(w - 1)} ${n(h / 2)} L${n(w - s)} ${n(h - 1)} H${s} L1 ${n(h / 2)} Z`,
        ),
        mid(w, h, 0.18),
      ];
    },
  },
  "fr-rect": {
    label: "Subprocess",
    size: [170, 48],
    draw: (w, h) => {
      const i = n(Math.min(12, w * 0.09));
      return [
        rect(1, 1, n(w - 2), n(h - 2)),
        rule(i, 1, i, n(h - 1)),
        rule(n(w - i), 1, n(w - i), n(h - 1)),
        mid(w, h, 0.16),
      ];
    },
  },
  "div-rect": {
    label: "Divided process",
    size: [160, 60],
    draw: (w, h) => {
      const band = n(Math.min(18, h * 0.32));
      return [
        rect(1, 1, n(w - 2), n(h - 2)),
        rule(1, band, n(w - 1), band),
        label(n(w * 0.08), n(band + 4), n(w * 0.84), n(h - band - 8)),
      ];
    },
  },
  "lin-rect": {
    label: "Shaded process",
    size: [160, 48],
    draw: (w, h) => {
      const i = n(Math.min(12, w * 0.09));
      return [
        rect(1, 1, n(w - 2), n(h - 2)),
        rule(i, 1, i, n(h - 1)),
        label(n(i + 6), n(h * 0.14), n(w - i - 14), n(h * 0.72)),
      ];
    },
  },
  "st-rect": {
    label: "Multi-process",
    size: [160, 56],
    draw: (w, h) => {
      const o = n(Math.min(7, h * 0.16));
      return [
        rect(n(o + 1), 1, n(w - o - 2), n(h - o - 2), { fill: "node.shade" }),
        rect(1, n(o + 1), n(w - o - 2), n(h - o - 2)),
        label(n(w * 0.08), n(o + h * 0.16), n(w * 0.78), n(h * 0.6)),
      ];
    },
  },
  delay: {
    label: "Delay",
    size: [160, 48],
    draw: (w, h) => {
      const r = n(h / 2);
      return [
        path(`M1 1 H${n(w - r)} A${r} ${r} 0 0 1 ${n(w - r)} ${n(h - 1)} H1 Z`),
        mid(w, h, 0.1),
      ];
    },
  },
  "trap-t": {
    label: "Manual operation",
    size: [170, 52],
    draw: (w, h) => {
      const s = slant(w, h);
      return [
        path(`M1 1 H${n(w - 1)} L${n(w - s)} ${n(h - 1)} H${s} Z`),
        mid(w, h, 0.2),
      ];
    },
  },
  "trap-b": {
    label: "Priority",
    size: [170, 52],
    draw: (w, h) => {
      const s = slant(w, h);
      return [
        path(`M${s} 1 H${n(w - s)} L${n(w - 1)} ${n(h - 1)} H1 Z`),
        mid(w, h, 0.2),
      ];
    },
  },
  "notch-pent": {
    label: "Loop limit",
    size: [160, 52],
    draw: (w, h) => {
      const c = n(Math.min(w * 0.12, h * 0.3));
      return [
        path(`M${c} 1 H${n(w - c)} L${n(w - 1)} ${c} V${n(h - 1)} H1 V${c} Z`),
        mid(w, h, 0.12, 0.28),
      ];
    },
  },
  hourglass: {
    label: "Collate",
    size: [80, 80],
    draw: (w, h) => [
      path(`M1 1 H${n(w - 1)} L${n(w / 2)} ${n(h / 2)} Z`),
      path(`M1 ${n(h - 1)} H${n(w - 1)} L${n(w / 2)} ${n(h / 2)} Z`),
    ],
  },
  tri: {
    label: "Extract",
    size: [96, 76],
    draw: (w, h) => [
      path(`M${n(w / 2)} 1 L${n(w - 1)} ${n(h - 1)} H1 Z`),
      label(n(w * 0.22), n(h * 0.45), n(w * 0.56), n(h * 0.4)),
    ],
  },
  "flip-tri": {
    label: "Manual file",
    size: [96, 76],
    draw: (w, h) => [
      path(`M1 1 H${n(w - 1)} L${n(w / 2)} ${n(h - 1)} Z`),
      label(n(w * 0.22), n(h * 0.14), n(w * 0.56), n(h * 0.4)),
    ],
  },
};

// ---------------------------------------------------------------------------
// Input, output and manual steps
// ---------------------------------------------------------------------------
const IO = {
  "lean-r": {
    label: "Input / output",
    size: [170, 48],
    draw: (w, h) => {
      const s = slant(w, h);
      return [
        path(`M${s} 1 H${n(w - 1)} L${n(w - s)} ${n(h - 1)} H1 Z`),
        mid(w, h, 0.18),
      ];
    },
  },
  "lean-l": {
    label: "Output / input",
    size: [170, 48],
    draw: (w, h) => {
      const s = slant(w, h);
      return [
        path(`M1 1 H${n(w - s)} L${n(w - 1)} ${n(h - 1)} H${s} Z`),
        mid(w, h, 0.18),
      ];
    },
  },
  "sl-rect": {
    label: "Manual input",
    size: [160, 52],
    draw: (w, h) => {
      const d = n(Math.min(h * 0.3, 18));
      return [
        path(`M1 ${n(d)} L${n(w - 1)} 1 V${n(h - 1)} H1 Z`),
        label(n(w * 0.1), n(d + 4), n(w * 0.8), n(h - d - 8)),
      ];
    },
  },
  "curv-trap": {
    label: "Display",
    size: [170, 56],
    draw: (w, h) => {
      const c = n(w * 0.16);
      return [
        path(
          `M${n(c * 0.4)} 1 H${n(w - c)} Q${n(w - 1)} ${n(h / 2)} ${n(w - c)} ${n(h - 1)} H${n(c * 0.4)} Q1 ${n(h / 2)} ${n(c * 0.4)} 1 Z`,
        ),
        mid(w, h, 0.16),
      ];
    },
  },
  "notch-rect": {
    label: "Card",
    size: [160, 52],
    draw: (w, h) => {
      const c = n(Math.min(w * 0.14, h * 0.34));
      return [
        path(`M${c} 1 H${n(w - 1)} V${n(h - 1)} H1 V${c} Z`),
        label(n(c + 6), n(h * 0.2), n(w - c - 14), n(h * 0.6)),
      ];
    },
  },
  flag: {
    label: "Paper tape",
    size: [160, 64],
    draw: (w, h) => {
      const a = n(h * 0.16);
      const q = n(w / 4);
      return [
        path(
          `M1 ${a} Q${q} ${n(a - a)} ${n(w / 2)} ${a} T${n(w - 1)} ${a}` +
            ` V${n(h - a)} Q${n(w - q)} ${n(h)} ${n(w / 2)} ${n(h - a)} T1 ${n(h - a)} Z`,
        ),
        mid(w, h, 0.12, 0.3),
      ];
    },
  },
  "win-pane": {
    label: "Internal storage",
    size: [160, 64],
    draw: (w, h) => {
      const x = n(Math.min(w * 0.2, 34));
      const y = n(Math.min(h * 0.3, 20));
      return [
        rect(1, 1, n(w - 2), n(h - 2)),
        rule(x, 1, x, n(h - 1)),
        rule(1, y, n(w - 1), y),
        label(n(x + 6), n(y + 4), n(w - x - 14), n(h - y - 8)),
      ];
    },
  },
  bolt: {
    label: "Communication link",
    size: [96, 76],
    draw: (w, h) => [
      path(
        `M${n(w * 0.62)} 1 L${n(w * 0.22)} ${n(h * 0.56)} H${n(w * 0.48)}` +
          ` L${n(w * 0.38)} ${n(h - 1)} L${n(w * 0.78)} ${n(h * 0.44)} H${n(w * 0.52)} Z`,
      ),
    ],
  },
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const wave = (w, h, top) =>
  `Q${n(w * 0.75)} ${n(h + (h - top) * 0.0)} ${n(w / 2)} ${n(top + (h - top) * 0.55)}` +
  ` T1 ${n(top)}`;

const docOutline = (w, h) => {
  const base = n(h * 0.8);
  return (
    `M1 1 H${n(w - 1)} V${base}` +
    ` Q${n(w * 0.74)} ${n(h + 2)} ${n(w / 2)} ${n(base + (h - base) * 0.45)}` +
    ` T1 ${base} Z`
  );
};

const DOCS = {
  doc: {
    label: "Document",
    size: [160, 64],
    draw: (w, h) => [
      path(docOutline(w, h)),
      label(n(w * 0.1), n(h * 0.12), n(w * 0.8), n(h * 0.56)),
    ],
  },
  "lin-doc": {
    label: "Lined document",
    size: [160, 64],
    draw: (w, h) => {
      const i = n(Math.min(12, w * 0.09));
      return [
        path(docOutline(w, h)),
        rule(i, 1, i, n(h * 0.86)),
        label(n(i + 6), n(h * 0.12), n(w - i - 14), n(h * 0.56)),
      ];
    },
  },
  docs: {
    label: "Multi-document",
    size: [160, 72],
    draw: (w, h) => {
      const o = n(Math.min(7, h * 0.12));
      return [
        path(
          docOutline(n(w - o), n(h - o)).replace(/^M1 1/, `M${n(o + 1)} 1`),
          { fill: "node.shade" },
        ),
        path(docOutline(n(w - o), n(h - o))),
        label(n(w * 0.1), n(h * 0.14), n(w * 0.72), n(h * 0.46)),
      ];
    },
  },
  "tag-doc": {
    label: "Tagged document",
    size: [160, 68],
    draw: (w, h) => {
      const t = n(Math.min(18, w * 0.14));
      return [
        path(docOutline(w, h)),
        path(`M1 ${n(h * 0.62)} L${t} ${n(h * 0.86)} H1 Z`, {
          fill: "node.ink",
          stroke: "none",
        }),
        label(n(w * 0.12), n(h * 0.12), n(w * 0.76), n(h * 0.5)),
      ];
    },
  },
  "tag-rect": {
    label: "Tagged process",
    size: [160, 52],
    draw: (w, h) => {
      const t = n(Math.min(18, w * 0.14));
      return [
        rect(1, 1, n(w - 2), n(h - 2)),
        path(`M1 ${n(h - t)} L${t} ${n(h - 1)} H1 Z`, {
          fill: "node.ink",
          stroke: "none",
        }),
        label(n(w * 0.12), n(h * 0.14), n(w * 0.76), n(h * 0.6)),
      ];
    },
  },
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
const cylBody = (w, h) => {
  const c = cap(h);
  return `M1 ${n(c)} V${n(h - c)} A${n(w / 2 - 1)} ${c} 0 0 0 ${n(w - 1)} ${n(h - c)} V${n(c)}`;
};

const STORE = {
  cyl: {
    label: "Database",
    size: [140, 88],
    draw: (w, h) => [
      path(cylBody(w, h)),
      ellipse(n(w / 2), n(cap(h)), n(w / 2 - 1), cap(h)),
      label(n(w * 0.12), n(cap(h) + 6), n(w * 0.76), n(h - cap(h) * 2 - 6)),
    ],
  },
  "h-cyl": {
    label: "Direct access storage",
    size: [150, 76],
    draw: (w, h) => {
      const c = n(Math.min(w * 0.14, 16));
      return [
        path(
          `M${c} 1 H${n(w - c)} A${c} ${n(h / 2 - 1)} 0 0 1 ${n(w - c)} ${n(h - 1)} H${c}`,
        ),
        ellipse(c, n(h / 2), c, n(h / 2 - 1)),
        label(n(c + 8), n(h * 0.2), n(w - c * 2 - 10), n(h * 0.6)),
      ];
    },
  },
  "lin-cyl": {
    label: "Disk storage",
    size: [140, 92],
    draw: (w, h) => {
      const c = cap(h);
      return [
        path(cylBody(w, h)),
        ellipse(n(w / 2), c, n(w / 2 - 1), c),
        path(
          `M1 ${n(c * 2.1)} A${n(w / 2 - 1)} ${c} 0 0 0 ${n(w - 1)} ${n(c * 2.1)}`,
          {
            fill: "none",
            stroke: "node.rule",
            width: 1.25,
          },
        ),
        label(n(w * 0.12), n(c * 2.6), n(w * 0.76), n(h - c * 3.4)),
      ];
    },
  },
  datastore: {
    label: "Data store",
    size: [150, 88],
    draw: (w, h) => {
      const c = cap(h);
      const i = n(Math.min(w * 0.16, 22));
      return [
        path(cylBody(w, h)),
        ellipse(n(w / 2), c, n(w / 2 - 1), c),
        rule(i, n(c * 1.4), i, n(h - c * 0.6)),
        label(n(i + 6), n(c + 6), n(w - i - 14), n(h - c * 2 - 6)),
      ];
    },
  },
  "bow-rect": {
    label: "Stored data",
    size: [160, 56],
    draw: (w, h) => {
      const c = n(Math.min(w * 0.12, 18));
      return [
        path(
          `M${c} 1 H${n(w - 1)} Q${n(w - c * 1.4)} ${n(h / 2)} ${n(w - 1)} ${n(h - 1)} H${c} Q1 ${n(h / 2)} ${c} 1 Z`,
        ),
        mid(w, h, 0.16),
      ];
    },
  },
};

// ---------------------------------------------------------------------------
// Annotation and free form
// ---------------------------------------------------------------------------
const braceLeft = (x, h, dir) => {
  const k = 9 * dir;
  return (
    `M${n(x + k)} 1 Q${n(x)} 1 ${n(x)} ${n(h * 0.2)}` +
    ` V${n(h * 0.42)} Q${n(x)} ${n(h / 2)} ${n(x - k)} ${n(h / 2)}` +
    ` Q${n(x)} ${n(h / 2)} ${n(x)} ${n(h * 0.58)}` +
    ` V${n(h * 0.8)} Q${n(x)} ${n(h - 1)} ${n(x + k)} ${n(h - 1)}`
  );
};

const ANNO = {
  brace: {
    label: "Comment",
    size: [160, 64],
    draw: (w, h) => [
      path(braceLeft(12, h, 1), { fill: "none" }),
      label(28, n(h * 0.16), n(w - 38), n(h * 0.68), { align: "left" }),
    ],
  },
  "brace-r": {
    label: "Comment (right)",
    size: [160, 64],
    draw: (w, h) => [
      path(braceLeft(n(w - 12), h, -1), { fill: "none" }),
      label(10, n(h * 0.16), n(w - 38), n(h * 0.68), { align: "left" }),
    ],
  },
  braces: {
    label: "Comment (both)",
    size: [170, 64],
    draw: (w, h) => [
      path(braceLeft(12, h, 1), { fill: "none" }),
      path(braceLeft(n(w - 12), h, -1), { fill: "none" }),
      label(26, n(h * 0.16), n(w - 52), n(h * 0.68)),
    ],
  },
  odd: {
    label: "Odd",
    size: [160, 48],
    draw: (w, h) => {
      const c = n(Math.min(w * 0.14, h * 0.5));
      return [
        path(`M1 1 H${n(w - 1)} V${n(h - 1)} H1 L${n(c + 1)} ${n(h / 2)} Z`),
        label(n(c + 8), n(h * 0.16), n(w - c - 18), n(h * 0.68)),
      ];
    },
  },
  bang: {
    label: "Bang",
    size: [150, 92],
    draw: (w, h) => {
      const X = (p) => n(w * p);
      const Y = (p) => n(h * p);
      return [
        path(
          `M${X(0.02)} ${Y(0.5)} L${X(0.16)} ${Y(0.22)} L${X(0.3)} ${Y(0.34)}` +
            ` L${X(0.45)} ${Y(0.03)} L${X(0.6)} ${Y(0.34)} L${X(0.76)} ${Y(0.16)}` +
            ` L${X(0.88)} ${Y(0.42)} L${X(0.99)} ${Y(0.6)} L${X(0.76)} ${Y(0.86)}` +
            ` L${X(0.54)} ${Y(0.72)} L${X(0.36)} ${Y(0.97)} L${X(0.16)} ${Y(0.78)} Z`,
        ),
        label(X(0.22), Y(0.38), X(0.56), Y(0.3)),
      ];
    },
  },
  cloud: {
    label: "Cloud",
    size: [160, 92],
    draw: (w, h) => {
      const X = (p) => n(w * p);
      const Y = (p) => n(h * p);
      return [
        path(
          `M${X(0.2)} ${Y(0.92)} Q${X(0.02)} ${Y(0.92)} ${X(0.05)} ${Y(0.64)}` +
            ` Q${X(0.05)} ${Y(0.42)} ${X(0.17)} ${Y(0.4)}` +
            ` Q${X(0.2)} ${Y(0.1)} ${X(0.4)} ${Y(0.14)}` +
            ` Q${X(0.5)} ${Y(0.0)} ${X(0.63)} ${Y(0.12)}` +
            ` Q${X(0.78)} ${Y(0.06)} ${X(0.83)} ${Y(0.34)}` +
            ` Q${X(0.99)} ${Y(0.36)} ${X(0.97)} ${Y(0.64)}` +
            ` Q${X(0.99)} ${Y(0.92)} ${X(0.8)} ${Y(0.92)} Z`,
        ),
        label(X(0.18), Y(0.36), X(0.64), Y(0.34)),
      ];
    },
  },
  note: {
    label: "Note",
    size: [160, 64],
    draw: (w, h) => {
      const f = n(Math.min(12, w * 0.2, h * 0.3)); // the folded corner
      return [
        path(
          `M1 1 H${n(w - 1 - f)} L${n(w - 1)} ${n(1 + f)} V${n(h - 1)} H1 Z`,
          { fill: "note.fill" },
        ),
        path(`M${n(w - 1 - f)} 1 V${n(1 + f)} H${n(w - 1)}`, {
          fill: "none",
          width: 1.25,
        }),
        label(10, 6, n(w - 20), n(h - 12), { size: 13, weight: 400 }),
      ];
    },
  },
  // The UML stick figure: a sequence diagram's `actor`. The name sits under
  // the figure rather than inside it.
  person: {
    label: "Actor",
    size: [96, 96],
    draw: (w, h) => {
      const band = n(Math.max(18, h * 0.36));
      const fh = h - band - 2; // the figure's height
      const cx = n(w / 2);
      const r = n(fh * 0.16);
      const neck = 1 + 2 * r;
      const hip = fh * 0.66;
      const arms = neck + (hip - neck) * 0.3;
      return [
        ellipse(cx, n(1 + r), r, r),
        path(
          `M${cx} ${n(neck)} V${n(hip)}` +
            ` M${n(cx - fh * 0.3)} ${n(arms)} H${n(cx + fh * 0.3)}` +
            ` M${n(cx - fh * 0.24)} ${n(fh)} L${cx} ${n(hip)} L${n(cx + fh * 0.24)} ${n(fh)}`,
          { fill: "none" },
        ),
        label(4, n(h - band), n(w - 8), n(band - 2)),
      ];
    },
  },
};

// ---------------------------------------------------------------------------
export const SHAPE_GROUPS = [
  ["term", "Terminators & junctions", TERM],
  ["proc", "Process & decision", PROC],
  ["io", "Input, output & manual", IO],
  ["doc", "Documents", DOCS],
  ["store", "Storage", STORE],
  ["anno", "Annotation & free form", ANNO],
];

export const SHAPES = SHAPE_GROUPS.reduce((acc, [group, , set]) => {
  for (const [key, def] of Object.entries(set))
    acc[key] = { ...def, key, group };
  return acc;
}, {});

export const SHAPE_KEYS = Object.keys(SHAPES);
export const DEFAULT_SHAPE = "rect";

export const shapeDef = (key) => SHAPES[key] ?? SHAPES[DEFAULT_SHAPE];
export const defaultSize = (key) => shapeDef(key).size;

// The whole Box contract, in four lines. A shape it has never heard of falls
// back to a rectangle rather than throwing — an unknown shape in an imported
// document should render as something, not blow up the canvas.
export const drawShape = (key, w, h) => shapeDef(key).draw(w, h);

// ---------------------------------------------------------------------------
// The extension contract.
//
// A third-party shape package exports { key, label, group, size, draw } and
// calls this. `draw` must be a pure function of (w, h) returning ops that
// reference theme TOKENS — never literal colours — so a document theme can
// restyle it without the package knowing the theme exists. Nothing in core
// changes; both walkers pick it up because both only ever see ops.
export function registerShape(def) {
  if (!def?.key || typeof def.draw !== "function") {
    throw new Error("registerShape: needs { key, draw(w, h) }");
  }
  const group = def.group ?? "custom";
  SHAPES[def.key] = {
    label: def.label ?? def.key,
    size: def.size ?? [160, 48],
    ...def,
    group,
  };
  if (!SHAPE_KEYS.includes(def.key)) SHAPE_KEYS.push(def.key);

  let bucket = SHAPE_GROUPS.find(([id]) => id === group);
  if (!bucket) {
    bucket = [group, def.groupLabel ?? "Custom", {}];
    SHAPE_GROUPS.push(bucket);
  }
  bucket[2][def.key] = SHAPES[def.key];
  return SHAPES[def.key];
}
