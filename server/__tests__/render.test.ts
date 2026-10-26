// The headless renderer render_ordo draws with: where the scene puts nodes,
// edge ends and riding tubes (the numbers React Flow would measure on the
// canvas), what the SVG holds, and that the PNG comes out, or a failure comes
// back, without taking the server down.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildScene } from "../render/scene.ts";
import type { Scene, SceneEdge, SceneNode } from "../render/scene.ts";
import { sceneToSvg } from "../render/svg.ts";
import { rasterize, renderDiagram } from "../render/png.ts";
import { polyline, pointAt } from "../render/path.ts";

const PNG_SIGNATURE = "89504e470d0a1a0a";

function sceneOf(text: string): Scene {
  const { scene, diagnostics } = buildScene(text);
  assert.ok(scene, JSON.stringify(diagnostics));
  return scene;
}
const node = (s: Scene, id: string): SceneNode => s.nodes.find((n) => n.id === id)!;
const edge = (s: Scene, id: string): SceneEdge => s.edges.find((e) => e.id === id)!;
const ends = (e: SceneEdge) => [e.points[0], e.points[e.points.length - 1]];

const layout = (nodes: string, edges = "") => `---\nordo-layout: 1\nnodes:\n${nodes}${edges ? `edges:\n${edges}` : ""}`;

test("a node in a group is placed from the group's corner, and the group fits its children", () => {
  const s = sceneOf(
    "ordo: 1\nnodes:\n  - g:\n      - a\n" + layout("  g: { x: 100, y: 40 }\n  a: { x: 24, y: 56 }\n"),
  );
  assert.deepEqual([node(s, "a").x, node(s, "a").y], [124, 96]);
  // 24 px past the child, measured from the group's own corner (rect is 160 × 48)
  assert.deepEqual([node(s, "g").w, node(s, "g").h], [24 + 160 + 24, 56 + 48 + 24]);
  assert.ok(node(s, "a").z > node(s, "g").z, "a child is drawn over its group");
});

test("an edge's ends: the faces that look at each other, 4 px out, unless the layout pins a side", () => {
  const structure = "ordo: 1\nnodes: [a, b]\nedges:\n  - { id: e, from: a, to: b }\n";
  // b is lower, but further across than down: joined side to side
  const across = sceneOf(structure + layout("  a: { x: 0, y: 0 }\n  b: { x: 300, y: 100 }\n"));
  const [from, to] = ends(edge(across, "e"));
  assert.deepEqual([from.x, from.y], [160 + 4, 24]);
  assert.deepEqual([to.x, to.y], [300 - 4, 124]);

  // the same nodes pinned bottom to top: down out of a, into b's top
  const pinned = sceneOf(structure + layout("  a: { x: 0, y: 0 }\n  b: { x: 300, y: 100 }\n", "  e: { from: bottom, to: top }\n"));
  const [down, into] = ends(edge(pinned, "e"));
  assert.deepEqual([down.x, down.y], [80, 48 + 4]);
  assert.deepEqual([into.x, into.y], [380, 100 - 4]);
});

test("a hidden edge, and one that names a handle its node doesn't have, aren't drawn", () => {
  const s = sceneOf(
    "ordo: 1\nnodes: [a, b]\nedges:\n  - { id: shown, from: a, to: b }\n  - { id: gone, from: a, to: b }\n  - { id: odd, from: a, to: b }\n" +
      "data:\n  edges:\n    gone: { hidden: true }\n" +
      layout("  a: { x: 0, y: 0 }\n  b: { x: 0, y: 200 }\n", "  odd: { from: b9 }\n"),
  );
  assert.deepEqual(s.edges.map((e) => e.id), ["shown"]);
});

test("a tube riding a lifeline sits where the canvas puts it: centred t of the way along", async () => {
  const guide = await fs.readFile(new URL("../../docs/agents/sequence.md", import.meta.url), "utf8");
  const example = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].at(-1)![1];
  const s = sceneOf(example);
  const bar = node(s, "auth-bar");
  const life = pointAt(edge(s, "auth-life").points, bar.data.attach!.t)!;
  assert.ok(Math.abs(bar.x + bar.w / 2 - life.x) < 0.01 && Math.abs(bar.y + bar.h / 2 - life.y) < 0.01);
  assert.equal(bar.angle, 0, "a bar on a lifeline running down stands upright");
  // its messages end on its taps
  const [, m2end] = ends(edge(s, "m2"));
  assert.ok(Math.abs(m2end.y - (bar.y + bar.data.taps![0])) < 0.01);
});

test("the SVG holds the labels, the markers in each line's colour, and the group's title", () => {
  const { svg } = sceneToSvg(
    sceneOf(
      'ordo: 1\nnodes:\n  - g:\n      - a\n  - b\nedges:\n  - { id: e, from: a, to: b }\ndata:\n  nodes:\n    g: { label: Shop }\n    a: { label: "Orders & co" }\n  edges:\n    e: { label: saves, color: "#16a34a" }\n' +
        layout("  g: { x: 0, y: 0 }\n  a: { x: 24, y: 56 }\n  b: { x: 24, y: 300 }\n"),
    ),
  );
  assert.match(svg, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, />Orders &amp; co<\/text>/);
  assert.match(svg, />Shop<\/text>/);
  assert.match(svg, />saves<\/text>/);
  assert.match(svg, /<marker id="m0"[^>]*>.*fill:#16a34a/);
  assert.doesNotMatch(svg, /var\(--mk/);
  assert.match(svg, /font-family="Liberation Sans"/);
});

test("markers turn with their line: resvg can't reverse one, so a start marker is drawn turned round", () => {
  const { svg } = sceneToSvg(
    sceneOf(
      "ordo: 1\nnodes: [a, b]\nedges:\n  - { id: e, from: a, to: b }\ndata:\n  edges:\n    e: { start: arrow }\n" +
        layout("  a: { x: 0, y: 0 }\n  b: { x: 0, y: 200 }\n"),
    ),
  );
  assert.doesNotMatch(svg, /auto-start-reverse/);
  const def = (id: string) => svg.match(new RegExp(`<marker id="${id}"[^>]*>(.*?)</marker>`))!;
  const start = def(svg.match(/marker-start="url\(#(m\d+)\)"/)![1]);
  const end = def(svg.match(/marker-end="url\(#(m\d+)\)"/)![1]);
  assert.notEqual(start[0], end[0]);
  assert.match(start[0], /orient="auto"/);
  assert.match(start[1], /^<g transform="rotate\(180 /);
  assert.doesNotMatch(end[1], /rotate/);
});

test("renderDiagram: a PNG for a valid diagram, the errors for one that isn't", async () => {
  const checkout = await renderDiagram(await fs.readFile(new URL("../../examples/checkout.yml", import.meta.url), "utf8"));
  assert.ok(checkout.ok);
  assert.equal(checkout.png.subarray(0, 8).toString("hex"), PNG_SIGNATURE);
  assert.ok(Math.max(checkout.width, checkout.height) <= 1568);

  const broken = await renderDiagram("ordo: 1\nnodes: [a]\nedges:\n  - { id: e, from: a, to: nowhere }\n");
  assert.equal(broken.ok, false);
  assert.ok(!broken.ok && broken.diagnostics.some((d) => d.code === "unknown-endpoint"));
});

test("a drawing resvg can't place fails that render, not the process", async () => {
  // a marker on a line wholly outside the picture makes resvg 2.6 panic
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><defs><marker id="m" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs>' +
    '<path d="M500 500 L600 600" stroke="#000" marker-end="url(#m)"/></svg>';
  await assert.rejects(rasterize(svg, 1), /the rasteriser failed/);
  // and the next one still draws
  const ok = await rasterize('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', 1);
  assert.equal(ok.subarray(0, 8).toString("hex"), PNG_SIGNATURE);
});

test("path: the points of a step route, and a point a fraction along it", () => {
  const pts = polyline("M0 0L0 10L 0,20Q 0,28 8,28L 92,28Q 100,28 100,36L100 60");
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts.at(-1), { x: 100, y: 60 });
  const mid = pointAt(polyline("M0 0L 0,100"), 0.25)!;
  assert.deepEqual([mid.x, mid.y, mid.angle], [0, 25, 90]);
});
