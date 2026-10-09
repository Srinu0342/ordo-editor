// The Ordo format end to end, ported from the build spec's reference tests:
// GetPut, PutGet, diff locality (the line counts are the spec's table, exact),
// lossless-or-refused, the validator, generation and prefill — plus parity with
// the editor's own constructors, which export relies on to check itself.
//
// The spec's operations were written against placeholder React Flow
// conventions; here they speak this editor's (rf-mapping.ts): a leaf is a `box`
// with a registry shape, a group is a `container`, a resize writes top-level
// width/height beside the style size, and markers and edge labels live in data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diffLines } from "diff";
import type { Edge, Node } from "@xyflow/react";

import { detectStyle, emptySession, exportOrdo, importOrdo, readDiagram } from "../index.ts";
import type { OrdoSession } from "../index.ts";
import { fromReactFlow } from "../from-react-flow.ts";
import { connectionEdge, rfEdge, rfNode } from "../rf-mapping.ts";
import { resolve } from "../read.ts";
import { parseAllDocuments } from "yaml";
import { TUBE_TYPE } from "../../nodes/tube.ts";
import { makeNode, sizeOfNode, textSize } from "../../nodes/defaults.ts";
import { SHAPE_KEYS } from "../../shapes/registry.ts";
import { DEFAULT_EDGE_STYLE, newEdge } from "../../edgeStyle.ts";
import type { OrdoLayoutFile, ResolvedDiagram } from "../types.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const ORDO = fixture("checkout.yml");
const LAYOUT = fixture("checkout.layout.yml");
const BROKEN = fixture("broken.yml");

// The fixture pair, imported the way the Import  Ordo YAML dialog does it.
function imported() {
  const result = importOrdo(ORDO, LAYOUT);
  assert.deepEqual(result.diagnostics, []);
  const session: OrdoSession = { name: "checkout", ordo: result.ordo, layout: result.layout };
  return { nodes: result.nodes as Node[], edges: result.edges as Edge[], session };
}

function count(a: string, b: string) {
  let del = 0;
  let add = 0;
  for (const p of diffLines(a, b)) {
    if (p.added) add += p.count ?? 0;
    else if (p.removed) del += p.count ?? 0;
  }
  return { del, add };
}

const canon = (d: ResolvedDiagram) => ({
  nodes: [...d.nodes].sort((a, b) => a.id.localeCompare(b.id)),
  edges: [...d.edges].sort((a, b) => a.id.localeCompare(b.id)),
});
const canonLayout = (l: OrdoLayoutFile | null) => ({ nodes: { ...l?.nodes }, edges: { ...l?.edges } });

const node = (n: Node[], id: string) => n.find((x) => x.id === id)!;
const edge = (e: Edge[], id: string) => e.find((x) => x.id === id)!;
type Op = (n: Node[], e: Edge[]) => [Node[], Edge[]];
type Lines = { del: number; add: number };
const L = (del: number, add: number): Lines => ({ del, add });

/** Each must export with exactly these line counts (.yml, .layout.yml), and pass PutGet. */
const OPS: [name: string, ordo: Lines, layout: Lines, op: Op][] = [
  ["Move a node (api)", L(0, 0), L(1, 1), (n, e) => {
    node(n, "api").position.x += 40;
    return [n, e];
  }],
  ["Move a group (services)", L(0, 0), L(1, 1), (n, e) => {
    node(n, "services").position.y += 20;
    return [n, e];
  }],
  // A NodeResizer drag: React Flow writes width on the node itself, beside the
  // style size the import gave it.
  ["Resize a group (vpc)", L(0, 0), L(1, 1), (n, e) => {
    const vpc = node(n, "vpc");
    vpc.width = (vpc.style!.width as number) + 40;
    return [n, e];
  }],
  ["Rename a label (api, has data)", L(1, 1), L(0, 0), (n, e) => {
    node(n, "api").data.label = "Checkout API";
    return [n, e];
  }],
  ["Rename a label (queue, no data yet)", L(0, 2), L(0, 0), (n, e) => {
    node(n, "queue").data.label = "Order events";
    return [n, e];
  }],
  ["Add an edge (no label)", L(0, 1), L(0, 0), (n, e) => [
    n,
    [...e, rfEdge({ id: "e5", from: "client", to: "queue", line: "solid", start: "none", end: "arrow" })],
  ]],
  ["Add a node at root", L(0, 4), L(0, 1), (n, e) => [
    [...n, rfNode({ id: "cache", parent: null, isGroup: false, label: "Redis", shape: "cyl" }, { x: 840, y: 320 })],
    e,
  ]],
  ["Drag db out of services", L(2, 2), L(1, 1), (n, e) => {
    const db = node(n, "db");
    delete db.parentId;
    db.position = { x: 840, y: 420 };
    return [n, e];
  }],
  ["Change edge line (e3 -> thick)", L(0, 1), L(0, 0), (n, e) => [
    n,
    e.map((x) =>
      x.id === "e3"
        ? rfEdge({ id: "e3", from: "api", to: "db", label: "query", line: "thick", start: "none", end: "arrow" })
        : x,
    ),
  ]],
  ["Delete an edge (e4)", L(4, 0), L(3, 0), (n, e) => [n, e.filter((x) => x.id !== "e4")]],
  ["Delete a node (queue, cascades e4)", L(5, 0), L(4, 0), (n, e) => [
    n.filter((x) => x.id !== "queue"),
    e.filter((x) => x.source !== "queue" && x.target !== "queue"),
  ]],
  ["Wrap client in a new group", L(1, 4), L(1, 2), (n, e) => {
    const g = rfNode(
      { id: "edge-zone", parent: null, isGroup: true, label: "Edge network", shape: "rect" },
      { x: -20, y: 120, w: 200, h: 120 },
    );
    const c = node(n, "client");
    c.parentId = "edge-zone";
    c.position = { x: 20, y: 40 };
    return [[g, ...n], e];
  }],
  ["Select, drag state or measurement only", L(0, 0), L(0, 0), (n, e) => {
    const a = node(n, "api");
    a.selected = true;
    a.dragging = false;
    a.resizing = false;
    a.measured = { width: 163, height: 57 };
    edge(e, "e3").selected = true;
    return [n, e];
  }],
  ["Move to a fractional position", L(0, 0), L(1, 1), (n, e) => {
    node(n, "api").position = { x: 64.4, y: 55.6 };
    return [n, e];
  }],
];

/** Each must produce no output and exactly one error, naming the field. */
const MUST_REFUSE: [name: string, field: string, op: Op][] = [
  ["data field the format lacks", "data.color", (n, e) => {
    node(n, "api").data.color = "red";
    return [n, e];
  }],
  ["node locked (draggable: false)", "draggable", (n, e) => {
    node(n, "api").draggable = false;
    return [n, e];
  }],
  ["React Flow's own arrowhead object", "markerEnd", (n, e) => {
    edge(e, "e3").markerEnd = { type: "arrowclosed" } as never;
    return [n, e];
  }],
  // This editor's edges carry their stroke in `style`; one built by hand without
  // rfEdge (or newEdge) is missing it.
  ["edge built without rfEdge", "style", (n, e) => [
    n,
    [...e, {
      id: "e5",
      type: "step",
      source: "client",
      target: "queue",
      data: { label: "", markerStart: "none", markerEnd: "arrow-filled" },
    }],
  ]],
  ["data changed without rebuilding the edge", "data.line", (n, e) => {
    (edge(e, "e3").data as Record<string, unknown>).line = "thick";
    return [n, e];
  }],
  ["node type the editor does not have", "lifeline", (n, e) => [
    [...n, { id: "lifeline1", type: "lifeline", position: { x: 0, y: 0 }, data: {} }],
    e,
  ]],
];

// ---------------------------------------------------------------------------
// 1. GetPut

test("GetPut: the fixture pair exports back byte-identical", () => {
  const { nodes, edges, session } = imported();
  const out = exportOrdo(nodes, edges, session);
  assert.deepEqual(out.diagnostics, []);
  assert.equal(out.ordo?.text, ORDO);
  assert.equal(out.layout?.text, LAYOUT);
});

test("exporting twice from one canvas is byte-identical", () => {
  const { nodes, edges, session } = imported();
  const first = exportOrdo(nodes, edges, session);
  const second = exportOrdo(nodes, edges, { ...session, ordo: first.ordo!.doc, layout: first.layout!.doc });
  assert.equal(second.ordo?.text, first.ordo?.text);
  assert.equal(second.layout?.text, first.layout?.text);
});

// ---------------------------------------------------------------------------
// 2 and 3. PutGet and diff locality, for every canvas operation

const show = ({ del, add }: Lines) => (del || add ? [del && `-${del}`, add && `+${add}`].filter(Boolean).join(" ") : "0");

for (const [name, ordoLines, layoutLines, op] of OPS) {
  test(`${name}: .yml ${show(ordoLines)}, .layout.yml ${show(layoutLines)}, and it reads back`, () => {
    const { nodes, edges, session } = imported();
    const [n, e] = op(structuredClone(nodes), structuredClone(edges));
    const out = exportOrdo(n, e, session);
    assert.deepEqual(out.diagnostics, []);
    assert.deepEqual(count(ORDO, out.ordo!.text), ordoLines, ".yml lines");
    assert.deepEqual(count(LAYOUT, out.layout!.text), layoutLines, ".layout.yml lines");

    // PutGet: re-import, and the canvas says the same thing (sibling order
    // carries no meaning in v1, so both sides are sorted by id).
    const back = importOrdo(out.ordo!.text, out.layout!.text);
    assert.deepEqual(back.diagnostics, []);
    const before = fromReactFlow(n, e);
    const after = fromReactFlow(back.nodes, back.edges);
    assert.deepEqual(canon(after.diagram), canon(before.diagram));
    assert.deepEqual(canonLayout(after.layout), canonLayout(before.layout));
  });
}

// ---------------------------------------------------------------------------
// 4. Lossless or refused

for (const [name, field, op] of MUST_REFUSE) {
  test(`refused: ${name}`, () => {
    const { nodes, edges, session } = imported();
    const [n, e] = op(structuredClone(nodes), structuredClone(edges));
    const out = exportOrdo(n, e, session);
    assert.equal(out.ordo, null);
    assert.equal(out.layout, null);
    const errors = out.diagnostics.filter((d) => d.severity === "error");
    assert.equal(errors.length, 1, errors.map((d) => d.message).join("\n"));
    assert.match(errors[0].message, new RegExp(field.replace(".", "\\.")));
  });
}

test("a tube is a node like any other: it exports and reads back", () => {
  const { nodes, edges, session } = imported();
  const tube: Node = { id: "bar", type: TUBE_TYPE, position: { x: 0, y: 0 }, style: { width: 26, height: 220 }, data: { slots: 3 } };
  const out = exportOrdo([...nodes, tube], edges, session);
  assert.deepEqual(out.diagnostics, []);
  const back = importOrdo(out.ordo!.text, out.layout!.text);
  assert.deepEqual(back.nodes.find((n) => n.id === "bar"), tube);
});

// ---------------------------------------------------------------------------
// 5. Validator

test("the broken file yields exactly its five diagnostics", () => {
  const got = readDiagram(BROKEN).diagnostics.map((d) => [`${d.line}:${d.col}`, d.code, d.message]);
  assert.deepEqual(got, [
    ["6:9", "duplicate-id", 'id "api" is used more than once'],
    ["8:30", "unknown-endpoint", 'edge "e1" to "cache" is not a node'],
    ["12:7", "group-shape", 'group "vpc" cannot have a shape'],
    ["13:5", "orphan-data", 'data for "ghost", which is not in nodes'],
    ["16:14", "unknown-shape", 'unknown shape "blob"'],
  ]);
});

test("an unknown key stops at the schema pass", () => {
  const got = readDiagram(`${BROKEN}      colour: red\n`).diagnostics.map((d) => [`${d.line}:${d.col}`, d.code, d.message]);
  assert.deepEqual(got, [["17:7", "schema", 'data.nodes.db.colour: unknown key "colour"']]);
});

test("an unclosed flow map stops at the YAML pass", () => {
  const read = readDiagram("ordo: 1\nnodes:\n  - a\n  - b\nedges:\n  - { id: e1, from: a, to: b\n");
  assert.equal(read.ok, false);
  assert.deepEqual(
    read.diagnostics.map((d) => [d.code, d.line, d.col]),
    [["yaml-syntax", 7, 1]],
  );
});

test("a duplicate map key stops at the YAML pass", () => {
  const read = readDiagram("ordo: 1\nnodes:\n  - a\ndata:\n  nodes:\n    a:\n      label: A\n      label: B\n");
  assert.deepEqual(
    read.diagnostics.map((d) => [d.code, d.line, d.col, d.message]),
    [["yaml-syntax", 8, 7, "Map keys must be unique"]],
  );
});

test("an unquoted true is not an id; a quoted one is", () => {
  const bare = readDiagram("ordo: 1\nnodes:\n  - a\n  - true\n");
  assert.deepEqual(bare.diagnostics.map((d) => [d.code, d.line, d.col]), [["schema", 4, 5]]);
  assert.deepEqual(readDiagram('ordo: 1\nnodes:\n  - a\n  - "true"\n').diagnostics, []);
});

// ---------------------------------------------------------------------------
// 6. Generation and prefill

test("export with no source documents yields a valid file with the same model", () => {
  const { nodes, edges } = imported();
  const out = exportOrdo(nodes, edges, emptySession());
  assert.deepEqual(out.diagnostics, []);
  const back = readDiagram(out.text!);
  assert.equal(back.ok, true);
  assert.deepEqual(back.diagnostics, []);
  assert.deepEqual(canon(resolve(back.ordo!.value!)), canon(resolve(readDiagram(ORDO).ordo!.value!)));
  assert.deepEqual(canonLayout(back.layout!.value), canonLayout(readDiagram(ORDO, LAYOUT).layout!.value));
});

test("import with no layout places every node, and the export after it leaves the structure byte-identical", () => {
  const result = importOrdo(ORDO, null);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.nodes.length, 7);
  for (const n of result.nodes) {
    assert.ok(Number.isInteger(n.position.x) && Number.isInteger(n.position.y), n.id);
  }
  const out = exportOrdo(result.nodes, result.edges, { name: "checkout", ordo: result.ordo, layout: null });
  assert.equal(out.ordo?.text, ORDO);
  // The prefilled positions are what the new layout file holds: every node,
  // groups with a size, leaves without.
  const layout = readDiagram(ORDO, out.layout!.text).layout!.value!;
  assert.deepEqual(Object.keys(layout.nodes!), ["client", "vpc", "gateway", "services", "api", "db", "queue"]);
  for (const id of ["vpc", "services"]) assert.ok(layout.nodes![id].w && layout.nodes![id].h, id);
  for (const id of ["client", "gateway", "api", "db", "queue"]) assert.equal(layout.nodes![id].w, undefined, id);
});

test("an empty canvas exports as an empty diagram", () => {
  const out = exportOrdo([], [], emptySession());
  assert.equal(out.ordo?.text, "ordo: 1\nnodes: []\n");
  assert.equal(out.layout?.text, "ordo-layout: 1\n");
});

// ---------------------------------------------------------------------------
// Parity: the editor's own constructors build exactly what rfNode and rfEdge
// build, so a canvas drawn by hand exports.

test("the palette builds every shape and the group exactly as rfNode does", () => {
  const at = { x: 40, y: 80 };
  for (const shape of SHAPE_KEYS) {
    assert.deepEqual(
      makeNode(shape, { id: "n1", position: at }),
      rfNode({ id: "n1", parent: null, isGroup: false, label: "", shape }, at),
      shape,
    );
  }
  assert.deepEqual(
    makeNode("container", { id: "n2", position: at, parentId: "n9" }),
    rfNode({ id: "n2", parent: "n9", isGroup: true, label: "group", shape: "rect" }, { ...at, w: 340, h: 210 }),
  );
});

test("a drawn edge on the default style is built by rfEdge, and matches newEdge", () => {
  const c = { source: "n1", target: "n2", sourceHandle: "e", targetHandle: "w" };
  const drawn = connectionEdge(c, "e1", DEFAULT_EDGE_STYLE);
  assert.deepEqual(drawn, { ...newEdge(c, DEFAULT_EDGE_STYLE), id: "e1" });
  assert.deepEqual(
    drawn,
    rfEdge({ id: "e1", from: "n1", to: "n2", line: "solid", start: "none", end: "arrow" }, { from: "right", to: "left" }),
  );
  // A style v1 cannot store is still drawn, the editor's way; export refuses it.
  const red = connectionEdge(c, "e2", { ...DEFAULT_EDGE_STYLE, stroke: "#dc2626" });
  assert.equal((red.style as { stroke: string }).stroke, "#dc2626");
});

test("a canvas drawn with the palette and onConnect exports, and reads back", () => {
  const nodes: Node[] = [
    makeNode("container", { id: "n1", position: { x: 0, y: 0 } }),
    makeNode("rect", { id: "n2", position: { x: 20, y: 40 }, parentId: "n1" }),
    makeNode("diam", { id: "n3", position: { x: 400, y: 40 } }),
  ];
  nodes[1].data.label = "Start";
  // a resize, the way NodeResizer leaves it
  Object.assign(nodes[2], { width: 200, height: 120, measured: { width: 200, height: 120 }, selected: true });
  const edges: Edge[] = [
    connectionEdge({ source: "n2", target: "n3", sourceHandle: "e", targetHandle: "w" }, "e1", DEFAULT_EDGE_STYLE),
  ];
  const out = exportOrdo(nodes, edges, emptySession());
  assert.deepEqual(out.diagnostics, []);
  const back = importOrdo(out.ordo!.text, out.layout!.text);
  assert.deepEqual(canon(fromReactFlow(back.nodes, back.edges).diagram), canon(fromReactFlow(nodes, edges).diagram));
  assert.deepEqual(back.nodes.find((n) => n.id === "n3")?.style, { width: 200, height: 120 });
});

test("a text node is as big as its text: no size on the canvas, none in the file", () => {
  const at = { x: 40, y: 80 };
  const dropped = makeNode("label", { id: "n1", position: at });
  assert.deepEqual(dropped, rfNode({ id: "n1", parent: null, isGroup: false, kind: "text", label: "text", shape: "rect" }, at));
  assert.deepEqual(dropped.style, {});
  // until React Flow measures it, its size is its text's
  assert.deepEqual(sizeOfNode(dropped), textSize("text"));
  assert.ok(textSize("Guest checkout is allowed")[0] > textSize("text")[0]);

  // a size the file gives one is not read, and the export after it drops it
  const file = [
    "ordo: 1",
    "nodes: [note]",
    "data:",
    "  nodes:",
    "    note: { kind: text, label: Guest checkout is allowed }",
    "---",
    "ordo-layout: 1",
    "nodes:",
    "  note: { x: 10, y: 20, w: 200, h: 26 }",
    "",
  ].join("\n");
  const result = importOrdo(file);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.nodes[0].style, {});
  const out = exportOrdo(result.nodes, result.edges, emptySession());
  assert.deepEqual(out.diagnostics, []);
  assert.match(out.layout!.text, /note: \{ x: 10, y: 20 \}/);
});

// ---------------------------------------------------------------------------
// One file: the structure, `---`, the layout

const BUNDLE = `${ORDO}---\n${LAYOUT}`;

test("the one-file form: structure, ---, layout, exported back byte-identical", () => {
  const result = importOrdo(BUNDLE);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.nodes.length, 7);
  const out = exportOrdo(result.nodes, result.edges, { name: "checkout", ordo: result.ordo, layout: result.layout });
  assert.equal(out.text, BUNDLE);
  // the same canvas from the two-file form writes the same one file
  const two = importOrdo(ORDO, LAYOUT);
  assert.equal(exportOrdo(two.nodes, two.edges, { name: "checkout", ordo: two.ordo, layout: two.layout }).text, BUNDLE);
});

test("a fresh export is one file with its layout after the ---", () => {
  const { nodes, edges } = imported();
  const out = exportOrdo(nodes, edges, emptySession());
  assert.equal(out.text, `${out.ordo!.text}---\n${out.layout!.text}`);
});

test("a drag changes only lines after the ---; a rename only lines before it", () => {
  const result = importOrdo(BUNDLE);
  const session = { name: "checkout", ordo: result.ordo, layout: result.layout };
  const marker = BUNDLE.split("\n").indexOf("---");
  const changedLines = (text: string) =>
    text.split("\n").flatMap((line, i) => (line !== BUNDLE.split("\n")[i] ? [i] : []));

  const dragged = structuredClone(result.nodes) as Node[];
  dragged.find((n) => n.id === "api")!.position.x += 40;
  const afterDrag = changedLines(exportOrdo(dragged, result.edges, session).text!);
  assert.equal(afterDrag.length, 1);
  assert.ok(afterDrag[0] > marker);

  const renamed = structuredClone(result.nodes) as Node[];
  renamed.find((n) => n.id === "api")!.data.label = "Checkout API";
  const afterRename = changedLines(exportOrdo(renamed, result.edges, session).text!);
  assert.equal(afterRename.length, 1);
  assert.ok(afterRename[0] < marker);
});

test("a problem in the layout part is reported at its line in the one file", () => {
  const text = BUNDLE.replace("  queue: { x: 840, y: 160 }\n", "  queue: { x: 840, y: 160 }\n  ghost: { x: 0, y: 0 }\n");
  const read = readDiagram(text);
  const line = text.split("\n").indexOf("  ghost: { x: 0, y: 0 }") + 1;
  assert.deepEqual(
    read.diagnostics.map((d) => [d.code, d.severity, d.line, d.col]),
    [["layout-orphan", "warning", line, 3]],
  );
  assert.equal(read.ok, true);
});

test("the one file needs its structure, once", () => {
  const messages = (text: string) => readDiagram(text).diagnostics.map((d) => [d.line, d.message]);
  assert.deepEqual(messages(LAYOUT), [[1, "no structure document: the file needs the part that starts ordo: 1"]]);
  // line 44 is the second copy's header comment; its `ordo: 1` is on 45
  assert.deepEqual(messages(`${ORDO}---\n${ORDO}`), [[45, "a second structure document (ordo: 1); a file holds one diagram"]]);
  assert.deepEqual(messages(`${ORDO}---\ntitle: notes\n`), [[44, "document 2 is neither the structure (ordo: 1) nor the layout (ordo-layout: 1)"]]);
  assert.equal(readDiagram(BUNDLE, LAYOUT).ok, false); // a layout inside and another beside it
});

// ---------------------------------------------------------------------------
// A file's indentation survives a save

// A diagram's text as the import dialog and local mode open it, and what the
// next save writes when nothing on the canvas changed.
function reexport(text: string, change: (nodes: Node[]) => void = () => {}) {
  const result = importOrdo(text);
  assert.deepEqual(result.diagnostics, []);
  const nodes = structuredClone(result.nodes) as Node[];
  change(nodes);
  const session: OrdoSession = { name: "checkout", ordo: result.ordo, layout: result.layout, style: result.style };
  return exportOrdo(nodes, result.edges, session).text!;
}

// BUNDLE written back by `yaml` itself in another style. The second document
// already starts with its `---`.
const restyled = (style: object) =>
  parseAllDocuments(BUNDLE)
    .map((doc) => (doc as { toString: (o: object) => string }).toString({ lineWidth: 0, ...style }))
    .join("");

const changedLines = (a: string, b: string) => {
  const was = a.split("\n");
  return b.split("\n").flatMap((line, i) => (line !== was[i] ? [i] : []));
};

for (const style of [{ indent: 4 }, { indentSeq: false }, { indent: 4, indentSeq: false }]) {
  test(`a file laid out as ${JSON.stringify(style)} exports back byte-identical`, () => {
    const text = restyled(style);
    assert.notEqual(text, BUNDLE);
    assert.deepEqual(detectStyle(text), { indent: 2, indentSeq: true, ...style });
    assert.equal(reexport(text), text);
  });
}

test("a hand-written 4-space file keeps every line but a group's children", () => {
  // Every level 4 deeper, and a group's children 4 in from its dash. `yaml`
  // puts those 4 in from the group's key instead, two further right.
  const hand = BUNDLE.split("\n")
    .map((line) => {
      const n = line.length - line.trimStart().length;
      return n ? " ".repeat(/^[-#]/.test(line.trimStart()) ? n + 2 : n * 2) + line.trimStart() : line;
    })
    .join("\n");
  assert.match(hand, /^ {8}- gateway$/m);

  const out = reexport(hand);
  const moved = changedLines(hand, out).map((i) => out.split("\n")[i]);
  assert.deepEqual(moved, [
    "          - gateway",
    "          - services:",
    "                - api",
    "                # primary store",
    "                - db",
  ]);
  assert.equal(out.split("\n").length, hand.split("\n").length);
  assert.equal(reexport(out), out, "and the second save is a fixed point");
});

test("a drag in a 4-space file changes one line, after the ---", () => {
  const text = restyled({ indent: 4 });
  const out = reexport(text, (nodes) => {
    nodes.find((n) => n.id === "api")!.position.x += 40;
  });
  const changed = changedLines(text, out);
  assert.equal(changed.length, 1);
  assert.ok(changed[0] > text.split("\n").indexOf("---"));
});

test("detectStyle: a new diagram and the canonical file read as the default", () => {
  const empty = exportOrdo([], [], null).text!;
  assert.equal(empty, "ordo: 1\nnodes: []\n---\nordo-layout: 1\n");
  assert.deepEqual(detectStyle(empty), { indent: 2, indentSeq: true });
  assert.deepEqual(detectStyle(BUNDLE), { indent: 2, indentSeq: true });
  assert.deepEqual(detectStyle(""), { indent: 2, indentSeq: true });
  // a comment between a key and its first child is skipped, and so are CRLFs
  assert.deepEqual(detectStyle("ordo: 1\r\nnodes:\r\n# first\r\n- a\r\n"), { indent: 2, indentSeq: false });
});
