import { ViewportPortal } from "@xyflow/react";

// Interaction chrome, like the selection tint: drawn in the viewport so the
// lines sit in canvas coordinates, never part of any op-list or export.
const GUIDE_COLOR = "#f43f5e";

export default function AlignmentGuides({ guides }) {
  if (!guides.length) return null;

  return (
    <ViewportPortal>
      <svg
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          overflow: "visible",
          pointerEvents: "none",
          zIndex: 1000,
        }}
      >
        {guides.map((g) => {
          const [x1, y1, x2, y2] =
            g.axis === "x"
              ? [g.at, g.from, g.at, g.to]
              : [g.from, g.at, g.to, g.at];
          return (
            <line
              key={`${g.axis}${g.at}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={GUIDE_COLOR}
              strokeWidth={1}
              // one screen pixel at any zoom
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
    </ViewportPortal>
  );
}
