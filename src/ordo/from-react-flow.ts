import type { Edge, Node } from "@xyflow/react";
import {
  GROUP_TYPE,
  RUNTIME_EDGE_KEYS,
  RUNTIME_NODE_KEYS,
  authoredSize,
  canonicalShape,
  canvasNode,
  isRoute,
  readEdge,
  readGeometry,
  readNode,
  rfEdge,
  rfNode,
  toOrdoHandle,
} from "./rf-mapping.ts";
import {
  DEFAULTS,
  ID_PATTERN,
  LABELLED,
  type Diagnostic,
  type OrdoLayoutFile,
  type ResolvedDiagram,
  type ResolvedEdge,
  type ResolvedNode,
} from "./types.ts";

// Canvas -> resolved model plus layout, and the proof that nothing is lost.
//
// Export first works out exactly what the two files will hold. It then
// rebuilds every node and edge from that with rfNode and rfEdge, and compares
// each one with the canvas, field by field. Any difference is a canvas-lossy
// error naming the field, so nothing on the canvas is dropped or changed
// silently. Only React Flow's own runtime fields are exempt (rf-mapping.ts).

export interface FromReactFlowResult {
  diagram: ResolvedDiagram;
  layout: OrdoLayoutFile;
  diagnostics: Diagnostic[]; // any error means: show diagnostics, write nothing
}

type Obj = Record<string, unknown>;

const err = (code: Diagnostic["code"], message: string): Diagnostic => ({
  severity: "error",
  code,
  message,
  file: "canvas",
});
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const absent = (v: unknown) => v === undefined || v === null;
const show = (v: unknown) => (absent(v) ? "absent" : JSON.stringify(v));

function same(a: unknown, b: unknown): boolean {
  if (absent(a) && absent(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b.at(i)));
  if (isObj(a) && isObj(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => same(a[k], b[k]));
  return a === b;
}

/** Dotted paths where `a` and `b` differ, descending into plain objects so messages name the exact field. */
function differences(a: unknown, b: unknown, path: string, out: string[]) {
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      differences(a[k], b[k], path ? `${path}.${k}` : k, out);
  } else if (!same(a, b)) out.push(path);
}

// Ids are keys in the layout's maps, and `__proto__` is a valid id: assigned
// with `=` it would set the prototype instead of adding an entry.
const put = <T>(o: Record<string, T>, key: string, value: T) =>
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });

const at = (o: unknown, path: string) => path.split(".").reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o);

function lossless(kind: "node" | "edge", canvas: Obj, rebuilt: Obj, runtime: ReadonlySet<string>, out: Diagnostic[]) {
  const a: Obj = {};
  const b: Obj = {};
  for (const [k, v] of Object.entries(canvas)) if (!runtime.has(k)) a[k] = v;
  for (const [k, v] of Object.entries(rebuilt)) if (!runtime.has(k)) b[k] = v;
  const paths: string[] = [];
  differences(a, b, "", paths);
  for (const p of paths)
    out.push(
      err(
        "canvas-lossy",
        `${kind} "${String(canvas.id)}": ${p} is ${show(at(a, p))} on the canvas but would be ${show(at(b, p))} after export and import`,
      ),
    );
}

export function fromReactFlow(nodes: Node[], edges: Edge[]): FromReactFlowResult {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  const claim = (id: string) => {
    if (!ID_PATTERN.test(id)) diagnostics.push(err("canvas-bad-id", `id "${id}" does not match ${ID_PATTERN}`));
    if (ids.has(id)) diagnostics.push(err("duplicate-id", `id "${id}" is used more than once`));
    ids.add(id);
  };

  const edgeIds = new Set(edges.map((e) => e.id));
  for (const n of nodes) {
    claim(n.id);
    const d = readNode(n);
    // Every node type the editor has is a kind in the format; only a type it
    // does not have (one from outside the editor) cannot be written.
    if (d.kind === undefined)
      diagnostics.push(err("canvas-unsupported", `node "${n.id}" has type "${n.type}", which the editor does not have`));
    else {
      if (d.label !== undefined && typeof d.label !== "string")
        diagnostics.push(err("canvas-lossy", `node "${n.id}": label is not a string`));
      // A box's outline must be a registry key: anything else draws as a
      // rectangle on the canvas and would not read back as what it says.
      if (d.kind === "box" && d.shape !== undefined && (typeof d.shape !== "string" || canonicalShape(d.shape) !== d.shape))
        diagnostics.push(err("canvas-unsupported", `node "${n.id}" has shape ${JSON.stringify(d.shape)}, which the format does not know`));
      if (d.attach && !edgeIds.has(String(d.attach.edgeId)))
        diagnostics.push(err("canvas-dangling-edge", `tube "${n.id}" rides "${String(d.attach.edgeId)}", which is not on the canvas`));
    }
    if (n.parentId !== undefined) {
      const p = byId.get(n.parentId);
      if (!p) diagnostics.push(err("canvas-bad-parent", `node "${n.id}": parent "${n.parentId}" does not exist`));
      else if (p.type !== GROUP_TYPE)
        diagnostics.push(err("canvas-bad-parent", `node "${n.id}": parent "${n.parentId}" is not a group`));
    }
  }
  for (const e of edges) {
    claim(e.id);
    // An edge's type is its route (edges/routers.ts), and every route is in the format.
    if (!isRoute(e.type))
      diagnostics.push(err("canvas-unsupported", `edge "${e.id}" has type "${e.type}", which is not one of the editor's routes`));
    const { label } = readEdge(e);
    if (label !== undefined && typeof label !== "string")
      diagnostics.push(err("canvas-lossy", `edge "${e.id}": label is not a string`));
    if (!byId.has(e.source) || !byId.has(e.target))
      diagnostics.push(err("canvas-dangling-edge", `edge "${e.id}" points at a missing node`));
  }

  // Pre-order: roots in array order, then each node's children in array order.
  const kids = new Map<string | null, Node[]>();
  for (const n of nodes) {
    const siblings = kids.get(n.parentId ?? null);
    if (siblings) siblings.push(n);
    else kids.set(n.parentId ?? null, [n]);
  }
  const ordered: Node[] = [];
  const visited = new Set<Node>(); // a duplicated id must not send this round in circles
  const visit = (pid: string | null) =>
    (kids.get(pid) ?? []).forEach((n) => {
      if (visited.has(n)) return;
      visited.add(n);
      ordered.push(n);
      visit(n.id);
    });
  visit(null);
  if (ordered.length !== nodes.length && !diagnostics.some((d) => d.code === "canvas-bad-parent"))
    diagnostics.push(err("canvas-bad-parent", "the parent chain contains a cycle"));

  const layout: OrdoLayoutFile = { "ordo-layout": 1, nodes: {}, edges: {} };
  const empty = { diagram: { nodes: [], edges: [] }, layout, diagnostics };
  if (diagnostics.some((d) => d.severity === "error")) return empty;

  const resolvedNodes = ordered.map((n): ResolvedNode => {
    const d = readNode(n);
    const kind = d.kind!;
    const isGroup = kind === "group";
    const label = typeof d.label === "string" ? d.label : LABELLED.has(kind) ? n.id : undefined;
    return {
      id: n.id,
      parent: n.parentId ?? null,
      isGroup,
      kind,
      ...(label !== undefined ? { label } : {}),
      shape: kind === "box" && typeof d.shape === "string" ? d.shape : DEFAULTS.shape,
      ...(typeof d.type === "string" ? { type: d.type } : {}),
      ...d.fields,
      ...(d.attach ? { attach: String(d.attach.edgeId) } : {}),
    };
  });
  const resolvedEdges = edges.map((e): ResolvedEdge => {
    const { label, ...d } = readEdge(e);
    return {
      id: e.id,
      from: e.source,
      to: e.target,
      ...(typeof label === "string" && label !== "" ? { label } : {}),
      ...d,
    };
  });

  for (const n of ordered) {
    const size = authoredSize(n);
    put(layout.nodes!, n.id, {
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      ...(size ? { w: size.w, h: size.h } : {}),
      ...readGeometry(n),
    });
  }
  for (const e of edges) {
    const from = e.sourceHandle ?? undefined;
    const to = e.targetHandle ?? undefined;
    const z = typeof e.zIndex === "number" ? e.zIndex : undefined;
    if (from !== undefined || to !== undefined || z !== undefined)
      put(layout.edges!, e.id, {
        ...(from !== undefined ? { from: toOrdoHandle(from) } : {}),
        ...(to !== undefined ? { to: toOrdoHandle(to) } : {}),
        ...(z !== undefined ? { z } : {}),
      });
  }

  // Lossless guarantee: rebuild every object from exactly what will be written. Any field that does
  // not come back the same (apart from React Flow's own runtime fields) would be lost, so refuse.
  resolvedNodes.forEach((rn, i) =>
    lossless("node", canvasNode(ordered[i]), rfNode(rn, layout.nodes![rn.id]) as Obj, RUNTIME_NODE_KEYS, diagnostics),
  );
  resolvedEdges.forEach((re, i) =>
    lossless(
      "edge",
      edges[i] as Obj,
      rfEdge(re, Object.hasOwn(layout.edges!, re.id) ? layout.edges![re.id] : undefined) as Obj,
      RUNTIME_EDGE_KEYS,
      diagnostics,
    ),
  );
  if (diagnostics.some((d) => d.severity === "error")) return empty;

  return { diagram: { nodes: resolvedNodes, edges: resolvedEdges }, layout, diagnostics };
}
