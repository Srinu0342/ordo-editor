import { Document, isMap, isNode, isScalar, isSeq, Pair, Scalar, YAMLMap, YAMLSeq, type Node as YNode } from "yaml";
import { resolve, type YamlStyle } from "./read.ts";
import {
  DEFAULTS,
  EDGE_FIELD_ORDER,
  LABELLED,
  NODE_FIELD_ORDER,
  type OrdoFile,
  type OrdoKind,
  type OrdoLayoutFile,
  type ResolvedDiagram,
  type ResolvedEdge,
  type ResolvedNode,
} from "./types.ts";

// The writer. When a source document exists — the one the last import or
// export left behind — it is cloned and PATCHED with only what changed, which
// is how comments, ordering and blank lines survive canvas edits. Without one,
// the same reconciliation runs against an empty document, which yields the
// canonical form: one code path, not two.
//
// Patch order: the skeleton (detach deleted and reparented items, convert
// leaf <-> group in place, append moved and new items at the end of their new
// parent's list, so existing siblings never reorder), then the edges, then
// the data (only fields whose resolved value changed), then a prune of
// anything left empty.

/** lineWidth 0 stops the library folding long labels across lines (a one-line rename stays one line). */
export const STRINGIFY = { lineWidth: 0 } as const;

const ORDO_KEYS = ["ordo", "nodes", "edges", "data"];
const DATA_KEYS = ["nodes", "edges"];
const LAYOUT_KEYS = ["ordo-layout", "nodes", "edges"];
const NODE_FIELDS: string[] = [...NODE_FIELD_ORDER];
const EDGE_FIELDS: string[] = [...EDGE_FIELD_ORDER];
const BOX_FIELDS = ["x", "y", "w", "h", "z", "rotation", "t", "shift", "angle"];
const HANDLE_FIELDS = ["from", "to", "z"];

// Field values are scalars or (nested) lists of scalars, so their JSON is a
// faithful equality.
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const keyOf = (p: { key: unknown }) => String(isScalar(p.key) ? p.key.value : p.key);

/** Get `key` from `map`, creating it at its canonical position (per `order`) if missing. */
function ensure<T extends YNode>(map: YAMLMap, key: string, order: string[], make: () => T): T {
  const existing = map.get(key, true);
  if (existing) return existing as T;
  const node = make();
  const rank = order.indexOf(key);
  const at = rank < 0 ? -1 : map.items.findIndex((p) => order.indexOf(keyOf(p)) > rank);
  const pair = new Pair(new Scalar(key), node);
  if (at < 0) map.items.push(pair);
  else map.items.splice(at, 0, pair);
  return node;
}

/** Set a field in place, or insert it at its canonical position. */
function setField(map: YAMLMap, key: string, value: unknown, order: string[]) {
  if (map.has(key)) map.set(key, value);
  else ensure(map, key, order, () => (isNode(value) ? value : new Scalar(value)));
}

function deleteIn(doc: Document, path: string[]) {
  if (doc.hasIn(path)) doc.deleteIn(path);
}

/**
 * Drop maps and sequences that became empty, so deletes leave no `edges: {}`
 * behind. Below the top level only maps go: a list there is a field's value,
 * and an empty one (a tube's `taps: []`) means something.
 */
function prune(map: YAMLMap, keep: string[], top = true) {
  for (const p of [...map.items]) {
    const v = p.value;
    if (isMap(v)) {
      for (const inner of [...v.items]) if (isMap(inner.value) && inner.value.items.length === 0) v.delete(inner.key);
      prune(v, [], false);
    }
    if ((isMap(v) || (top && isSeq(v))) && v.items.length === 0 && !keep.includes(keyOf(p))) map.delete(p.key);
  }
}

// ------------------------------------------------------------------ structure document

interface SkeletonEntry {
  item: YNode;
  seq: YAMLSeq;
  parent: string | null;
  kids: YAMLSeq | null;
}

function indexSkeleton(seq: YAMLSeq, parent: string | null, out: Map<string, SkeletonEntry>) {
  for (const item of seq.items as YNode[]) {
    if (isScalar(item)) out.set(String(item.value), { item, seq, parent, kids: null });
    else if (isMap(item)) {
      const pair = item.items[0];
      const kids = pair.value as YAMLSeq;
      out.set(keyOf(pair), { item, seq, parent, kids });
      indexSkeleton(kids, keyOf(pair), out);
    }
  }
}

function removeItem(seq: YAMLSeq, item: YNode) {
  const i = seq.items.indexOf(item);
  if (i >= 0) seq.items.splice(i, 1);
}

/** Leaf `- db` becomes group `- db: []`; comments move with it. */
function leafToGroup(doc: Document, leaf: Scalar): { map: YAMLMap; kids: YAMLSeq } {
  const kids = new YAMLSeq();
  const map = new YAMLMap();
  map.items.push(doc.createPair(leaf.value, kids));
  map.commentBefore = leaf.commentBefore;
  map.spaceBefore = leaf.spaceBefore;
  return { map, kids };
}

/** Group `- db: []` becomes leaf `- db`; only called when it has no children left. */
function groupToLeaf(doc: Document, group: YAMLMap): Scalar {
  const leaf = doc.createNode(keyOf(group.items[0])) as Scalar;
  leaf.commentBefore = group.commentBefore;
  leaf.spaceBefore = group.spaceBefore;
  return leaf;
}

function reconcileSkeleton(doc: Document, target: ResolvedDiagram) {
  const root = doc.get("nodes", true) as YAMLSeq;
  const cur = new Map<string, SkeletonEntry>();
  indexSkeleton(root, null, cur);
  const want = new Map(target.nodes.map((n) => [n.id, n]));
  const kidsOf = new Map<string, YAMLSeq>();
  for (const [id, e] of cur) if (e.kids) kidsOf.set(id, e.kids);

  // 1. Detach deleted nodes and nodes whose parent changed. Moved items keep their comments.
  const held = new Map<string, YNode>();
  for (const [id, e] of cur) {
    const t = want.get(id);
    if (t && t.parent === e.parent) continue;
    removeItem(e.seq, e.item);
    if (t) held.set(id, e.item);
  }

  // 2. Leaf <-> group conversions, in place (or on the held item).
  for (const [id, e] of cur) {
    const t = want.get(id);
    if (!t || t.isGroup === (e.kids !== null)) continue;
    const before = held.get(id) ?? e.item;
    let after: YNode;
    if (t.isGroup) {
      const g = leafToGroup(doc, before as Scalar);
      kidsOf.set(id, g.kids);
      after = g.map;
    } else {
      after = groupToLeaf(doc, before as YAMLMap);
      kidsOf.delete(id);
    }
    if (held.has(id)) held.set(id, after);
    else e.seq.items.splice(e.seq.items.indexOf(before), 1, after);
  }

  // 3. Insert moved and new nodes at the end of their new parent's list, in target pre-order.
  for (const n of target.nodes) {
    if (cur.has(n.id) && !held.has(n.id)) continue;
    let item = held.get(n.id);
    if (!item) {
      if (n.isGroup) {
        const g = leafToGroup(doc, doc.createNode(n.id) as Scalar);
        kidsOf.set(n.id, g.kids);
        item = g.map;
      } else item = doc.createNode(n.id) as Scalar;
    }
    const into = n.parent === null ? root : kidsOf.get(n.parent)!;
    into.items.push(item);
    into.flow = false;
  }
}

function reconcileEdges(doc: Document, target: ResolvedDiagram) {
  const top = doc.contents as YAMLMap;
  const want = new Map(target.edges.map((e) => [e.id, e]));
  const seq = top.get("edges", true) as YAMLSeq | undefined;
  const have = new Set<string>();
  if (seq) {
    seq.items = (seq.items as YAMLMap[]).filter((m) => want.has(String(m.get("id"))));
    for (const m of seq.items as YAMLMap[]) {
      const e = want.get(String(m.get("id")))!;
      have.add(e.id);
      if (m.get("from") !== e.from) m.set("from", e.from);
      if (m.get("to") !== e.to) m.set("to", e.to);
    }
  }
  for (const e of target.edges) {
    if (have.has(e.id)) continue;
    const into = ensure(top, "edges", ORDO_KEYS, () => new YAMLSeq());
    const m = doc.createNode({ id: e.id, from: e.from, to: e.to }) as YAMLMap;
    m.flow = true; // one edge per line
    into.items.push(m);
    into.flow = false;
  }
}

/** Only fields whose resolved value changed are written; defaults are omitted for new entries. */
function reconcileData(doc: Document, prev: ResolvedDiagram, target: ResolvedDiagram) {
  const top = doc.contents as YAMLMap;
  const entry = (section: "nodes" | "edges", id: string) => {
    const data = ensure(top, "data", ORDO_KEYS, () => new YAMLMap());
    const sec = ensure(data, section, DATA_KEYS, () => new YAMLMap());
    return ensure(sec, id, [], () => new YAMLMap());
  };
  const apply = (
    section: "nodes" | "edges",
    id: string,
    fields: string[],
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>,
    defaults: Record<string, unknown>,
  ) => {
    for (const f of fields) {
      const b = before ? (before[f] ?? defaults[f]) : defaults[f];
      const a = after[f];
      if (same(a, b)) continue;
      if (a === undefined) deleteIn(doc, ["data", section, id, f]);
      // A list goes on one line, like an edge or a layout entry: taps, guards, sections.
      else setField(entry(section, id), f, Array.isArray(a) ? doc.createNode(a, { flow: true }) : a, fields);
    }
  };

  const kindOf = (n: ResolvedNode): OrdoKind => n.kind ?? (n.isGroup ? "group" : DEFAULTS.kind);
  // What a node says in the data section: a group has no kind and no shape,
  // and only a box has a shape.
  const nodeView = (n: ResolvedNode): Record<string, unknown> => {
    const kind = kindOf(n);
    return {
      ...Object.fromEntries(NODE_FIELDS.map((f) => [f, (n as unknown as Record<string, unknown>)[f]])),
      kind: kind === "group" ? undefined : kind,
      shape: kind === "box" ? n.shape : undefined,
    };
  };
  const nodeDefaults = (n: ResolvedNode): Record<string, unknown> => {
    const kind = kindOf(n);
    return {
      kind: kind === "group" ? undefined : DEFAULTS.kind,
      label: LABELLED.has(kind) ? n.id : undefined,
      shape: kind === "box" ? DEFAULTS.shape : undefined,
    };
  };

  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const keepNodes = new Set(target.nodes.map((n) => n.id));
  for (const id of prevNodes.keys()) if (!keepNodes.has(id)) deleteIn(doc, ["data", "nodes", id]);
  for (const n of target.nodes) {
    const p = prevNodes.get(n.id);
    apply("nodes", n.id, NODE_FIELDS, p && nodeView(p), nodeView(n), nodeDefaults(n));
  }

  const edgeView = (e: ResolvedEdge): Record<string, unknown> =>
    Object.fromEntries(EDGE_FIELDS.map((f) => [f, (e as unknown as Record<string, unknown>)[f]]));
  const edgeDefaults: Record<string, unknown> = {
    label: undefined,
    textSize: undefined,
    textWeight: undefined,
    line: DEFAULTS.line,
    width: undefined,
    color: DEFAULTS.color,
    start: DEFAULTS.start,
    end: DEFAULTS.end,
    route: DEFAULTS.route,
    placement: DEFAULTS.placement,
    hidden: false,
  };
  const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));
  const keepEdges = new Set(target.edges.map((e) => e.id));
  for (const id of prevEdges.keys()) if (!keepEdges.has(id)) deleteIn(doc, ["data", "edges", id]);
  for (const e of target.edges) {
    const p = prevEdges.get(e.id);
    apply("edges", e.id, EDGE_FIELDS, p && edgeView(p), edgeView(e), edgeDefaults);
  }
}

/**
 * Write the structure document. With a source document (from the last import or export), patch it;
 * without one, reconcile into a fresh document, which yields the canonical form. `style` is the
 * indentation the file came in with (see detectStyle), so a save does not re-indent it.
 */
export function writeOrdo(
  source: Document | null,
  target: ResolvedDiagram,
  style?: YamlStyle,
): { doc: Document; text: string } {
  const doc = source ? source.clone() : new Document({ ordo: 1, nodes: [] });
  const prev = source ? resolve(source.toJS() as OrdoFile) : { nodes: [], edges: [] };
  reconcileSkeleton(doc, target);
  reconcileEdges(doc, target);
  reconcileData(doc, prev, target);
  prune(doc.contents as YAMLMap, ["nodes"]);
  return { doc, text: doc.toString({ ...STRINGIFY, ...style }) };
}

// ------------------------------------------------------------------ layout document

export function writeLayout(
  source: Document | null,
  target: OrdoLayoutFile,
  style?: YamlStyle,
): { doc: Document; text: string } {
  const doc = source ? source.clone() : new Document({ "ordo-layout": 1 });
  const top = doc.contents as YAMLMap;
  for (const [section, fields] of [
    ["nodes", BOX_FIELDS],
    ["edges", HANDLE_FIELDS],
  ] as const) {
    const want = (target[section] ?? {}) as Record<string, Record<string, unknown>>;
    const map = top.get(section, true) as YAMLMap | undefined;
    // Object.hasOwn, not `in`: an orphan entry keyed `constructor` or
    // `toString` would otherwise count as wanted and never be dropped.
    if (map) for (const p of [...map.items]) if (!Object.hasOwn(want, keyOf(p))) map.delete(p.key);
    for (const [id, value] of Object.entries(want)) {
      const cur = map?.get(id, true) as YAMLMap | undefined;
      if (cur) {
        for (const f of fields) {
          if (value[f] === undefined) {
            if (cur.has(f)) cur.delete(f);
          } else if (cur.get(f) !== value[f]) setField(cur, f, value[f], [...fields]);
        }
      } else {
        const into = ensure(top, section, LAYOUT_KEYS, () => new YAMLMap());
        const m = doc.createNode(value) as YAMLMap;
        m.flow = true; // one node per line
        into.items.push(doc.createPair(id, m));
      }
    }
  }
  prune(top, []);
  return { doc, text: doc.toString({ ...STRINGIFY, ...style }) };
}
