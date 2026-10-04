import {
  getStraightPath,
  getSmoothStepPath,
  getBezierPath,
} from "@xyflow/react";

// Routing is the ONLY structural axis an edge has. Dash, width, colour, the
// markers at each end and the label are all theme properties resolved at draw
// time — so there are exactly three edge components, not one per visual
// variant, and the same cut that keeps Box at one component keeps these at
// three.

export const ROUTES = {
  straight: {
    label: "Straight",
    hint: "Point to point, no bend",
    run: (p) => getStraightPath(p),
  },
  orthogonal: {
    label: "Orthogonal",
    hint: "Right angles only",
    run: (p) => getSmoothStepPath({ ...p, borderRadius: 0 }),
  },
  step: {
    label: "Rounded step",
    hint: "Right angles, softened corners",
    run: (p) => getSmoothStepPath({ ...p, borderRadius: 8 }),
  },
  curved: {
    label: "Curved",
    hint: "Bezier, tangent to the anchor",
    run: (p) => getBezierPath(p),
  },
};

export const ROUTE_KEYS = Object.keys(ROUTES);
export const DEFAULT_ROUTE = "step";

// getStraightPath ignores the Position fields but takes the same object, so
// every router shares one call signature and the edge component never branches.
export const route = (key, params) =>
  (ROUTES[key] ?? ROUTES[DEFAULT_ROUTE]).run(params);
