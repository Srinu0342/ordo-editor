// React walker: the SAME op-list -> JSX. The other half of the done-condition.
//
// The one deliberate divergence from the headless walker is the label op: here
// it becomes an absolutely-positioned HTML box rather than an SVG <text>, so
// the canvas gets real double-click editing, selection and IME support. Same
// op, same geometry, different medium — which is exactly what the op-list
// being geometry-plus-tokens rather than SVG strings buys.

import type { CSSProperties, ReactElement } from "react";
import { OP } from "../ops.ts";
import type { LabelOp, Op, Paint } from "../ops.ts";
import { LIGHT, resolve } from "../theme.ts";
import type { Theme } from "../theme.ts";

// A label op with the React key it renders under.
export type LabelSlot = LabelOp & { key: string };

const paint = (theme: Theme, o: Paint) => ({
  fill: resolve(theme, o.fill ?? "none"),
  stroke: resolve(theme, o.stroke ?? "none"),
  strokeWidth: o.stroke && o.stroke !== "none" ? o.width : undefined,
  strokeDasharray: o.dash || undefined,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
});

function mark(op: Op, theme: Theme, key: string): ReactElement | null {
  switch (op.op) {
    case OP.RECT:
      return (
        <rect
          key={key}
          x={op.x}
          y={op.y}
          width={op.w}
          height={op.h}
          rx={op.rx || undefined}
          {...paint(theme, op)}
        />
      );
    case OP.ELLIPSE:
      return (
        <ellipse
          key={key}
          cx={op.cx}
          cy={op.cy}
          rx={op.rx}
          ry={op.ry}
          {...paint(theme, op)}
        />
      );
    case OP.PATH:
      return <path key={key} d={op.d} {...paint(theme, op)} />;
    case OP.LINE:
      return (
        <line
          key={key}
          x1={op.x1}
          y1={op.y1}
          x2={op.x2}
          y2={op.y2}
          {...paint(theme, op)}
        />
      );
    case OP.GROUP:
      return (
        <g key={key}>
          {(op.children ?? []).map((c, i) => mark(c, theme, `${key}.${i}`))}
        </g>
      );
    default:
      return null;
  }
}

// Splits the op-list into drawable marks and label slots. The node component
// renders the marks inside one <svg> and the slots as HTML on top.
export function walk(ops: Op[], theme: Theme = LIGHT) {
  const marks: ReactElement[] = [];
  const labels: LabelSlot[] = [];

  const visit = (list: Op[], prefix: string) =>
    list.forEach((op, i) => {
      const key = `${prefix}${i}`;
      if (!op) return;
      if (op.op === OP.LABEL) labels.push({ ...op, key });
      else if (op.op === OP.GROUP) visit(op.children ?? [], `${key}.`);
      else {
        const el = mark(op, theme, key);
        if (el) marks.push(el);
      }
    });

  visit(ops, "");
  return { marks, labels };
}

// Geometry for a label slot as CSS, in the node's own percentage space so it
// tracks a resize without a re-measure.
export const labelBox = (
  op: LabelOp,
  w: number,
  h: number,
  theme: Theme = LIGHT,
): CSSProperties => ({
  position: "absolute",
  left: `${(op.x / w) * 100}%`,
  top: `${(op.y / h) * 100}%`,
  width: `${(op.w / w) * 100}%`,
  height: `${(op.h / h) * 100}%`,
  display: "flex",
  alignItems:
    op.valign === "top"
      ? "flex-start"
      : op.valign === "bottom"
        ? "flex-end"
        : "center",
  justifyContent:
    op.align === "left"
      ? "flex-start"
      : op.align === "right"
        ? "flex-end"
        : "center",
  fontSize: op.size,
  fontWeight: op.weight,
  color: resolve(theme, op.fill),
  overflow: "hidden",
  pointerEvents: "none",
});
