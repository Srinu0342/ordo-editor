// Edge appearance, kept separate from edge ROUTE. Route is structural (which
// path generator runs); everything here is theme. Same cut the shape registry
// draws for nodes.

export const STROKE_SWATCHES = [
  "#0f172a",
  "#6366f1",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#94a3b8",
];

export const STROKE_WEIGHTS = [1, 1.5, 2, 3, 4];

// `dash` is an SVG stroke-dasharray, so "" means solid.
export const LINE_TYPES = [
  { key: "solid", label: "Solid", dash: "" },
  { key: "dashed", label: "Dashed", dash: "8 4" },
  { key: "dotted", label: "Dotted", dash: "1 5" },
];

export const DEFAULT_EDGE_STYLE = {
  stroke: "#0f172a",
  strokeWidth: 1.5,
  dash: "",
  markerStart: "none",
  markerEnd: "arrow-filled",
  route: "step",
};

export const lineTypeOf = (dash) =>
  LINE_TYPES.find((t) => t.dash === (dash ?? ""))?.key ?? "solid";

// The one place that knows how the style model maps onto SVG attributes.
// Returned fresh each call so a previous strokeDasharray can never survive.
export const toEdgeStyleProps = ({ stroke, strokeWidth, dash }) => ({
  stroke,
  strokeWidth,
  ...(dash ? { strokeDasharray: dash } : {}),
});

// Route lands on edge.type (React Flow resolves the component from it); paint
// lands on style; markers land on data, because both ends are independently
// valued strings and React Flow's own markerStart/markerEnd would flatten that.
export const applyEdgeStyle = (edge, s) => ({
  ...edge,
  type: s.route,
  style: toEdgeStyleProps(s),
  data: { ...edge.data, markerStart: s.markerStart, markerEnd: s.markerEnd },
});

export const newEdge = (connection, s) =>
  applyEdgeStyle({ ...connection, data: { label: "" } }, s);
