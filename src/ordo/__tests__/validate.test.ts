// The validator as an agent meets it: every error in one pass, messages that
// say what to write instead, and no error repeated for every edge that points
// at a node the skeleton spelt wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readDiagram } from "../index.ts";
import { closest, distance } from "../suggest.ts";

const found = (text: string) => readDiagram(text).diagnostics.map((d) => [d.code, d.message]);
const lines = (...l: string[]) => `${l.join("\n")}\n`;

test("schema errors no longer hide the rest: shapes, endpoints and layout orphans come in the same pass", () => {
  const text = lines(
    "ordo: 1",
    "nodes: [a, b]",
    "edges:",
    "  - { id: e1, from: a, to: c }",
    "data:",
    "  nodes:",
    "    a: { shape: cylnder, lable: A }",
    "  edges:",
    "    e1: { line: dashd }",
    "---",
    "ordo-layout: 1",
    "nodes:",
    "  a: { x: 1.5, y: 0 }",
    "  ghost: { x: 0, y: 0 }",
  );
  const read = readDiagram(text);
  assert.equal(read.ok, false);
  assert.deepEqual(
    read.diagnostics.map((d) => [d.line, d.severity, d.code]),
    [
      [4, "error", "unknown-endpoint"],
      [7, "error", "unknown-shape"],
      [7, "error", "schema"],
      [9, "error", "schema"],
      [13, "error", "schema"],
      [14, "warning", "layout-orphan"],
    ],
  );
});

test("an enum names its values and the nearest one", () => {
  const text = lines(
    "ordo: 1",
    "nodes: [a, b]",
    "edges: [{ id: e1, from: a, to: b }]",
    "data:",
    "  nodes:",
    "    a: { textWeight: 600 }",
    "  edges:",
    "    e1: { line: dashd, route: smoothstep, end: arrowhead }",
  );
  assert.deepEqual(found(text), [
    ["schema", "data.nodes.a.textWeight: must be one of regular, semibold, bold, not 600; did you mean \"semibold\"?"],
    ["schema", 'data.edges.e1.line: must be one of solid, dotted, dashed, thick, not "dashd"; did you mean "dashed"?'],
    ["schema", 'data.edges.e1.route: must be one of step, straight, orthogonal, curved, not "smoothstep"; did you mean "step"?'],
    [
      "schema",
      'data.edges.e1.end: must be one of none, arrow, open-arrow, circle, cross, inheritance, composition, aggregation, dependency, er-one, er-many, er-zero-one, er-zero-many, er-one-many, not "arrowhead"; did you mean "arrow"?',
    ],
  ]);
});

test("a misspelt shape is offered as its registry key, and names the guide page that lists them", () => {
  const read = readDiagram(lines("ordo: 1", "nodes: [a, b, c]", "data:", "  nodes:", "    a: { shape: cylnder }", "    b: { shape: square }", "    c: { shape: blob }"));
  assert.deepEqual(
    read.diagnostics.map((d) => [d.message, d.guide]),
    [
      ['unknown shape "cylnder"; did you mean "cyl"?', "core"],
      ['unknown shape "square"; did you mean "rect"?', "core"],
      ['unknown shape "blob"', "core"],
    ],
  );
});

test("a node written with its fields is still that node: its edges are not reported again", () => {
  const text = lines("ordo: 1", "nodes:", "  - { id: a, label: A, shape: cyl }", "  - b", "edges:", "  - { id: e1, from: a, to: b }");
  assert.deepEqual(found(text), [["schema", "nodes.0: nodes lists ids, not fields: write - a here, and put label and shape under data.nodes.a"]]);
});

test("an edge keyed by its id is read as that edge, and its ends are still checked", () => {
  const text = lines("ordo: 1", "nodes: [a, b]", "edges:", "  - e1: { from: a, to: d }");
  assert.deepEqual(found(text), [
    ["schema", "edges.0: write an edge as - { id: e1, from: …, to: … }, its id inside the braces"],
    ["unknown-endpoint", 'edge "e1" to "d" is not a node'],
  ]);
});

test("a style written into the edges list is pointed at data.edges", () => {
  const text = lines("ordo: 1", "nodes: [a, b]", "edges:", "  - { id: e1, from: a, to: b, label: calls }");
  assert.deepEqual(found(text), [["schema", "edges.0: label goes under data.edges.e1; an edge in this list has only id, from and to"]]);
});

test("an unquoted number is an id once quoted: one message per spot, no orphaned data", () => {
  const text = lines("ordo: 1", "nodes:", "  - 1", "edges:", "  - { id: e1, from: 1, to: 1 }", "data:", "  nodes:", '    "1": { label: One }');
  assert.deepEqual(found(text), [
    ["schema", 'nodes.0: 1 reads as a number, not text; quote it: "1"'],
    ["schema", 'edges.0.from: 1 reads as a number, not text; quote it: "1"'],
    ["schema", 'edges.0.to: 1 reads as a number, not text; quote it: "1"'],
  ]);
});

test("a group with nothing under it says how to nest, and is not taken for a leaf", () => {
  const text = lines("ordo: 1", "nodes:", "  - vpc:", "  - a", "data:", "  nodes:", "    vpc: { label: VPC }");
  assert.deepEqual(found(text), [
    [
      "schema",
      'nodes.0: group "vpc" has no children: indent them under it, write - vpc: [] for an empty group, or - vpc for a plain node',
    ],
  ]);
});

test("a group written with its fields beside its children", () => {
  const text = lines("ordo: 1", "nodes:", "  - vpc: [a]", "    label: VPC");
  assert.deepEqual(found(text), [["schema", "nodes.0: a group is a map with one key, its id (- vpc: [children]); put label under data.nodes.vpc"]]);
});

test("an unquoted hex colour is explained", () => {
  const text = lines("ordo: 1", "nodes: [a, b]", "edges: [{ id: e1, from: a, to: b }]", "data:", "  edges:", "    e1:", "      color: #16a34a");
  assert.deepEqual(found(text), [
    ["schema", 'data.edges.e1.color: has no value; quote a colour, like "#16a34a": an unquoted # starts a YAML comment'],
  ]);
});

test("data filed under the wrong half says which half it belongs in", () => {
  const text = lines("ordo: 1", "nodes: [a, b]", "edges: [{ id: e1, from: a, to: b }]", "data:", "  nodes:", "    e1: { label: calls }", "  edges:", "    a: { label: A }");
  assert.deepEqual(found(text), [
    ["orphan-data", '"e1" is an edge, so its data goes under data.edges'],
    ["orphan-data", '"a" is a node, so its data goes under data.nodes'],
  ]);
});

test("misspelt data and misspelt nodes meet in the middle", () => {
  const text = lines("ordo: 1", "nodes: [checkout]", "data:", "  nodes:", "    chekout: { label: Checkout }");
  assert.deepEqual(found(text), [["orphan-data", 'data for "chekout", which is not in nodes; did you mean "checkout"?']]);
});

test("a field on the wrong kind lists what the kind takes, and names the guide page for its diagram", () => {
  const text = lines(
    "ordo: 1",
    "nodes: [t, c, f]",
    "data:",
    "  nodes:",
    "    t: { kind: tube, shape: rect }",
    "    c: { kind: class, taps: [10] }",
    "    f: { kind: box, sections: [[a]] }",
  );
  assert.deepEqual(
    readDiagram(text).diagnostics.map((d) => [d.code, d.message, d.guide]),
    [
      ["kind-field", 'tube "t" has no field "shape"; a tube takes kind, label, type, slots, taps, variant, attach and align', "sequence"],
      ["kind-field", 'class "c" has no field "taps"; a class takes kind, label, type, textSize, textWeight and sections', "sequence"],
      ["kind-field", 'box "f" has no field "sections"; a box takes kind, label, shape, type, textSize and textWeight', "class"],
    ],
  );
});

test("unknown keys: the nearest field, or what the map takes, or where other tools' keys go", () => {
  const text = lines(
    "ordo: 1",
    "title: Checkout",
    "nodes: [a, b]",
    "edges: [{ id: e1, from: a, to: b }]",
    "data:",
    "  nodes:",
    "    a: { lable: A, parent: b }",
    "  edges:",
    "    e1: { arrowhead: open }",
  );
  assert.deepEqual(found(text), [
    ["schema", 'title: unknown key "title"; a diagram is named by its folder, .ordo/<name>/; for a title on the canvas, add a text node'],
    ["schema", 'data.nodes.a.lable: unknown key "lable"; did you mean "label"?'],
    ["schema", 'data.nodes.a.parent: unknown key "parent"; nesting comes from nodes: list the node under its group there'],
    ["schema", 'data.edges.e1.arrowhead: unknown key "arrowhead"; the markers at the ends are start and end'],
  ]);
});

test("a tube riding an edge that isn't there gets the nearest edge and the sequence page", () => {
  const text = lines("ordo: 1", "nodes: [h, f, t]", "edges: [{ id: life, from: h, to: f }]", "data:", "  nodes:", "    t: { kind: tube, attach: lfe }");
  assert.deepEqual(
    readDiagram(text).diagnostics.map((d) => [d.code, d.message, d.guide]),
    [["unknown-edge", 'tube "t" rides "lfe", which is not an edge; did you mean "life"?', "sequence"]],
  );
});

test("a duplicate names the line of its first use; a node and an edge can't share an id", () => {
  const text = lines("ordo: 1", "nodes: [a, b, a]", "edges:", "  - { id: b, from: a, to: a }");
  assert.deepEqual(found(text), [
    ["duplicate-id", 'id "a" is used more than once (first on line 2)'],
    ["duplicate-id", 'id "b" names both a node and an edge; nodes and edges share one set of ids (first on line 2)'],
  ]);
});

test("YAML mistakes an agent makes come with the fix", () => {
  assert.deepEqual(found(lines("ordo: 1", "nodes: [a]", "data:", "  nodes:", "    a:", "      label: id: uuid")), [
    ["yaml-syntax", 'Nested mappings are not allowed in compact mappings; quote a value that holds ": ", like label: "id: uuid"'],
  ]);
  assert.deepEqual(found("ordo: 1\nnodes:\n\t- a\n"), [["yaml-syntax", "Tabs are not allowed as indentation; indent with spaces"]]);
});

test("a layout is checked against the structure's ids even when the structure has an error", () => {
  const text = lines("ordo: 1", "nodes: [a]", "data:", "  nodes:", "    a: { shape: blob }", "---", "ordo-layout: 1", "nodes:", "  a: { x: 0, y: 0 }", "  gone: { x: 0, y: 0 }");
  assert.deepEqual(
    readDiagram(text).diagnostics.map((d) => [d.code, d.severity, d.guide]),
    [
      ["unknown-shape", "error", "core"],
      ["layout-orphan", "warning", "editing"],
    ],
  );
});

// A lifeline with a bar on it, and a message from a box to the bar.
const RIDDEN = lines(
  "ordo: 1",
  "nodes: [a, a-foot, bar, b]",
  "edges:",
  "  - { id: life, from: a, to: a-foot }",
  "  - { id: m1, from: b, to: bar }",
  "data:",
  "  nodes:",
  "    bar: { kind: tube, attach: life, taps: [8, 48] }",
  "---",
  "ordo-layout: 1",
  "edges:",
  "  life: { from: bottom, to: top }",
  "  m1: { from: right, to: a1 }",
);

test("an anchor the node doesn't have is a warning: the edge isn't drawn", () => {
  assert.deepEqual(readDiagram(RIDDEN).diagnostics, []);
  const handles = (text: string) => readDiagram(text).diagnostics.map((d) => [d.code, d.severity, d.message, d.guide]);
  assert.deepEqual(handles(RIDDEN.replace("to: a1 }", "to: a2 }")), [
    ["unknown-handle", "warning", 'edge "m1" arrives at "a2", but tube "bar" has taps a0–a1 and b0–b1, so the edge isn\'t drawn', "sequence"],
  ]);
  assert.deepEqual(handles(RIDDEN.replace("from: right,", "from: rigth,")), [
    ["unknown-handle", "warning", 'edge "m1" leaves from "rigth", which box "b" doesn\'t have, so the edge isn\'t drawn; did you mean "right"?', "editing"],
  ]);
  // the canvas's own names for the sides read too, and a tube keeps its head and tail
  assert.deepEqual(handles(RIDDEN.replace("from: right, to: a1", "from: e, to: head")), []);
  assert.equal(readDiagram(RIDDEN.replace("to: a1 }", "to: a2 }")).ok, true); // a warning: the diagram still opens
});

test("taps out of order, and guards that don't match the dividers, are warnings", () => {
  const text = lines(
    "ordo: 1",
    "nodes: [t, f, r]",
    "data:",
    "  nodes:",
    "    t: { kind: tube, taps: [48, 8] }",
    "    f: { kind: fragment, operator: alt, guards: [ok, failed], dividers: [] }",
    "    r: { kind: fragment, operator: rect, guards: [], dividers: [] }",
  );
  assert.deepEqual(
    readDiagram(text).diagnostics.map((d) => [d.code, d.severity, d.message]),
    [
      ["tap-order", "warning", 'tube "t" lists its taps out of order; list them smallest first, since a message names a tap by its place in the list'],
      [
        "guard-count",
        "warning",
        'fragment "f" has 2 guards and 0 dividers; it needs a guard for each section, and a divider before each section after the first',
      ],
    ],
  );
});

test("a clean file still reads clean", () => {
  const read = readDiagram(lines("ordo: 1", "nodes:", "  - g:", "      - a", "  - b", "edges: [{ id: e1, from: a, to: b }]"));
  assert.equal(read.ok, true);
  assert.deepEqual(read.diagnostics, []);
});

// ---------------------------------------------------------------------------
// suggest.ts

test("distance counts an adjacent swap as one edit", () => {
  assert.equal(distance("cyl", "cyl"), 0);
  assert.equal(distance("dashd", "dashed"), 1);
  assert.equal(distance("lable", "label"), 1);
  assert.equal(distance("", "abc"), 3);
});

test("closest: case, a slip, a start, a longer word; nothing for a different word", () => {
  assert.equal(closest("Rect", ["rect", "rounded"]), "rect");
  assert.equal(closest("cylnder", ["cyl", "cylinder"]), "cylinder");
  assert.equal(closest("ortho", ["step", "straight", "orthogonal", "curved"]), "orthogonal");
  assert.equal(closest("arrowhead", ["arrow", "open-arrow"]), "arrow");
  assert.equal(closest("blob", ["rect", "cyl", "doc"]), undefined);
  assert.equal(closest("c", ["a", "b"]), undefined); // one letter off a one-letter word is another word
});
