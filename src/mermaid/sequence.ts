import mermaid from "./mermaid.ts";

// Sequence import, part one: Mermaid's parse → a plain structural model.
//
// PARSE-ONLY, deliberately unlike the flowchart path. A flowchart's positions
// come out of dagre — a solver nothing else reproduces — so they are harvested
// from a real render. A sequence diagram has no solver: its layout is two
// running sums, columns across and rows down, and Mermaid's own numbers would
// only carry Mermaid's fonts and padding into Ordo. So nothing here renders,
// measures or touches the DOM; sequenceToOrdo.ts does the arithmetic in Ordo's
// own units.
//
// Everything comes from `db.state.records`, and three things about it are easy
// to get wrong:
//
//   1. It is ONE flat stream (`messages`): arrows, notes, activation markers,
//      fragment markers, autonumber switches. Entries are told apart by
//      `type`, read by NAME through db.LINETYPE — the numbers are Mermaid's to
//      renumber.
//   2. Notes are in it twice: in the stream, and again in `records.notes`.
//      Only the stream knows where a note falls, so `notes` is never read.
//   3. A message's `activate` flag is never the field to read. `activate X`
//      leaves it false; `->>+` sets it AND still emits an ACTIVE_START. The
//      markers are the one consistent account of activation.

// ---------------------------------------------------------------------------
// What is read out of Mermaid
// ---------------------------------------------------------------------------

// Mermaid's sequence records, typed as this file reads them: the fields it
// touches, as optional as it is careful about them. They are parse output, not
// API — `state` is private on Mermaid's own SequenceDB type — and readSequence
// checks their shape at runtime, so they are written down here rather than
// imported.
type SeqActor = {
  name: string;
  description?: string;
  type?: string;
  wrap?: boolean;
  prevActor?: string;
  nextActor?: string;
};

// An autonumber entry's `message` is its settings rather than text.
type Autonumber = { start?: number; step?: number; visible?: boolean };

type SeqMessage = {
  type: number; // a LINETYPE value
  from?: string;
  to?: string;
  message?: string | Autonumber;
  wrap?: boolean;
  placement?: number; // a PLACEMENT value
  centralConnection?: number;
};

type SeqBox = { name?: string; fill?: string; actorKeys?: string[] };

type SeqDb = {
  state?: {
    records?: {
      actors: Map<string, SeqActor>;
      messages: SeqMessage[];
      boxes?: SeqBox[];
      createdActors?: Map<string, number>;
      destroyedActors?: Map<string, number>;
    };
  };
  LINETYPE?: Record<string, number>;
  PLACEMENT?: { LEFTOF: number; RIGHTOF: number; OVER: number };
  getConfig?: () => { showSequenceNumbers?: boolean } | undefined;
  getDiagramTitle?: () => string;
};

// ---------------------------------------------------------------------------
// The model it is read into
// ---------------------------------------------------------------------------

export type SequenceActor = {
  id: string;
  label: string;
  kind: string;
  col: number;
  box: number | null;
  wrap: boolean;
  created: number | null; // the stream index that creates it
  destroyed: number | null; // …and the one that destroys it
};

export type SequenceBox = {
  id: number;
  label: string;
  fill: string | null;
  actors: string[];
};

export type Row = {
  streamIdx: number;
  rowIdx: number;
  kind: "message" | "note";
  msg: SeqMessage;
};

export type Span = {
  id: number;
  actor: string;
  startRow: number;
  endRow: number;
  depth: number;
  open: number;
  close: number;
};

export type Fragment = {
  id: number;
  operator: string;
  guards: string[];
  fill?: string | null;
  startRow: number | null;
  endRow: number | null;
  dividerRows: (number | null)[];
  depth: number;
  children: Fragment[];
  open: number;
  close: number | null;
};

export type MessageEntry = {
  kind: "message";
  streamIdx: number;
  rowIdx: number;
  from: string;
  to: string;
  self: boolean;
  label: string;
  number: number | null;
  wrap: boolean;
  dashed: boolean;
  start: string;
  end: string;
  creates: boolean;
  destroys: "from" | "to" | null;
};

export type NoteEntry = {
  kind: "note";
  streamIdx: number;
  rowIdx: number;
  from: string;
  to: string;
  placement: "left" | "right" | "over";
  label: string;
  wrap: boolean;
};

export type ActivateEntry = {
  kind: "activate";
  streamIdx: number;
  actor: string;
  span: number | null;
};

export type DeactivateEntry = {
  kind: "deactivate";
  streamIdx: number;
  actor: string;
  span: number;
};

// A fragment's markers: where it opens, each divider, where it closes.
export type FrameEntry = {
  kind: "open" | "mid" | "close";
  streamIdx: number;
  fragment: number;
};

export type Entry =
  | MessageEntry
  | NoteEntry
  | ActivateEntry
  | DeactivateEntry
  | FrameEntry;

export type SequenceModel = {
  title: string | null;
  actors: SequenceActor[];
  boxes: SequenceBox[];
  rows: Row[];
  spans: Span[];
  fragments: Fragment[];
  entries: Entry[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  hearts: "♥",
  check: "✓",
};

const fromCode = (code: number) =>
  Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : "";

const decodeEntity = (match: string, body: string) => {
  if (body[0] !== "#") return NAMED[body.toLowerCase()] ?? match;
  const hex = body[1] === "x" || body[1] === "X";
  return fromCode(hex ? parseInt(body.slice(2), 16) : Number(body.slice(1))) || match;
};

/**
 * A Mermaid label as plain text. Mermaid swaps `#9829;`-style entities for
 * placeholders before it parses (ﬂ°°9829¶ß, ﬂ°quot¶ß) and leaves its supported
 * HTML in labels for its renderer; Ordo labels are text, so here <br> becomes a
 * line break, any other tag is dropped, and entities of either spelling are
 * decoded. Tags go first, so an escaped `#60;b#62;` survives as text.
 */
export function cleanText(raw: unknown) {
  if (raw == null || typeof raw === "object") return "";
  return String(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][^<>]*>/gi, "")
    .replace(/ﬂ°°(\d+)¶ß/g, (_, d) => fromCode(Number(d)))
    .replace(/ﬂ°(\w+)¶ß/g, (_, name) => NAMED[name] ?? `&${name};`)
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// The stream's vocabulary, by LINETYPE name
// ---------------------------------------------------------------------------

const OPEN: Record<string, string> = {
  LOOP_START: "loop",
  ALT_START: "alt",
  OPT_START: "opt",
  PAR_START: "par",
  PAR_OVER_START: "par",
  CRITICAL_START: "critical",
  BREAK_START: "break",
  RECT_START: "rect",
};
const MID: Record<string, string> = {
  ALT_ELSE: "alt",
  PAR_AND: "par",
  CRITICAL_OPTION: "critical",
};
const CLOSE: Record<string, string> = {
  LOOP_END: "loop",
  ALT_END: "alt",
  OPT_END: "opt",
  PAR_END: "par",
  CRITICAL_END: "critical",
  BREAK_END: "break",
  RECT_END: "rect",
};

// A central connection (`->>()`) emits a marker that opens an activation
// Mermaid never closes and never draws. It is skipped; its message is kept.
const SKIPPED = new Set([
  "AUTONUMBER",
  "CENTRAL_CONNECTION",
  "CENTRAL_CONNECTION_REVERSE",
]);

const MARKERS = new Set([
  ...Object.keys(OPEN),
  ...Object.keys(MID),
  ...Object.keys(CLOSE),
  ...SKIPPED,
  "ACTIVE_START",
  "ACTIVE_END",
]);

// Arrow types → line and end markers, in the marker vocabulary of
// edges/markers.tsx.
const FILLED = "arrow-filled";
const OPEN_HEAD = "arrow";

// Marker keys for either end, and whether the line is dashed.
type Arrow = { start?: string; end?: string; dashed?: boolean };

const ARROWS: Record<string, Arrow> = {
  SOLID: { end: FILLED },
  DOTTED: { end: FILLED, dashed: true },
  SOLID_CROSS: { end: "cross" },
  DOTTED_CROSS: { end: "cross", dashed: true },
  SOLID_OPEN: {},
  DOTTED_OPEN: { dashed: true },
  SOLID_POINT: { end: OPEN_HEAD },
  DOTTED_POINT: { end: OPEN_HEAD, dashed: true },
  BIDIRECTIONAL_SOLID: { start: FILLED, end: FILLED },
  BIDIRECTIONAL_DOTTED: { start: FILLED, end: FILLED, dashed: true },
};

// The half-arrowheads (`-|\`, `-//` and their reverses) have no Ordo marker
// yet. Each is drawn with the whole head of its kind, at the end it points to.
const HALF = /^(SOLID|STICK)(_ARROW)?_(TOP|BOTTOM)(_REVERSE)?(_DOTTED)?$/;

const arrowOf = (name: string | undefined): Arrow | null => {
  if (name && ARROWS[name]) return ARROWS[name];
  const half = HALF.exec(name ?? "");
  if (!half) return null;
  const head = half[1] === "SOLID" ? FILLED : OPEN_HEAD;
  const dashed = Boolean(half[5]);
  return half[4] ? { start: head, dashed } : { end: head, dashed };
};

// ---------------------------------------------------------------------------

/** Parse `src` and read it into the model. Throws on anything but a sequence diagram. */
export async function getSequenceForOrdo(src: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(src);
  // `type`, not `diagramType`: that field belongs to parse()'s result, and on
  // a Diagram it is undefined.
  if (diagram.type !== "sequence") {
    throw new Error(
      `Not a sequence diagram — Mermaid read it as "${diagram.type}".`,
    );
  }
  return readSequence(diagram);
}

/**
 * The structural model of a parsed sequence diagram:
 *
 *   actors     in column order: { id, label, kind, col, box, wrap, created, destroyed }
 *   boxes      participant groups: { id, label, fill, actors }
 *   rows       arrows and notes only, in order: { streamIdx, rowIdx, kind, msg }
 *   spans      activations: { id, actor, startRow, endRow, depth, open, close }
 *   fragments  the root frames, each { id, operator, guards, startRow, endRow,
 *              dividerRows, depth, children, open, close, fill? }
 *   entries    the stream, normalised and in order — what the layout walks
 *   title, warnings
 *
 * Row indices count arrows and notes only: markers never occupy a row.
 */
export function readSequence(diagram: { db: unknown }): SequenceModel {
  const db = diagram.db as SeqDb;
  const records = db?.state?.records;

  // Parse output, not a documented API. If an upgrade reshapes it, the import
  // must fail loudly rather than come back as an empty diagram.
  if (!(records?.actors instanceof Map) || !Array.isArray(records?.messages)) {
    throw new Error(
      "Mermaid's sequence records are not the shape Ordo was built against (mermaid@12.0.0).",
    );
  }

  const NAME: Record<number, string> = {};
  for (const [name, value] of Object.entries(db.LINETYPE ?? {})) NAME[value] = name;
  const PLACE = db.PLACEMENT ?? { LEFTOF: 0, RIGHTOF: 1, OVER: 2 };
  const placementOf = (value: number | undefined) =>
    value === PLACE.LEFTOF ? "left" : value === PLACE.RIGHTOF ? "right" : "over";

  const warnings: string[] = [];
  const stream = records.messages;

  // --- columns --------------------------------------------------------------
  // Order comes from the prevActor/nextActor chain, not the Map's insertion
  // order. Anything the chain somehow misses still gets a column, at the end.
  // Keyed to take a missing name too: an end of the chain is simply not found.
  const byName: Map<string | undefined, SeqActor> = records.actors;
  const chain: SeqActor[] = [];
  const seen = new Set<string>();
  let at = [...byName.values()].find(
    (a) => a.prevActor === undefined || !byName.has(a.prevActor),
  );
  while (at && !seen.has(at.name)) {
    seen.add(at.name);
    chain.push(at);
    at = byName.get(at.nextActor);
  }
  for (const a of byName.values()) {
    if (seen.has(a.name)) continue;
    warnings.push(`Participant ${a.name} was off the column chain; placed last.`);
    chain.push(a);
  }

  const created: Map<string | undefined, number> =
    records.createdActors ?? new Map();
  const destroyed: Map<string | undefined, number> =
    records.destroyedActors ?? new Map();

  const actors = chain.map((a, col): SequenceActor => ({
    id: a.name,
    label: cleanText(a.description ?? a.name),
    kind: a.type ?? "participant",
    col,
    box: null,
    wrap: Boolean(a.wrap),
    created: created.get(a.name) ?? null,
    destroyed: destroyed.get(a.name) ?? null,
  }));
  const actorById = new Map<string | undefined, SequenceActor>(
    actors.map((a) => [a.id, a]),
  );

  const boxes = (records.boxes ?? []).map((b, id): SequenceBox => ({
    id,
    label: cleanText(b.name ?? ""),
    fill: b.fill && b.fill !== "transparent" ? b.fill : null,
    actors: [...(b.actorKeys ?? [])],
  }));
  for (const box of boxes)
    for (const name of box.actors) {
      const a = actorById.get(name);
      if (a) a.box = box.id;
    }

  // --- pass 1: split the stream ---------------------------------------------
  // Markers do not occupy a row. If they consumed row indices, every diagram
  // would gain gaps Mermaid does not draw.
  const kindOf = (msg: SeqMessage) => {
    const name = NAME[msg.type];
    if (name === "NOTE") return "note";
    if (MARKERS.has(name)) return "marker";
    return actorById.has(msg.from) && actorById.has(msg.to) ? "message" : null;
  };

  const rows: Row[] = [];
  const rowOf = new Array<Row | null>(stream.length).fill(null);
  stream.forEach((msg, streamIdx) => {
    const kind = kindOf(msg);
    if (kind !== "note" && kind !== "message") return;
    const row: Row = { streamIdx, rowIdx: rows.length, kind, msg };
    rows.push(row);
    rowOf[streamIdx] = row;
  });

  // The nearest row strictly before / after each stream index, as prefix
  // arrays — a marker's anchor is a lookup, not a search.
  const before = new Array<Row | null>(stream.length).fill(null);
  const after = new Array<Row | null>(stream.length).fill(null);
  for (let i = 0, last: Row | null = null; i < stream.length; i++) {
    before[i] = last;
    if (rowOf[i]) last = rowOf[i];
  }
  for (let i = stream.length - 1, next: Row | null = null; i >= 0; i--) {
    after[i] = next;
    if (rowOf[i]) next = rowOf[i];
  }

  // --- passes 2 and 3, walked together --------------------------------------
  // Activations (a stack PER ACTOR) and fragments (one global stack) are
  // independent of each other and may cross: an activation can open inside a
  // `par` operand and close after the `par` ends. Neither is scoped to the
  // other.
  const entries: Entry[] = [];
  const spans: Span[] = [];
  const stacks = new Map<
    string,
    { startRow: number; depth: number; open: number; entry: ActivateEntry }[]
  >();
  const fragments: Fragment[] = [];
  const frames: Fragment[] = [];
  const openFrames: Fragment[] = [];
  let central = 0;

  // Mermaid numbers every arrow while autonumber is on, counting on through
  // stretches where it is off.
  const numbering = {
    index: 1,
    step: 1,
    visible: Boolean(db.getConfig?.()?.showSequenceNumbers),
  };

  const closeFrame = (frame: Fragment, streamIdx: number) => {
    frame.close = streamIdx;
    frame.endRow =
      (streamIdx < stream.length ? before[streamIdx] : rows[rows.length - 1])
        ?.rowIdx ?? null;
    // nothing between the markers: no rows to span
    if (
      frame.startRow == null ||
      frame.endRow == null ||
      frame.startRow > frame.endRow
    ) {
      frame.startRow = null;
      frame.endRow = null;
    }
    (openFrames[openFrames.length - 1]?.children ?? fragments).push(frame);
    entries.push({ kind: "close", streamIdx, fragment: frame.id });
  };

  stream.forEach((msg, i) => {
    const name = NAME[msg.type];
    const row = rowOf[i];

    if (row?.kind === "message") {
      const arrow = arrowOf(name);
      if (!arrow)
        warnings.push(`Arrow type ${name ?? msg.type} has no Ordo equivalent; drawn as a solid arrow.`);
      if (msg.centralConnection) central += 1;

      const number = numbering.visible ? numbering.index : null;
      numbering.index =
        Math.round((numbering.index + numbering.step) * 100) / 100;

      const creates = created.get(msg.to) === i;
      const destroys = creates
        ? null
        : destroyed.get(msg.from) === i
          ? "from"
          : destroyed.get(msg.to) === i
            ? "to"
            : null;

      // a message row's ends are both actors: that is what made it one
      entries.push({
        kind: "message",
        streamIdx: i,
        rowIdx: row.rowIdx,
        from: msg.from!,
        to: msg.to!,
        self: msg.from === msg.to,
        label: cleanText(msg.message),
        number,
        wrap: Boolean(msg.wrap),
        dashed: Boolean(arrow?.dashed),
        start: arrow?.start ?? "none",
        end: arrow ? (arrow.end ?? "none") : FILLED,
        creates,
        destroys,
      });
      return;
    }

    if (row?.kind === "note") {
      entries.push({
        kind: "note",
        streamIdx: i,
        rowIdx: row.rowIdx,
        from: msg.from!,
        to: (msg.to ?? msg.from)!,
        placement: placementOf(msg.placement),
        label: cleanText(msg.message),
        wrap: Boolean(msg.wrap),
      });
      return;
    }

    if (name === "ACTIVE_START") {
      // Markers carry `from`; `to` is always undefined. Keyed on `from`.
      const actor = msg.from!;
      const stack = stacks.get(actor) ?? [];
      const entry: ActivateEntry = {
        kind: "activate",
        streamIdx: i,
        actor,
        span: null,
      };
      stack.push({
        // the nearest row BEFORE: the previous stream entry is often another marker
        startRow: before[i]?.rowIdx ?? 0,
        depth: stack.length + 1,
        open: i,
        entry,
      });
      stacks.set(actor, stack);
      entries.push(entry);
      return;
    }

    if (name === "ACTIVE_END") {
      const actor = msg.from!;
      const opened = stacks.get(actor)?.pop();
      // Mermaid's own parser rejects this first; the check stays so that a
      // reshaped stream fails here, loudly, rather than as a misdrawn bar.
      if (!opened) throw new Error(`unbalanced deactivate: ${actor} at ${i}`);
      const span = {
        id: spans.length,
        actor,
        startRow: opened.startRow,
        endRow: before[i]?.rowIdx ?? 0,
        depth: opened.depth,
        open: opened.open,
        close: i,
      };
      spans.push(span);
      opened.entry.span = span.id;
      entries.push({ kind: "deactivate", streamIdx: i, actor, span: span.id });
      return;
    }

    if (name === "AUTONUMBER") {
      const m = (msg.message ?? {}) as Autonumber;
      numbering.index = m.start || numbering.index;
      numbering.step = m.step || numbering.step;
      numbering.visible = Boolean(m.visible);
      return;
    }

    if (OPEN[name]) {
      const operator = OPEN[name];
      const text = cleanText(msg.message);
      const frame: Fragment = {
        id: frames.length,
        operator,
        // a `rect`'s "guard" is its colour
        guards: operator === "rect" ? [] : [text],
        ...(operator === "rect" ? { fill: text || null } : {}),
        // a fragment starts BETWEEN rows, above the first one it holds
        startRow: after[i]?.rowIdx ?? null,
        endRow: null,
        dividerRows: [],
        depth: openFrames.length + 1,
        children: [],
        open: i,
        close: null,
      };
      frames.push(frame);
      openFrames.push(frame);
      entries.push({ kind: "open", streamIdx: i, fragment: frame.id });
      return;
    }

    if (MID[name]) {
      const frame = openFrames[openFrames.length - 1];
      if (!frame) {
        warnings.push(`${name} at ${i} is outside any fragment; ignored.`);
        return;
      }
      frame.guards.push(cleanText(msg.message));
      frame.dividerRows.push(after[i]?.rowIdx ?? null);
      entries.push({ kind: "mid", streamIdx: i, fragment: frame.id });
      return;
    }

    if (CLOSE[name]) {
      const frame = openFrames.pop();
      if (!frame) {
        warnings.push(`${name} at ${i} closes nothing; ignored.`);
        return;
      }
      if (frame.operator !== CLOSE[name])
        warnings.push(`${name} at ${i} closes a ${frame.operator}.`);
      closeFrame(frame, i);
      return;
    }

    if (!SKIPPED.has(name))
      warnings.push(`Stream entry ${i} (${name ?? msg.type}) is not something Ordo draws; skipped.`);
  });

  // Mermaid does not draw an activation that is never closed; neither does
  // Ordo. Unclosed fragments cannot come out of Mermaid's parser, but a frame
  // left open is closed at the end rather than lost.
  for (const [actor, stack] of stacks)
    for (const opened of stack)
      warnings.push(`${actor} is activated at ${opened.open} and never deactivated; not drawn, as in Mermaid.`);
  while (openFrames.length) {
    const frame = openFrames.pop()!;
    warnings.push(`The ${frame.operator} opened at ${frame.open} never ends; closed at the end.`);
    closeFrame(frame, stream.length);
  }
  if (central)
    warnings.push(`${central} central-connection circle${central > 1 ? "s" : ""} (\`()\`) drawn as plain arrow ends.`);

  return {
    title: cleanText(db.getDiagramTitle?.()) || null,
    actors,
    boxes,
    rows,
    spans,
    fragments,
    entries,
    warnings,
  };
}
