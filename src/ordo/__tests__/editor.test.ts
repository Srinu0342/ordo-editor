// Everything the editor itself can put on the canvas converts to Ordo YAML and
// back: every palette kind, the edits each kind's component makes, every line
// the toolbar can draw, paste and duplicate. Nothing here is refused, because
// every node type and every edge route has a place in the format.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Edge, Node } from "@xyflow/react";

import { emptySession, exportOrdo, importOrdo, idMinter } from "../index.ts";
import { EDGE_ROUTES, MARKERS } from "../types.ts";
import { RUNTIME_EDGE_KEYS, RUNTIME_NODE_KEYS, canvasNode, connectionEdge, markerKey, markerOf, rfNode } from "../rf-mapping.ts";
import { NODE_TYPE_DEFAULTS, makeNode } from "../../nodes/defaults.ts";
import { SHAPE_KEYS } from "../../shapes/registry.ts";
import { DEFAULT_EDGE_STYLE, LINE_TYPES, STROKE_SWATCHES, STROKE_WEIGHTS } from "../../edgeStyle.ts";
import { ROUTE_KEYS } from "../../edges/routers.ts";
import { MARKER_KEYS } from "../../edges/markers.tsx";
import { cloneGraph, copySelection } from "../../selection.ts";
import type { EdgeStyle } from "../../edgeStyle.ts";

const PALETTE_KINDS = [...SHAPE_KEYS, ...Object.keys(NODE_TYPE_DEFAULTS)];

const strip = (o: object, runtime: ReadonlySet<string>) =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => !runtime.has(k) && v !== undefined));
const canon = (nodes: Node[], edges: Edge[]) => ({
  nodes: Object.fromEntries(nodes.map((n) => [n.id, strip(canvasNode(n), RUNTIME_NODE_KEYS)])),
  edges: Object.fromEntries(edges.map((e) => [e.id, strip(e, RUNTIME_EDGE_KEYS)])),
});

/** Export, import, and the canvas is the same; export again, and the bytes are the same. */
function roundTrip(nodes: Node[], edges: Edge[]) {
  const out = exportOrdo(nodes, edges, emptySession());
  assert.deepEqual(out.diagnostics, [], out.diagnostics.map((d) => d.message).join("\n"));
  const back = importOrdo(out.ordo!.text, out.layout!.text);
  assert.deepEqual(back.diagnostics, []);
  assert.deepEqual(canon(back.nodes, back.edges), canon(nodes, edges));
  const again = exportOrdo(back.nodes, back.edges, { name: "diagram", ordo: back.ordo, layout: back.layout });
  assert.equal(again.ordo?.text, out.ordo!.text);
  assert.equal(again.layout?.text, out.layout!.text);
  return out;
}

const at = (i: number) => ({ x: (i % 8) * 200, y: Math.floor(i / 8) * 200 });

// ---------------------------------------------------------------------------
// The format's vocabularies are the editor's

test("every route the editor has is a route in the format", () => {
  assert.deepEqual([...EDGE_ROUTES].sort(), [...ROUTE_KEYS].sort());
});

test("every marker the editor has is a marker in the format, both ways", () => {
  for (const key of MARKER_KEYS) assert.equal(markerKey(markerOf(key)!), key, key);
  assert.equal(MARKERS.length, MARKER_KEYS.length);
});

test("rfNode builds every palette kind exactly as the palette does", () => {
  const expected = (kind: string) => {
    const made = makeNode(kind, { id: "n1", position: { x: 40, y: 80 } });
    const back = importOrdo(exportOrdo([made], [], emptySession()).ordo!.text).nodes[0];
    return { made, back };
  };
  for (const kind of PALETTE_KINDS) {
    const { made } = expected(kind);
    const out = exportOrdo([made], [], emptySession());
    assert.deepEqual(out.diagnostics, [], kind);
    const back = importOrdo(out.ordo!.text, out.layout!.text).nodes[0];
    assert.deepEqual(back, made, kind);
  }
  // and rfNode is the constructor behind it
  assert.deepEqual(
    rfNode({ id: "n1", parent: null, isGroup: false, kind: "box", label: "", shape: "rect" }, { x: 40, y: 80 }),
    makeNode("rect", { id: "n1", position: { x: 40, y: 80 } }),
  );
});

// ---------------------------------------------------------------------------
// The palette, and the edits each kind's component makes

test("one of every palette kind on one canvas", () => {
  roundTrip(
    PALETTE_KINDS.map((kind, i) => makeNode(kind, { id: `n${i + 1}`, position: at(i) })),
    [],
  );
});

test("the edits each node component makes", () => {
  const box = makeNode("cyl", { id: "n1", position: { x: 10.4, y: 20.6 } });
  box.data.label = "Postgres\nprimary";
  Object.assign(box, { width: 200, height: 120 }); // a NodeResizer drag

  const group = makeNode("container", { id: "n2", position: { x: 400, y: 0 } });
  group.data.label = "Production VPC";
  Object.assign(group, { width: 500, height: 300 });
  const child = makeNode("rect", { id: "n3", position: { x: 24, y: 56 }, parentId: "n2" });

  const text = makeNode("label", { id: "n4", position: { x: 0, y: 300 } });
  text.data.label = "a note on the side";

  const cls = makeNode("compartment", { id: "n5", position: { x: 0, y: 400 } });
  cls.data = { ...cls.data, label: "Order", sections: [["id: uuid", "total: money"], ["pay()", "refund()"], []] };

  const tube = makeNode("tube", { id: "n6", position: { x: 700, y: 400 } });
  tube.data = { ...tube.data, slots: 5, rotation: 30, align: false };

  const frame = makeNode("fragment", { id: "n7", position: { x: 900, y: 0 } });
  frame.data = { ...frame.data, operator: "alt", guards: ["ok", "declined"], dividers: [90], fill: "rgb(230, 240, 255)" };
  frame.zIndex = 3;

  roundTrip([box, group, child, text, cls, tube, frame], []);
});

test("a tube riding an edge, with taps pinned, set off to one side", () => {
  const head = makeNode("rect", { id: "n1", position: { x: 0, y: 0 } });
  const foot = makeNode("rect", { id: "n2", position: { x: 0, y: 600 } });
  const life = connectionEdge({ source: "n1", target: "n2", sourceHandle: "s", targetHandle: "n" }, "e1", {
    ...DEFAULT_EDGE_STYLE,
    route: "straight",
    dash: "8 4",
    stroke: "#94a3b8",
    markerEnd: "none",
  });
  const bar = makeNode("tube", { id: "n3", position: { x: 67.25, y: 180.5 } });
  bar.data = { taps: [12, 40, 96], attach: { edgeId: "e1", t: 0.37, angle: 90, shift: 8 } };
  const out = roundTrip([head, foot, bar], [life]);
  assert.match(out.ordo!.text, /attach: e1/);
  assert.match(out.layout!.text, /n3: \{ x: 67, y: 181, t: 0\.37, shift: 8, angle: 90 \}/);
});

test("paste and duplicate mint fresh n<k> / e<k> ids, and the copies export", () => {
  const a = makeNode("rect", { id: "n1", position: { x: 0, y: 0 } });
  const b = makeNode("diam", { id: "n2", position: { x: 300, y: 0 } });
  a.selected = b.selected = true;
  const e = connectionEdge({ source: "n1", target: "n2", sourceHandle: "e", targetHandle: "w" }, "e1", DEFAULT_EDGE_STYLE);
  const clip = copySelection({
    nodes: [a, b],
    edges: [e],
    absRect: (id) => ({ ...(id === "n1" ? a : b).position, width: 160, height: 48 }),
  })!;
  const mint = idMinter(["n1", "n2", "e1"]);
  const copy = cloneGraph(clip, { newNodeId: mint.node, newEdgeId: mint.edge, dx: 0, dy: 200 });
  assert.deepEqual(copy.nodes.map((n) => n.id), ["n3", "n4"]);
  assert.deepEqual(copy.edges.map((x) => x.id), ["e2"]);
  roundTrip([a, b, ...copy.nodes], [e, ...copy.edges]);
});

// ---------------------------------------------------------------------------
// Every line the toolbar can draw

test("every route × line type × colour × weight the toolbar offers", () => {
  const nodes = [makeNode("rect", { id: "n1", position: { x: 0, y: 0 } }), makeNode("rect", { id: "n2", position: { x: 400, y: 0 } })];
  const edges: Edge[] = [];
  for (const route of ROUTE_KEYS)
    for (const type of LINE_TYPES)
      for (const stroke of STROKE_SWATCHES)
        for (const strokeWidth of STROKE_WEIGHTS) {
          const style: EdgeStyle = { ...DEFAULT_EDGE_STYLE, route, dash: type.dash, stroke, strokeWidth };
          edges.push(connectionEdge({ source: "n1", target: "n2", sourceHandle: "e", targetHandle: "w" }, `e${edges.length + 1}`, style));
        }
  assert.equal(edges.length, ROUTE_KEYS.length * LINE_TYPES.length * STROKE_SWATCHES.length * STROKE_WEIGHTS.length);
  roundTrip(nodes, edges);
});

test("every marker at either end, a label, its placement, a hidden link, a stacking order", () => {
  const nodes = [makeNode("rect", { id: "n1", position: { x: 0, y: 0 } }), makeNode("rect", { id: "n2", position: { x: 400, y: 0 } })];
  const edges: Edge[] = [];
  for (const markerStart of MARKER_KEYS)
    for (const markerEnd of MARKER_KEYS)
      edges.push(
        connectionEdge({ source: "n1", target: "n2", sourceHandle: null, targetHandle: null }, `e${edges.length + 1}`, {
          ...DEFAULT_EDGE_STYLE,
          markerStart,
          markerEnd,
        }),
      );
  const last = edges[edges.length - 1];
  Object.assign(last, { hidden: true, zIndex: 7, data: { ...last.data, label: "pay: now # 1", labelPlacement: "above" } });
  roundTrip(nodes, edges);
});
