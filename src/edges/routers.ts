import {
  getStraightPath,
  getSmoothStepPath,
  getBezierPath,
} from "@xyflow/react";
import type { Position } from "@xyflow/react";

// Both ends of an edge, as React Flow hands them to an edge component.
export type RouteParams = {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
};

type RouteDef = {
  label: string;
  hint: string;
  // [path, labelX, labelY, offsetX, offsetY], as every React Flow router returns
  run: (p: RouteParams) => ReturnType<typeof getStraightPath>;
};

// Routing is the ONLY structural axis an edge has. Dash, width, colour, the
// markers at each end and the label are all theme properties resolved at draw
// time — so there are exactly three edge components, not one per visual
// variant, and the same cut that keeps Box at one component keeps these at
// three.

export const ROUTES: Record<string, RouteDef> = {
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
export const route = (key: string, params: RouteParams) =>
  (ROUTES[key] ?? ROUTES[DEFAULT_ROUTE]).run(params);
