// Every import lands as one named group: it can be selected and moved as a
// unit, sits beside other imports without colliding, and keeps the diagram's
// stacking whether or not it is selected.
import { test } from "node:test";
import assert from "node:assert/strict";

import { GROUP_Z, diagramName, groupDiagram, groupId } from "../group.ts";
import { cloneGraph, copySelection } from "../../selection.ts";
import { frontMatterTitle } from "../detect.ts";
import { importMermaid } from "../index.ts";
import { ENROLMENT } from "./fixtures.ts";
import { index } from "./helpers.ts";
import type { Rect } from "../../types.ts";

const group = (label: string) => ({ id: `g-${label}`, type: "container", data: { label } });

test("a titled diagram is named for its title", () => {
  assert.equal(diagramName("Checkout flow", []), "Checkout flow");
  assert.equal(diagramName("  Spaced  ", []), "Spaced");
});

test("an untitled diagram is the next mermaidN after what is on the canvas", () => {
  assert.equal(diagramName(null, []), "mermaid1");
  assert.equal(diagramName("", [group("mermaid1")]), "mermaid2");
  assert.equal(diagramName(undefined, [group("mermaid1"), group("Mermaid3")]), "mermaid4");
  // titled groups and look-alikes take no number
  assert.equal(diagramName(null, [group("Checkout"), group("mermaid2b")]), "mermaid1");
});

test("a front-matter title is read, quoted or not", () => {
  assert.equal(frontMatterTitle("---\ntitle: Pay flow\n---\nflowchart TD\nA-->B"), "Pay flow");
  assert.equal(frontMatterTitle('---\ntitle: "Quoted: yes"\nconfig: {}\n---\nsequenceDiagram'), "Quoted: yes");
  assert.equal(frontMatterTitle("flowchart TD\n  A-->B"), null);
});

test("group ids never reuse one on the canvas", () => {
  assert.equal(groupId([]), "mermaid-1");
  assert.equal(groupId([{ id: "mermaid-1" }, { id: "mermaid-2" }]), "mermaid-3");
});

const imported = await importMermaid(ENROLMENT);
const at = { x: 500, y: -40 };
const { group: g, nodes, edges } = groupDiagram(imported, {
  id: "mermaid-7",
  label: "mermaid7",
  at,
});
const byId = index(nodes);

test("the whole diagram goes into one group, which comes first", () => {
  assert.equal(nodes[0], g);
  assert.equal(g.type, "container");
  assert.equal(g.data.label, "mermaid7");
  assert.deepEqual(g.position, at);
  for (const n of nodes.slice(1)) assert.equal(n.parentId, g.id, n.id);
});

test("every id is namespaced, so a second import of the same diagram cannot collide", () => {
  const ids = [...nodes, ...edges].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.filter((id) => id !== g.id).every((id) => id.startsWith("mermaid-7/")));

  const again = groupDiagram(imported, { id: "mermaid-8", label: "mermaid8" });
  const theirs = new Set([...again.nodes, ...again.edges].map((x) => x.id));
  assert.ok(ids.every((id) => !theirs.has(id)));
});

test("references follow the ids: edge ends and the lifelines riders ride", () => {
  const edgeIds = new Set(edges.map((e) => e.id));
  for (const e of edges) {
    assert.ok(byId.has(e.source), e.id);
    assert.ok(byId.has(e.target), e.id);
  }
  for (const n of nodes)
    if (n.data?.attach) assert.ok(edgeIds.has(n.data.attach.edgeId), n.id);
});

test("children sit inside the group, in its coordinates, where the import put them", () => {
  const original = index(imported.nodes);
  for (const n of nodes.slice(1)) {
    const was = original.get(n.id.slice("mermaid-7/".length))!;
    const w = n.style!.width!;
    const h = n.style!.height!;
    assert.ok(n.position.x >= 0 && n.position.y >= 0, n.id);
    assert.ok(n.position.x + w <= g.style!.width! && n.position.y + h <= g.style!.height!, n.id);
    // the same offsets between nodes as before grouping
    const head = original.get("seq:head:App")!;
    const headNow = byId.get("mermaid-7/seq:head:App")!;
    assert.ok(Math.abs(n.position.x - headNow.position.x - (was.position.x - head.position.x)) < 1e-9);
    assert.ok(Math.abs(n.position.y - headNow.position.y - (was.position.y - head.position.y)) < 1e-9);
  }
});

test("riders stay exactly on their lifelines inside the group", () => {
  // Header, foot and rider all share the group's coordinates now.
  for (const n of nodes) {
    if (n.type !== "tube") continue;
    const actor = n.data.attach!.edgeId.slice("mermaid-7/seq:life:".length);
    const head = byId.get(`mermaid-7/seq:head:${actor}`)!;
    const foot = byId.get(`mermaid-7/seq:foot:${actor}`)!;
    const from = head.position.y + head.style!.height! + 3;
    const to = foot.position.y - 3;
    const centre = from + n.data.attach!.t * (to - from);
    assert.ok(Math.abs(centre - (n.position.y + n.style!.height! / 2)) < 0.05, n.id);
  }
});

test("a copied diagram pastes as one selected group, its bars riding the copied lifelines", () => {
  const canvas = nodes.map((n) => (n.id === g.id ? { ...n, selected: true } : n));
  const absRect = (id: string): Rect | null =>
    id === g.id ? { ...g.position, width: g.style!.width!, height: g.style!.height! } : null;
  const clip = copySelection({ nodes: canvas, edges, absRect })!;
  assert.equal(clip.nodes.length, nodes.length); // the tubes come along: they are in the group
  assert.equal(clip.edges.length, edges.length);

  let k = 0;
  const pasted = cloneGraph(clip, {
    newNodeId: () => `p${k++}`,
    newEdgeId: (s, t) => `pe${k++}-${s}-${t}`,
    dx: 40,
    dy: 40,
  });
  const selected = pasted.nodes.filter((n) => n.selected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].type, "container");
  assert.ok(pasted.edges.every((e) => !e.selected));

  const ids = new Set(pasted.nodes.map((n) => n.id));
  const edgeIds = new Set(pasted.edges.map((e) => e.id));
  for (const n of pasted.nodes) {
    if (n.parentId) assert.ok(ids.has(n.parentId), n.id);
    if (n.data?.attach) assert.ok(edgeIds.has(n.data.attach.edgeId), n.id);
  }
});

test("selecting the group never re-stacks what is inside it", () => {
  // React Flow's rule: a child keeps its own zIndex unless its parent sits at
  // or above it; selecting the parent lifts the parent by 1000.
  const childZ = (parentZ: number, own = 0) => (parentZ >= own ? parentZ + 1 : own);
  for (const n of nodes.slice(1)) {
    const own = n.zIndex ?? 0;
    assert.equal(childZ(GROUP_Z, own), own, n.id);
    assert.equal(childZ(GROUP_Z + 1000, own), own, n.id);
  }
});
