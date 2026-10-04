// The constructs the spec's two fixtures never exercise: participant boxes,
// create/destroy, autonumber, rect, critical, break, opt, every arrow family,
// entities and a title. `box` and `title` need a DOM while Mermaid parses, so
// this file brings the test-only one in BEFORE anything loads Mermaid.
import "./dom.ts";

import { test } from "node:test";
import assert from "node:assert/strict";

import { EXTENDED } from "./fixtures.ts";
import { handleY, index, messages, streamIdxOf } from "./helpers.ts";

const { getSequenceForOrdo } = await import("../sequence.ts");
const { sequenceToOrdo } = await import("../sequenceToOrdo.ts");

const model = await getSequenceForOrdo(EXTENDED);
const out = sequenceToOrdo(model);
const byId = index(out.nodes);
const msg = (label: string) =>
  messages(out.edges).find((e) => e.data?.label?.endsWith(label))!;

test("the title comes through to name the diagram, not as a node", async () => {
  assert.equal(model.title, "Checkout");
  assert.ok(!out.nodes.some((n) => n.data?.label === "Checkout"));
  const { importMermaid } = await import("../index.ts");
  assert.equal((await importMermaid(EXTENDED)).title, "Checkout");
});

test("participant types become shapes; <br> becomes a line break", () => {
  assert.equal(byId.get("seq:head:U")?.data.shape, "person");
  assert.equal(byId.get("seq:head:W")?.data.label, "Web\nApp");
  assert.equal(byId.get("seq:head:S")?.data.shape, "rect");
});

test("a box groups its participants in a frame behind them", () => {
  assert.deepEqual(model.boxes, [
    { id: 0, label: "Shop front", fill: "rgb(230, 240, 255)", actors: ["U", "W"] },
  ]);
  const frame = byId.get("seq:box:0")!;
  assert.equal(frame.data.operator, "box");
  assert.equal(frame.data.fill, "rgb(230, 240, 255)");
  assert.ok(frame.zIndex! < 0); // a filled region stays behind everything
  for (const id of ["U", "W"]) {
    const head = byId.get(`seq:head:${id}`)!;
    assert.ok(head.position.x > frame.position.x);
    assert.ok(head.position.x + head.style.width < frame.position.x + frame.style.width);
  }
  const server = byId.get("seq:head:S")!;
  assert.ok(server.position.x > frame.position.x + frame.style.width);
});

test("a created participant's header is centred on the arrow that creates it", () => {
  const connect = msg("Connect");
  assert.equal(connect.target, "seq:head:D");
  assert.equal(connect.targetHandle, "w");
  assert.ok(
    Math.abs(handleY(byId, connect.source, connect.sourceHandle) - handleY(byId, "seq:head:D", "w")) < 0.02,
  );
  assert.ok(byId.get("seq:head:D")!.position.y > byId.get("seq:head:S")!.position.y);
});

test("a destroyed participant's foot is centred on the arrow that destroys it", () => {
  const drop = msg("Disconnect");
  assert.equal(drop.target, "seq:foot:D");
  assert.equal(drop.data?.markerEnd, "cross");
  assert.ok(
    Math.abs(handleY(byId, drop.source, drop.sourceHandle) - handleY(byId, "seq:foot:D", "w")) < 0.02,
  );
  assert.ok(byId.get("seq:foot:D")!.position.y < byId.get("seq:foot:S")!.position.y);
});

test("autonumber numbers each arrow until it is switched off", () => {
  const labels = messages(out.edges)
    .sort((p, q) => streamIdxOf(p) - streamIdxOf(q))
    .map((e) => e.data?.label);
  assert.equal(labels[0], "1. Start ♥ checkout");
  assert.equal(labels[11], "12. Disconnect");
  assert.equal(labels[12], "Unnumbered");
});

test("rect, critical, break and opt each become a frame", () => {
  const frames = out.nodes.filter((n) => n.id.startsWith("seq:frag:"));
  assert.deepEqual(
    frames.map((n) => n.data.operator),
    ["rect", "critical", "break", "opt"],
  );
  const rect = frames[0];
  assert.equal(rect.data.fill, "rgb(191, 223, 255)");
  const critical = frames[1];
  assert.deepEqual(critical.data.guards, ["Charge card", "Declined"]);
  assert.equal(critical.data.dividers?.length, 1);
});

test("arrow families map onto Ordo's end markers", () => {
  assert.equal(msg("Email receipt").data?.markerEnd, "arrow"); // -)  async
  assert.equal(msg("Sync").data?.markerStart, "arrow-filled"); // <<->>
  assert.equal(msg("Sync").data?.markerEnd, "arrow-filled");
  assert.equal(msg("Half arrow").data?.markerEnd, "arrow-filled"); // -|\ — no half-head yet
  assert.equal(msg("Basket").style?.strokeDasharray, "8 4");
});

test("what Ordo cannot draw yet is said, not silently dropped", () => {
  assert.ok(model.warnings.some((w) => w.includes("central-connection")));
});
