import { measureText as defaultMeasure, wrapText } from "../measure.js";
import { flatten } from "../ops.js";
import { drawShape } from "../shapes/registry.js";
import { DEFAULT_EDGE_STYLE, applyEdgeStyle } from "../edgeStyle.js";
import { TUBE_TYPE, TRACK } from "../nodes/tube.js";
import {
  FRAGMENT_TYPE,
  GUARD_BAND,
  TAB_H,
  headerWidth,
} from "../nodes/fragment.js";

// Sequence import, part two: the structural model → Ordo nodes and edges.
//
// Every coordinate is Ordo's own, worked out here with two running sums —
// columns across, a cursor down — and nothing taken from Mermaid's renderer.
// Text is measured with an injected `measureText` (by default the shared table
// in measure.js), so an import comes out the same in a browser, on a server and
// in a test.
//
// What comes out is the tube's reading of a sequence diagram:
//
//   participant   a header box, and its mirror at the foot
//   lifeline      a dashed edge from the header down to the foot
//   activation    a tube riding the lifeline, `t` of the way down; a
//                 re-entrant one shifted half a bar east of the one it nests in
//   the rest      a TRACK — an invisible tube riding the whole lifeline — that
//                 holds the taps for messages outside every activation
//   message       an edge from a tap on one tube to a tap on another, both
//                 pinned at the message's y, which is what keeps it level
//   fragment      a frame behind its rows; `box` groups and `rect` highlights
//                 are frames too
//   note          a note-shaped box
//
// Because bars and tracks RIDE their lifelines, moving a participant's header
// and foot carries every bar on that lifeline — and every message on those
// bars — along with it.

const n2 = (v) => Math.round(v * 100) / 100;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// The fonts each piece is drawn in.
const ACTOR_FONT = { size: 14, weight: 600 }; // Box's label slot
const MESSAGE_FONT = { size: 11, weight: 400 }; // OrdoEdge's label pill
const NOTE_FONT = { size: 13, weight: 400 }; // the note shape's label slot

// OrdoEdge's pill: 8px padding plus a 1px border either side, 2px plus 1px
// above and below, and a 1.4 line height.
const PILL_X = 9;
const PILL_Y = 3;
const PILL_LINE = MESSAGE_FONT.size * 1.4;

// Columns.
const COL_MIN_W = 120;
const LABEL_PAD = 12; // text to the edge of a shape's label slot
const ACTOR_GAP = 48; // between neighbouring header boxes
const HEADER_MIN_H = 48;
const WRAP_W = 150; // where a `wrap`ped label breaks

// The timeline. React Flow ends an edge at the OUTER edge of a 6px handle
// centred on the node's border, so a lifeline's path starts 3px below its
// header and stops 3px above its foot — and a rider's `t` is a fraction of
// that path, not of the gap between the boxes.
const HANDLE_REACH = 3;
const BAR_W = 14;
const TRACK_W = 4;
const BAR_LEAD = 8; // a bar starts this far above the message that opens it…
const BAR_TAIL = 8; // …and runs on this far past the one that closes it
const BAR_MIN_H = 28;
const MESSAGE_GAP = 40; // arrow to arrow, at the least
const LABEL_GAP = 4; // OrdoEdge's gap under an "above" label
const LABEL_CLEAR = 10; // a label's top to whatever is above it
const SELF_DROP = 26; // how far a self-message's loop comes back down
const SELF_LOOP = 20; // how far it reaches out — React Flow's step offset
const CLEAR = 10;

// Notes.
const NOTE_MIN_W = 100;
const NOTE_MIN_H = 36;
const NOTE_GAP = 10; // a left/right note's distance from its lifeline's bar
const NOTE_MARGIN = 12; // above a note
const NOTE_OVERHANG = 22; // how far a note over several lifelines reaches past them

// Frames.
const FRAME_GAP = 12; // above a frame
const FRAME_HEAD = TAB_H + 6; // the header band rows start under
const DIVIDER_GAP = 12;
const FRAME_FOOT = 12;
const FRAME_PAD = 22; // either side of what a frame encloses
const RECT_PAD = 8;

// Participant boxes.
const BOX_PAD = 14;
const BOX_TITLE = 26;

const BOTTOM_PAD = 32;

// Stacking, back to front, the order Mermaid paints in: filled regions, then
// lifelines and bars, then fragment frames, then messages. A frame's body is
// transparent and lets clicks through, so drawing it over the bars hides
// nothing — and behind them, a bar would hide the operator tab and the guards
// wherever a lifeline runs through a frame's header.
const Z_BOX = -2;
const Z_RECT = -1;
const Z_FRAME = 1;
const Z_MESSAGE = 2;

const LIFELINE_STYLE = { stroke: "#94a3b8", strokeWidth: 1, dash: "8 4" };
const DASHED = "8 4"; // LINE_TYPES' "dashed", so the toolbar reads it back

// Participant type → shape. The robustness icons (boundary, control, entity)
// have no shape of their own yet; an ellipse is the nearest honest stand-in.
const SHAPE_FOR = {
  participant: "rect",
  actor: "person",
  database: "cyl",
  collections: "st-rect",
  queue: "h-cyl",
  boundary: "circle",
  control: "circle",
  entity: "circle",
};

const headId = (actor) => `seq:head:${actor}`;
const footId = (actor) => `seq:foot:${actor}`;
const lifeId = (actor) => `seq:life:${actor}`;

// The label slot a shape gives its text at a size — read from the registry, so
// a box is sized by the very geometry that will draw it.
const slotOf = (shape, w, h) =>
  flatten(drawShape(shape, w, h)).find((op) => op.op === "label") ?? null;

// The smallest box, no smaller than minW × minH, whose label slot holds `size`
// with LABEL_PAD either side. Slots grow with their box, so a few steps settle.
function fitShape(shape, size, minW, minH) {
  let w = minW;
  let h = minH;
  for (let step = 0; step < 4; step++) {
    const slot = slotOf(shape, w, h);
    if (!slot) break;
    const dw = size.width + 2 * LABEL_PAD - slot.w;
    const dh = size.height + 4 - slot.h;
    if (dw <= 0.5 && dh <= 0.5) break;
    if (dw > 0.5) w += dw * Math.max(1, w / Math.max(1, slot.w));
    if (dh > 0.5) h += dh * Math.max(1, h / Math.max(1, slot.h));
  }
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

const boxNode = (id, x, y, w, h, data) => ({
  id,
  type: "box",
  position: { x: n2(x), y: n2(y) },
  style: { width: n2(w), height: n2(h) },
  data,
});

const frameNode = (id, x, y, w, h, zIndex, data) => ({
  id,
  type: FRAGMENT_TYPE,
  position: { x: n2(x), y: n2(y) },
  // grabbed by its border and tab only; see FragmentNode
  style: { width: n2(w), height: n2(h), pointerEvents: "none" },
  zIndex,
  data,
});

/**
 * @param model        readSequence's output
 * @param measureText  (text, { size, weight }) → { width, height, lines };
 *                     the shared table unless a caller injects another
 * @returns { nodes, edges, warnings }
 */
export function sequenceToOrdo(model, { measureText = defaultMeasure } = {}) {
  const measure = measureText;
  const wrap = (text, font, on) =>
    on ? wrapText(text, WRAP_W, font, measure) : text;

  // --- columns --------------------------------------------------------------
  const col = new Map(model.actors.map((a, i) => [a.id, i]));
  const cols = model.actors.map((a) => {
    const text = wrap(a.label, ACTOR_FONT, a.wrap);
    return {
      ...a,
      text,
      shape: SHAPE_FOR[a.kind] ?? "rect",
      size: measure(text || " ", ACTOR_FONT),
    };
  });
  const N = cols.length;

  // One header height for every column, so the lifelines all start level.
  const headerH = Math.max(
    HEADER_MIN_H,
    ...cols.map((c) => fitShape(c.shape, c.size, COL_MIN_W, HEADER_MIN_H).h),
  );
  for (const c of cols) c.w = fitShape(c.shape, c.size, COL_MIN_W, headerH).w;

  // What each message says, numbered if autonumber was on, and the size of
  // the pill it is drawn in.
  const shown = new Map();
  const pills = new Map();
  for (const e of model.entries) {
    if (e.kind !== "message") continue;
    const body = wrap(e.label, MESSAGE_FONT, e.wrap);
    const text =
      e.number != null ? (body ? `${e.number}. ${body}` : `${e.number}.`) : body;
    shown.set(e.streamIdx, text);
    if (!text) {
      pills.set(e.streamIdx, { w: 0, h: 0 });
      continue;
    }
    const m = measure(text, MESSAGE_FONT);
    pills.set(e.streamIdx, {
      w: m.width + 2 * PILL_X,
      h: m.lines * PILL_LINE + 2 * PILL_Y,
    });
  }

  const notes = new Map();
  for (const e of model.entries) {
    if (e.kind !== "note") continue;
    const text = wrap(e.label, NOTE_FONT, e.wrap);
    const fit = fitShape("note", measure(text || " ", NOTE_FONT), NOTE_MIN_W, NOTE_MIN_H);
    notes.set(e.streamIdx, { text, w: fit.w, h: fit.h, x: null, y: null });
  }

  // Centre-to-centre gaps: the boxes and the margin between them, plus room
  // for a participant box's padding where one box ends and the next begins…
  const seam = (i) =>
    cols[i].box === cols[i + 1].box
      ? 0
      : (cols[i].box != null ? BOX_PAD : 0) +
        (cols[i + 1].box != null ? BOX_PAD : 0) +
        CLEAR;
  const gaps = Array.from(
    { length: Math.max(0, N - 1) },
    (_, i) => cols[i].w / 2 + ACTOR_GAP + cols[i + 1].w / 2 + seam(i),
  );

  // …widened wherever a label needs more room than that.
  const needs = [];
  const need = (lo, hi, d) => {
    if (lo >= 0 && hi < N && lo < hi && d > 0)
      needs.push({ lo, hi, d, order: needs.length });
  };

  for (const e of model.entries) {
    if (e.kind === "message") {
      const a = col.get(e.from);
      const b = col.get(e.to);
      const p = pills.get(e.streamIdx);
      if (e.self) {
        // the label sits east of the loop, short of the next lifeline
        need(a, a + 1, BAR_W * 2 + HANDLE_REACH + SELF_LOOP + LABEL_GAP + p.w + CLEAR);
        continue;
      }
      // a created or destroyed end stops at its box's side, not its lifeline
      const boxed =
        e.creates || e.destroys === "to" ? b : e.destroys === "from" ? a : null;
      need(
        Math.min(a, b),
        Math.max(a, b),
        p.w + 2 * (BAR_W + CLEAR) + (boxed != null ? cols[boxed].w / 2 : 0),
      );
    } else if (e.kind === "note") {
      const a = col.get(e.from);
      const b = col.get(e.to);
      const { w } = notes.get(e.streamIdx);
      const beside = w + NOTE_GAP + 2 * BAR_W + CLEAR;
      if (e.placement === "left") need(a - 1, a, beside);
      else if (e.placement === "right") need(a, a + 1, beside);
      else if (a === b) {
        need(a - 1, a, w / 2 + BAR_W + CLEAR);
        need(a, a + 1, w / 2 + BAR_W + CLEAR);
      } else need(Math.min(a, b), Math.max(a, b), w - 2 * NOTE_OVERHANG);
    }
  }

  // Narrowest first, so a message across several columns only adds what the
  // nearer ones have not already made room for; each shortfall is shared
  // evenly by the gaps it spans. A rule, not a solver.
  needs.sort((p, q) => p.hi - p.lo - (q.hi - q.lo) || p.order - q.order);
  for (const { lo, hi, d } of needs) {
    let have = 0;
    for (let i = lo; i < hi; i++) have += gaps[i];
    if (have >= d) continue;
    const share = (d - have) / (hi - lo);
    for (let i = lo; i < hi; i++) gaps[i] += share;
  }

  const cx = [];
  cols.forEach((c, i) =>
    cx.push(
      i === 0 ? (c.box != null ? BOX_PAD : 0) + c.w / 2 : cx[i - 1] + gaps[i - 1],
    ),
  );

  // Notes across: centred over, or beside, their lifelines.
  for (const e of model.entries) {
    if (e.kind !== "note") continue;
    const g = notes.get(e.streamIdx);
    const a = col.get(e.from);
    const b = col.get(e.to);
    if (e.placement === "left") g.x = cx[a] - BAR_W / 2 - NOTE_GAP - g.w;
    else if (e.placement === "right") g.x = cx[a] + BAR_W / 2 + NOTE_GAP;
    else {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const x1 = lo === hi ? cx[lo] - g.w / 2 : cx[lo] - NOTE_OVERHANG;
      const x2 = lo === hi ? cx[lo] + g.w / 2 : cx[hi] + NOTE_OVERHANG;
      const width = Math.max(g.w, x2 - x1);
      g.x = (x1 + x2) / 2 - width / 2;
      g.w = width;
    }
  }

  // --- rows: one cursor, walked down the stream -----------------------------
  // Arrows and notes take height. Fragment markers take height too — a header
  // band, a divider, a foot — or frames would sit on top of the rows they hold.
  // Activation markers take none: a bar starts at the arrow that opens it and
  // ends where the cursor stands when it closes.
  const frameOf = new Map();
  const visit = (list) =>
    list.forEach((f) => {
      frameOf.set(f.id, f);
      visit(f.children);
    });
  visit(model.fragments);

  const arrowY = new Map(); // message → y of its line
  const returnY = new Map(); // self-message → y its loop comes back at
  const barY = new Map(); // span id → { top, bottom }
  const frameY = new Map(); // fragment id → { top, bottom, dividers }
  const headY = new Map(); // created participant → its header's top
  const footY = new Map(); // destroyed participant → its foot's top

  let cursor = headerH;
  let last = null; // what last moved the cursor

  for (const e of model.entries) {
    switch (e.kind) {
      case "message": {
        const p = pills.get(e.streamIdx);
        const boxed = e.creates || e.destroys;
        const y =
          cursor +
          Math.max(
            MESSAGE_GAP,
            p.h ? p.h + LABEL_GAP + LABEL_CLEAR : 0,
            boxed ? headerH / 2 + LABEL_CLEAR : 0,
          );
        arrowY.set(e.streamIdx, y);
        cursor = y;
        if (e.self) {
          cursor = y + Math.max(SELF_DROP, p.h + 6);
          returnY.set(e.streamIdx, cursor);
        }
        // Mermaid centres a created participant's header, and a destroyed
        // one's foot, on the arrow that creates or destroys it.
        if (e.creates) headY.set(e.to, y - headerH / 2);
        if (e.destroys)
          footY.set(e.destroys === "to" ? e.to : e.from, y - headerH / 2);
        if (boxed) cursor = Math.max(cursor, y + headerH / 2);
        last = "message";
        break;
      }
      case "note": {
        const g = notes.get(e.streamIdx);
        g.y = cursor + NOTE_MARGIN;
        cursor = g.y + g.h;
        last = "note";
        break;
      }
      case "activate":
        if (e.span != null)
          barY.set(e.span, {
            top: cursor - (last === "message" ? BAR_LEAD : 0),
            bottom: null,
          });
        break;
      case "deactivate": {
        const g = barY.get(e.span);
        if (g) g.bottom = Math.max(cursor + BAR_TAIL, g.top + BAR_MIN_H);
        break;
      }
      case "open": {
        const rect = frameOf.get(e.fragment)?.operator === "rect";
        const top = cursor + (rect ? RECT_PAD : FRAME_GAP);
        frameY.set(e.fragment, { top, bottom: null, dividers: [] });
        cursor = top + (rect ? RECT_PAD : FRAME_HEAD);
        last = "frame";
        break;
      }
      case "mid": {
        const g = frameY.get(e.fragment);
        const y = cursor + DIVIDER_GAP;
        g.dividers.push(y);
        cursor = y + GUARD_BAND;
        last = "frame";
        break;
      }
      case "close": {
        const g = frameY.get(e.fragment);
        const rect = frameOf.get(e.fragment)?.operator === "rect";
        g.bottom = cursor + (rect ? RECT_PAD : FRAME_FOOT);
        cursor = g.bottom;
        last = "frame";
        break;
      }
    }
  }

  const bottom = cursor + BOTTOM_PAD; // where the feet start

  // --- lifelines and the tubes that ride them -------------------------------
  const lifelines = cols.map((c) => {
    const head = headY.get(c.id) ?? 0;
    const foot = footY.get(c.id) ?? bottom;
    const from = head + headerH + HANDLE_REACH;
    return { head, foot, from, length: Math.max(1, foot - HANDLE_REACH - from) };
  });

  // A rider's `t` puts its CENTRE on the path, which is what TubeFollower reads.
  const riding = (actor, top, height, shift = 0) => {
    const life = lifelines[col.get(actor)];
    const t = clamp01((top + height / 2 - life.from) / life.length);
    return {
      edgeId: lifeId(actor),
      t: Math.round(t * 1e6) / 1e6,
      angle: 90,
      ...(shift ? { shift } : {}),
    };
  };

  const tracks = new Map(
    cols.map((c, i) => {
      const life = lifelines[i];
      return [
        c.id,
        {
          id: `seq:track:${c.id}`,
          actor: c.id,
          track: true,
          depth: 0,
          x: cx[i] - TRACK_W / 2,
          top: life.from,
          bottom: life.from + life.length,
          width: TRACK_W,
          attach: riding(c.id, life.from, life.length),
          taps: [],
        },
      ];
    }),
  );

  const bars = [];
  for (const s of model.spans) {
    const g = barY.get(s.id);
    const i = col.get(s.actor);
    if (!g || g.bottom == null || i == null) continue;
    const shift = ((s.depth - 1) * BAR_W) / 2;
    bars.push({
      id: `seq:bar:${s.actor}:${s.id}`,
      actor: s.actor,
      track: false,
      depth: s.depth,
      x: cx[i] + shift - BAR_W / 2,
      top: g.top,
      bottom: g.bottom,
      width: BAR_W,
      attach: riding(s.actor, g.top, g.bottom - g.top, shift),
      taps: [],
    });
  }
  bars.sort((p, q) => p.depth - q.depth || p.top - q.top);

  const barsOf = new Map();
  for (const b of bars) barsOf.set(b.actor, [...(barsOf.get(b.actor) ?? []), b]);

  // Where a message lands on a lifeline: the innermost activation holding that
  // y, or the track when none does.
  const tubeAt = (actor, y) => {
    let best = null;
    for (const b of barsOf.get(actor) ?? []) {
      if (y < b.top || y > b.bottom) continue;
      if (!best || b.depth > best.depth || (b.depth === best.depth && b.top > best.top))
        best = b;
    }
    return best ?? tracks.get(actor);
  };

  const tap = (tube, y, side) => {
    const at = n2(y - tube.top);
    tube.taps.push(at);
    return { tube, at, side };
  };

  // Lines run east when the target is to the right; a self-message loops east.
  const wires = [];
  for (const e of model.entries) {
    if (e.kind !== "message") continue;
    const y = arrowY.get(e.streamIdx);
    const east = col.get(e.to) >= col.get(e.from);
    const back = e.self ? returnY.get(e.streamIdx) : y;
    const source =
      e.destroys === "from"
        ? { node: footId(e.from), handle: east ? "e" : "w" }
        : tap(tubeAt(e.from, y), y, east ? "b" : "a");
    const target = e.creates
      ? { node: headId(e.to), handle: east ? "w" : "e" }
      : e.destroys === "to"
        ? { node: footId(e.to), handle: east ? "w" : "e" }
        : tap(tubeAt(e.to, back), back, e.self || !east ? "b" : "a");
    wires.push({ e, source, target });
  }

  // Taps go in head-to-tail order, so a tube's +/− works on its last one.
  const settle = (tube) => {
    tube.taps = [...new Set(tube.taps)].sort((p, q) => p - q);
    tube.index = new Map(tube.taps.map((at, i) => [at, i]));
  };
  tracks.forEach(settle);
  bars.forEach(settle);
  const end = (ref) =>
    ref.tube
      ? { node: ref.tube.id, handle: `${ref.side}${ref.tube.index.get(ref.at)}` }
      : ref;

  // --- frames across: what they hold, padded ---------------------------------
  const spanAll = () =>
    N
      ? [cx[0] - cols[0].w / 2, cx[N - 1] + cols[N - 1].w / 2]
      : [0, COL_MIN_W];
  const extents = new Map();
  const frameX = (f) => {
    if (extents.has(f.id)) return extents.get(f.id);
    let x1 = Infinity;
    let x2 = -Infinity;
    const take = (l, r) => {
      x1 = Math.min(x1, l);
      x2 = Math.max(x2, r);
    };
    for (const e of model.entries) {
      if (e.streamIdx <= f.open || e.streamIdx >= f.close) continue;
      if (e.kind === "message") {
        const a = cx[col.get(e.from)];
        const b = cx[col.get(e.to)];
        if (e.self)
          take(a, a + BAR_W + HANDLE_REACH + SELF_LOOP + LABEL_GAP + pills.get(e.streamIdx).w);
        else take(Math.min(a, b), Math.max(a, b));
      } else if (e.kind === "note") {
        const g = notes.get(e.streamIdx);
        take(g.x, g.x + g.w);
      }
    }
    // A child is taken WITH its padding, so each level of nesting adds a
    // margin of its own.
    for (const child of f.children) {
      const c = frameX(child);
      take(c.x1, c.x2);
    }
    if (x1 === Infinity) take(...spanAll()); // nothing inside: span the diagram
    const pad = f.operator === "rect" ? RECT_PAD * 2 : FRAME_PAD;
    const out = { x1: x1 - pad, x2: Math.max(x2 + pad, x1 - pad + headerWidth(f)) };
    extents.set(f.id, out);
    return out;
  };

  // --- emit -------------------------------------------------------------------
  const nodes = [];

  // Frames first, outer before inner, so nested frames paint in order.
  model.boxes.forEach((box) => {
    const members = box.actors.map((id) => col.get(id)).filter((i) => i != null);
    if (!members.length) return;
    const x1 = Math.min(...members.map((i) => cx[i] - cols[i].w / 2)) - BOX_PAD;
    const x2 = Math.max(...members.map((i) => cx[i] + cols[i].w / 2)) + BOX_PAD;
    const y1 = -BOX_TITLE - BOX_PAD / 2;
    const y2 = Math.max(...members.map((i) => lifelines[i].foot)) + headerH + BOX_PAD / 2;
    const data = {
      operator: "box",
      guards: [box.label],
      dividers: [],
      ...(box.fill ? { fill: box.fill } : {}),
    };
    nodes.push(
      frameNode(`seq:box:${box.id}`, x1, y1, Math.max(x2 - x1, headerWidth(data)), y2 - y1, Z_BOX, data),
    );
  });

  const emitFrames = (list) =>
    list.forEach((f) => {
      const x = frameX(f);
      const y = frameY.get(f.id);
      if (y?.bottom != null) {
        nodes.push(
          frameNode(`seq:frag:${f.id}`, x.x1, y.top, x.x2 - x.x1, y.bottom - y.top, f.operator === "rect" ? Z_RECT : Z_FRAME, {
            operator: f.operator,
            guards: [...f.guards],
            dividers: y.dividers.map((d) => n2(d - y.top)),
            ...(f.fill ? { fill: f.fill } : {}),
          }),
        );
      }
      emitFrames(f.children);
    });
  emitFrames(model.fragments);

  cols.forEach((c, i) => {
    const x = cx[i] - c.w / 2;
    const life = lifelines[i];
    const data = { shape: c.shape, label: c.text };
    nodes.push(boxNode(headId(c.id), x, life.head, c.w, headerH, data));
    nodes.push(boxNode(footId(c.id), x, life.foot, c.w, headerH, { ...data }));
  });

  // Tracks under bars, shallow bars under deep ones.
  for (const tube of [...tracks.values(), ...bars]) {
    nodes.push({
      id: tube.id,
      type: TUBE_TYPE,
      position: { x: n2(tube.x), y: n2(tube.top) },
      style: { width: tube.width, height: n2(tube.bottom - tube.top) },
      data: {
        ...(tube.track ? { variant: TRACK } : {}),
        taps: tube.taps,
        attach: tube.attach,
      },
    });
  }

  // Notes over the lifelines they annotate, as Mermaid paints them. (The
  // diagram's title is not drawn here: it names the group the import lands in.)
  for (const [streamIdx, g] of notes)
    nodes.push(boxNode(`seq:note:${streamIdx}`, g.x, g.y, g.w, g.h, { shape: "note", label: g.text }));

  // Lifelines first: when a dragged bar is dropped where a lifeline and a
  // message cross, the tie goes to the lifeline it came from.
  const edges = cols.map((c) =>
    applyEdgeStyle(
      {
        id: lifeId(c.id),
        source: headId(c.id),
        sourceHandle: "s",
        target: footId(c.id),
        targetHandle: "n",
        data: { label: "" },
      },
      {
        ...DEFAULT_EDGE_STYLE,
        ...LIFELINE_STYLE,
        route: "straight",
        markerStart: "none",
        markerEnd: "none",
      },
    ),
  );

  for (const { e, source, target } of wires) {
    const s = end(source);
    const t = end(target);
    edges.push({
      ...applyEdgeStyle(
        {
          id: `seq:msg:${e.streamIdx}`,
          source: s.node,
          sourceHandle: s.handle,
          target: t.node,
          targetHandle: t.handle,
          data: {
            label: shown.get(e.streamIdx) ?? "",
            labelPlacement: e.self ? "right" : "above",
          },
        },
        {
          ...DEFAULT_EDGE_STYLE,
          route: e.self ? "step" : "straight",
          dash: e.dashed ? DASHED : "",
          markerStart: e.start,
          markerEnd: e.end,
        },
      ),
      zIndex: Z_MESSAGE,
    });
  }

  return { nodes, edges, warnings: [] };
}
