// WS4 sequence import — the acceptance list, run against the enrolment fixture
// and the notes fixture. Deliberately NO DOM in this file: the parse-only path
// must not need one.
import { test } from "node:test";
import assert from "node:assert/strict";

import mermaid from "../mermaid.ts";
import { getSequenceForOrdo } from "../sequence.ts";
import { sequenceToOrdo } from "../sequenceToOrdo.ts";
import { ENROLMENT, ENROLMENT_SHORTHAND, LOUNGE } from "./fixtures.ts";
import {
  handleY,
  index,
  messages,
  riderCentre,
  spanKey,
  streamIdxOf,
} from "./helpers.ts";
import type { Fragment, SequenceModel } from "../sequence.ts";
import type { SizedNode } from "../../types.ts";

// Mermaid's parse records, as far as the two tests that open them up read them.
type SequenceDb = {
  state: {
    records: {
      actors: unknown;
      messages: { type: number }[];
      notes: unknown[];
    };
  };
  LINETYPE: Record<string, number>;
};
const dbOf = (diagram: { db: unknown }) => diagram.db as SequenceDb;

const model = await getSequenceForOrdo(ENROLMENT);
const out = sequenceToOrdo(model);
const byId = index(out.nodes);

const spansOf = (m: SequenceModel, actor: string) =>
  m.spans.filter((s) => s.actor === actor);
const entry = (m: SequenceModel, streamIdx: number) =>
  m.entries.find((e) => e.streamIdx === streamIdx);
const arrowCount = (src: string) =>
  src.split("\n").filter((line) => /-{1,2}>>[+-]?/.test(line)).length;

test("parses with no DOM present", () => {
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(typeof globalThis.document, "undefined");
});

test("records are the shape the importer was built against", async () => {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(ENROLMENT);
  assert.equal(diagram.type, "sequence");
  assert.ok(dbOf(diagram).state.records.actors instanceof Map);
  assert.ok(dbOf(diagram).state.records.messages.length > 0);
});

test("columns follow the prevActor/nextActor chain", () => {
  assert.deepEqual(
    model.actors.map((a) => a.id),
    ["App", "Widget", "TokenX", "Backend", "Eligibility", "Payment", "PreAuth", "Kafka", "Consumer"],
  );
  const heads = model.actors.map((a) => byId.get(`seq:head:${a.id}`)!.position.x);
  assert.deepEqual(heads, [...heads].sort((p, q) => p - q));
});

test("11 spans recovered; Backend has three", () => {
  assert.equal(model.spans.length, 11);
  assert.equal(spansOf(model, "Backend").length, 3);
});

test("Backend span depths are 1, 1, 2 — the re-entrant case is kept", () => {
  assert.deepEqual(
    spansOf(model, "Backend").map((s) => s.depth).sort(),
    [1, 1, 2],
  );
});

test("Consumer has two sequential spans, both depth 1", () => {
  const [first, second] = spansOf(model, "Consumer").sort((p, q) => p.open - q.open);
  assert.equal(spansOf(model, "Consumer").length, 2);
  assert.equal(first.depth, 1);
  assert.equal(second.depth, 1);
  assert.ok(first.close < second.open);
});

test("Payment and PreAuth spans interleave without error", () => {
  const [pay] = spansOf(model, "Payment");
  const [pre] = spansOf(model, "PreAuth");
  assert.deepEqual([pay.open, pre.open, pay.close, pre.close], [19, 26, 30, 45]);
});

test("par holds one alt and one loop, each at depth 2", () => {
  assert.equal(model.fragments.length, 1);
  const [par] = model.fragments;
  assert.equal(par.operator, "par");
  assert.deepEqual(par.guards, ["Backend (async)", "Frontend (polling)"]);
  assert.deepEqual(par.children.map((f) => f.operator).sort(), ["alt", "loop"]);
  assert.ok(par.children.every((f) => f.depth === 2));
});

test("Backend's second span crosses PAR_AND and closes after PAR_END", () => {
  const [par] = model.fragments;
  const and = model.entries.find((e) => e.kind === "mid" && e.fragment === par.id)!;
  const span = spansOf(model, "Backend").find((s) => s.depth === 1 && s.open > par.open)!;
  assert.ok(span.open > par.open && span.open < and.streamIdx);
  assert.ok(span.close > par.close!);

  // …and is drawn that way: the bar runs on past the frame's bottom edge.
  const bar = byId.get(`seq:bar:Backend:${span.id}`)!;
  const frame = byId.get(`seq:frag:${par.id}`)!;
  assert.ok(
    bar.position.y + bar.style.height > frame.position.y + frame.style.height,
  );
});

test("no marker takes a row: rows are exactly the arrows and notes", () => {
  assert.equal(model.rows.length, arrowCount(ENROLMENT));
  assert.ok(model.rows.every((r, i) => r.rowIdx === i));
  assert.ok(model.rows.every((r) => r.kind === "message" || r.kind === "note"));
});

test("self-message rows are taller than straight-arrow rows", () => {
  // Row height: from one message's line to the next one's, where only
  // activation markers (which take no height) fall between them.
  const ys = new Map(
    messages(out.edges).map((e) => [
      streamIdxOf(e),
      handleY(byId, e.source, e.sourceHandle),
    ]),
  );
  const plain = (from: number, to: number) =>
    model.entries
      .filter((e) => e.streamIdx > from && e.streamIdx < to)
      .every((e) => e.kind === "activate" || e.kind === "deactivate");

  const msgs = model.entries.filter((e) => e.kind === "message");
  const self: number[] = [];
  const straight: number[] = [];
  for (let i = 0; i + 1 < msgs.length; i++) {
    const [a, b] = [msgs[i], msgs[i + 1]];
    if (!plain(a.streamIdx, b.streamIdx)) continue;
    (a.self ? self : straight).push(ys.get(b.streamIdx)! - ys.get(a.streamIdx)!);
  }
  assert.ok(self.length >= 2 && straight.length >= 2);
  assert.ok(Math.min(...self) > Math.max(...straight));
});

test("the ->>+ shorthand yields an identical span set", async () => {
  const short = await getSequenceForOrdo(ENROLMENT_SHORTHAND);
  assert.deepEqual(short.spans.map(spanKey).sort(), model.spans.map(spanKey).sort());
});

test("every straight message is level: both taps sit at one y", () => {
  for (const e of messages(out.edges)) {
    if (e.type !== "straight") continue;
    const from = handleY(byId, e.source, e.sourceHandle);
    const to = handleY(byId, e.target, e.targetHandle);
    assert.ok(Math.abs(from - to) < 0.02, `${e.id}: ${from} vs ${to}`);
  }
});

test("bars and tracks ride their lifelines exactly where they were placed", () => {
  const riders = out.nodes.filter((n) => n.type === "tube");
  assert.equal(riders.length, 11 + model.actors.length);
  for (const tube of riders) {
    const at = riderCentre(byId, tube);
    assert.ok(Math.abs(at.y - (tube.position.y + tube.style.height / 2)) < 0.05, tube.id);
    assert.ok(Math.abs(at.x - (tube.position.x + tube.style.width / 2)) < 0.05, tube.id);
    assert.ok(out.edges.some((e) => e.id === tube.data.attach?.edgeId));
  }
});

test("a re-entrant bar sits half a bar east of the one it nests in", () => {
  const [outer, inner] = spansOf(model, "Backend")
    .filter((s) => s.open > 30)
    .sort((p, q) => p.depth - q.depth);
  const a = byId.get(`seq:bar:Backend:${outer.id}`)!;
  const b = byId.get(`seq:bar:Backend:${inner.id}`)!;
  assert.equal(b.data.attach?.shift, a.style.width / 2);
  assert.equal(b.position.x - a.position.x, a.style.width / 2);
});

test("a message lands on the innermost activation open at its row", () => {
  const inner = spansOf(model, "Backend").find((s) => s.depth === 2)!;
  const poll = messages(out.edges).find((e) => streamIdxOf(e) === 47); // App → Backend, in the loop
  const reply = messages(out.edges).find((e) => streamIdxOf(e) === 49);
  assert.equal(poll?.target, `seq:bar:Backend:${inner.id}`);
  assert.equal(reply?.source, `seq:bar:Backend:${inner.id}`);

  // the message that opens a span arrives on that span's bar
  const submit = messages(out.edges).find((e) => streamIdxOf(e) === 6);
  const first = spansOf(model, "Backend").find((s) => s.open === 7)!;
  assert.equal(submit?.target, `seq:bar:Backend:${first.id}`);

  // and one outside every span lands on the track
  const load = messages(out.edges).find((e) => streamIdxOf(e) === 0);
  assert.equal(load?.source, "seq:track:App");
});

test("frames hold their rows, and nested frames sit inside their parents", () => {
  const frames = out.nodes.filter((n) => n.type === "fragment");
  assert.equal(frames.length, 3);

  const box = (n: SizedNode) => ({
    x1: n.position.x,
    y1: n.position.y,
    x2: n.position.x + n.style.width,
    y2: n.position.y + n.style.height,
  });
  const inside = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x1 >= b.x1 && a.y1 >= b.y1 && a.x2 <= b.x2 && a.y2 <= b.y2;

  const [par] = model.fragments;
  for (const child of par.children)
    assert.ok(inside(box(byId.get(`seq:frag:${child.id}`)!), box(byId.get(`seq:frag:${par.id}`)!)));

  const walk = (list: Fragment[]) =>
    list.forEach((f) => {
      const b = box(byId.get(`seq:frag:${f.id}`)!);
      for (const e of messages(out.edges)) {
        const i = streamIdxOf(e);
        if (i <= f.open || i >= f.close!) continue;
        const y = handleY(byId, e.source, e.sourceHandle);
        assert.ok(y > b.y1 && y < b.y2, `${e.id} inside ${f.operator}`);
      }
      walk(f.children);
    });
  walk(model.fragments);
});

test("an alt's divider falls between its two operands", () => {
  const alt = model.fragments[0].children.find((f) => f.operator === "alt")!;
  const node = byId.get(`seq:frag:${alt.id}`)!;
  const divider = node.position.y + node.data.dividers![0];
  const y = (i: number) => {
    const e = messages(out.edges).find((m) => streamIdxOf(m) === i)!;
    return handleY(byId, e.source, e.sourceHandle);
  };
  assert.ok(y(36) < divider && divider < y(38));
  assert.deepEqual(node.data.guards, ["PAN not in system (enrolment)", "PAN on dummy account (transfer)"]);
});

test("replies are dashed, calls are solid, both end in a filled arrow", () => {
  const call = messages(out.edges).find((e) => streamIdxOf(e) === 0)!;
  const reply = messages(out.edges).find((e) => streamIdxOf(e) === 4)!;
  assert.equal(call.style!.strokeDasharray, undefined);
  assert.equal(reply.style?.strokeDasharray, "8 4");
  assert.equal(call.data?.markerEnd, "arrow-filled");
  assert.equal(reply.data?.markerEnd, "arrow-filled");
});

test("self-messages loop out east and come back to the same tube", () => {
  const self = messages(out.edges).find((e) => streamIdxOf(e) === 8)!;
  assert.equal(self.type, "step");
  assert.equal(self.source, self.target);
  assert.match(self.sourceHandle!, /^b/);
  assert.match(self.targetHandle!, /^b/);
  assert.ok(handleY(byId, self.target, self.targetHandle) > handleY(byId, self.source, self.sourceHandle));
});

test("notes appear once, not twice", async () => {
  const lounge = await getSequenceForOrdo(LOUNGE);
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(LOUNGE);
  const { records } = dbOf(diagram).state;
  // the trap: Mermaid keeps every note in the stream AND in records.notes
  assert.equal(records.notes.length, 4);
  assert.equal(records.messages.filter((m) => m.type === dbOf(diagram).LINETYPE.NOTE).length, 4);

  const notes = sequenceToOrdo(lounge).nodes.filter((n) => n.data?.shape === "note");
  assert.equal(notes.length, 4);
  assert.equal(lounge.rows.length, 6 + 4);
});

test("notes sit where they were placed", async () => {
  const lounge = await getSequenceForOrdo(LOUNGE);
  const { nodes } = sequenceToOrdo(lounge);
  const ids = index(nodes);
  const centre = (actor: string) => {
    const head = ids.get(`seq:head:${actor}`)!;
    return head.position.x + head.style.width / 2;
  };
  const note = (label: string) =>
    nodes.find((n) => n.data?.shape === "note" && n.data.label === label)!;
  const span = (n: SizedNode) => [n.position.x, n.position.x + n.style.width];

  const [l1, r1] = span(note("Reads barcode and flight number"));
  assert.ok(l1 < centre("Gate") && centre("Gate") < r1);
  assert.ok(span(note("Tier and partner rules"))[0] > centre("Pass"));
  assert.ok(span(note("Waits at the desk"))[1] < centre("Traveller"));
  const [l2, r2] = span(note("Cached for 10 minutes"));
  assert.ok(l2 < centre("Pass") && centre("Wallet") < r2);
});

test("the stick-figure actor becomes the person shape; everyone shares one header height", async () => {
  const lounge = await getSequenceForOrdo(LOUNGE);
  const { nodes } = sequenceToOrdo(lounge);
  const heads = nodes.filter((n) => n.id.startsWith("seq:head:"));
  assert.equal(heads.find((n) => n.id === "seq:head:Traveller")?.data.shape, "person");
  assert.equal(new Set(heads.map((n) => n.style.height)).size, 1);
});

test("stacking is Mermaid's: lifelines, bars, frames, then messages", () => {
  const z = (x: { zIndex?: number }) => x.zIndex ?? 0;
  const life = out.edges.find((e) => e.id.startsWith("seq:life:"))!;
  const bar = out.nodes.find((n) => n.type === "tube" && !n.data.variant)!;
  const frame = out.nodes.find((n) => n.type === "fragment")!;
  const message = messages(out.edges)[0];
  assert.ok(z(life) <= z(bar));
  assert.ok(z(bar) < z(frame));
  assert.ok(z(frame) < z(message));
});

test("the same input imports to the same output", async () => {
  const again = sequenceToOrdo(await getSequenceForOrdo(ENROLMENT));
  assert.deepEqual(again, out);
});
